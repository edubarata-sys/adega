import { aplicarMovimentoEstoque, schema } from '@adega/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'
import { candidatosEan } from './produtos'

/**
 * Entrada de mercadoria por FOTO da nota (pedido do cliente 25/09).
 *
 * 1. POST /estoque/nota/ler: a foto vai pra um modelo de visao na Groq
 *    (GROQ_API_KEY; modelo em GROQ_VISION_MODEL, padrao qwen/qwen3.8-27b),
 *    que devolve os itens em JSON. Cada item e ligado a um produto do
 *    cadastro: primeiro pelo codigo de barras, senao pelo nome (sugestoes).
 *    NADA e gravado nesta etapa.
 * 2. POST /estoque/nota/confirmar: depois da conferencia na tela, da entrada
 *    no estoque de cada item. O custo unitario da nota fica gravado no
 *    proprio movimento (estoque_movimentos.custo_unitario) e a observacao
 *    leva fornecedor/numero -- base pro financeiro depois, sem tabela nova.
 */

const MODELO_PADRAO = 'qwen/qwen3.8-27b'

const PROMPT = `Voce le fotos de notas fiscais / DANFE / pedidos de compra de uma adega (bebidas) no Brasil.
Devolva SOMENTE um JSON valido, sem texto antes ou depois, neste formato:
{"fornecedor": string|null, "numero": string|null, "data": "AAAA-MM-DD"|null,
 "itens": [{"descricao": string, "ean": string|null, "quantidade": number,
            "unidade": string|null, "valor_unitario": number|null, "valor_total": number|null}]}
Regras: uma linha por produto da nota; "ean" so se aparecer o codigo de barras (8 a 14 digitos),
senao null (codigo interno do fornecedor NAO e ean); quantidade em unidades (se a nota vier em
caixa/fardo e mostrar quantas unidades por caixa, converta para unidades); valores em reais
como numero com ponto decimal. Nao invente itens que nao estao na imagem.`

const LerBody = z.object({
  imagemBase64: z.string().min(100),
  mime: z
    .string()
    .regex(/^image\/(jpeg|png|webp)$/)
    .default('image/jpeg'),
})

const ItemLidoSchema = z.object({
  descricao: z.string().default(''),
  ean: z.union([z.string(), z.number()]).nullish(),
  quantidade: z.coerce.number().default(0),
  unidade: z.string().nullish(),
  valor_unitario: z.coerce.number().nullish(),
  valor_total: z.coerce.number().nullish(),
})
const NotaLidaSchema = z.object({
  fornecedor: z.string().nullish(),
  numero: z.union([z.string(), z.number()]).nullish(),
  data: z.string().nullish(),
  itens: z.array(ItemLidoSchema).default([]),
})

const ConfirmarBody = z.object({
  fornecedor: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(60).optional(),
  itens: z
    .array(
      z.object({
        produtoId: z.string().uuid(),
        quantidade: z.number().positive(),
        /** Centavos. */
        custoUnitario: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
})

/** Tira acento, caixa e pontuacao; separa em palavras uteis. */
function palavras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .split(/[^a-z0-9.]+/)
    .filter((p) => p.length >= 2 || /\d/.test(p))
}

/** Parecenca simples por palavras em comum (com peso maior pra numeros, ex. 1.5l, 350ml). */
function pontuar(lido: string[], cadastro: string[]): number {
  if (lido.length === 0 || cadastro.length === 0) return 0
  const setCad = new Set(cadastro)
  let pontos = 0
  for (const p of lido) {
    if (setCad.has(p)) pontos += /\d/.test(p) ? 2 : 1
    else if (p.length >= 4 && cadastro.some((c) => c.startsWith(p) || p.startsWith(c)))
      pontos += 0.5
  }
  return pontos / Math.max(lido.length, cadastro.length)
}

function extrairJson(texto: string): unknown {
  const limpo = texto.replace(/```(?:json)?/gi, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) throw new Error('Resposta sem JSON.')
  return JSON.parse(limpo.slice(inicio, fim + 1))
}

function reaisParaCentavos(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100)
}

export function registrarRotasNotaEntrada(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAdmin = criarRequireAuth(deps.sessionSecret, { perfil: 'admin' })

  app.post<{ Body: z.infer<typeof LerBody> }>(
    '/estoque/nota/ler',
    { preHandler: requireAdmin, bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const parse = LerBody.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ status: 'erro', motivo: 'Imagem invalida.' })
      }
      const chave = process.env.GROQ_API_KEY?.trim()
      if (!chave) {
        return reply.code(503).send({
          status: 'erro',
          motivo: 'Leitura de nota nao configurada: falta a variavel GROQ_API_KEY no servidor.',
        })
      }
      const modelo = process.env.GROQ_VISION_MODEL?.trim() || MODELO_PADRAO

      let conteudo: string
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelo,
            temperature: 0,
            max_tokens: 4000,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: PROMPT },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${parse.data.mime};base64,${parse.data.imagemBase64}` },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
        })
        const json = (await resp.json()) as {
          choices?: { message?: { content?: string } }[]
          error?: { message?: string }
        }
        if (!resp.ok) {
          request.log.warn({ status: resp.status, erro: json.error }, 'groq falhou')
          return reply.code(502).send({
            status: 'erro',
            motivo: `Servico de leitura recusou (${resp.status}): ${json.error?.message ?? 'erro desconhecido'}`,
          })
        }
        conteudo = json.choices?.[0]?.message?.content ?? ''
      } catch (e) {
        request.log.warn({ e }, 'groq inalcancavel')
        return reply
          .code(502)
          .send({
            status: 'erro',
            motivo: 'Nao consegui falar com o servico de leitura. Tente de novo.',
          })
      }

      let nota: z.infer<typeof NotaLidaSchema>
      try {
        nota = NotaLidaSchema.parse(extrairJson(conteudo))
      } catch {
        return reply.code(422).send({
          status: 'erro',
          motivo: 'Nao consegui entender a nota. Tire outra foto mais reta e com boa luz.',
          textoLido: conteudo.slice(0, 2000),
        })
      }

      // Cadastro ativo pra ligar os itens (605 produtos: cabe em memoria).
      const produtos = await deps.db
        .select({
          id: schema.produtos.id,
          descricao: schema.produtos.descricao,
          ean: schema.produtos.ean,
          custoMedio: schema.produtos.custoMedio,
          precoVenda: schema.produtos.precoVenda,
          estoqueAtual: schema.estoqueSaldos.quantidade,
        })
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.ativo, true))
      const porEan = new Map<string, (typeof produtos)[number]>()
      for (const p of produtos) if (p.ean) porEan.set(p.ean, p)
      const palavrasCadastro = produtos.map((p) => ({ p, w: palavras(p.descricao) }))

      const itens = nota.itens
        .filter((i) => i.descricao.trim() || i.ean)
        .map((i, indice) => {
          const eanTexto =
            i.ean === null || i.ean === undefined ? null : String(i.ean).replace(/\D/g, '')
          const ean = eanTexto && /^\d{8,14}$/.test(eanTexto) ? eanTexto : null
          let porCodigo: (typeof produtos)[number] | undefined
          if (ean) for (const c of candidatosEan(ean)) porCodigo ??= porEan.get(c)

          const w = palavras(i.descricao)
          const sugestoes = palavrasCadastro
            .map(({ p, w: wc }) => ({ p, s: pontuar(w, wc) }))
            .filter((x) => x.s >= 0.25)
            .sort((a, b) => b.s - a.s)
            .slice(0, 5)
            .map((x) => ({
              id: x.p.id,
              descricao: x.p.descricao,
              ean: x.p.ean,
              estoqueAtual: x.p.estoqueAtual,
              pontuacao: Math.round(x.s * 100) / 100,
            }))

          const valorUnitario =
            reaisParaCentavos(i.valor_unitario) ??
            (i.valor_total && i.quantidade ? reaisParaCentavos(i.valor_total / i.quantidade) : null)

          return {
            indice,
            descricaoLida: i.descricao.trim(),
            ean,
            quantidade: i.quantidade > 0 ? i.quantidade : 1,
            unidade: i.unidade ?? null,
            custoUnitario: valorUnitario,
            valorTotal: reaisParaCentavos(i.valor_total),
            produto: porCodigo
              ? {
                  id: porCodigo.id,
                  descricao: porCodigo.descricao,
                  ean: porCodigo.ean,
                  estoqueAtual: porCodigo.estoqueAtual,
                }
              : null,
            ligadoPor: porCodigo ? ('codigo' as const) : null,
            sugestoes,
          }
        })

      return reply.send({
        fornecedor: nota.fornecedor ?? null,
        numero: nota.numero === null || nota.numero === undefined ? null : String(nota.numero),
        data: nota.data ?? null,
        modelo,
        itens,
      })
    },
  )

  app.post<{ Body: z.infer<typeof ConfirmarBody> }>(
    '/estoque/nota/confirmar',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const parse = ConfirmarBody.safeParse(request.body)
      if (!parse.success) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Itens invalidos.', detalhes: parse.error.flatten() })
      }
      const { fornecedor, numero, itens } = parse.data
      const ids = [...new Set(itens.map((i) => i.produtoId))]
      const existentes = await deps.db
        .select({ id: schema.produtos.id })
        .from(schema.produtos)
        .where(and(inArray(schema.produtos.id, ids)))
      if (existentes.length !== ids.length) {
        return reply
          .code(404)
          .send({ status: 'erro', motivo: 'Algum produto da nota nao existe mais.' })
      }

      const origemId = crypto.randomUUID()
      const observacao =
        ['Entrada por nota', numero ? `n. ${numero}` : null, fornecedor ? `- ${fornecedor}` : null]
          .filter(Boolean)
          .join(' ') || 'Entrada por nota'
      const agora = new Date()
      await deps.db.transaction(async (tx) => {
        for (const item of itens) {
          await aplicarMovimentoEstoque(tx, {
            id: crypto.randomUUID(),
            produtoId: item.produtoId,
            tipo: 'entrada',
            quantidade: item.quantidade,
            custoUnitario: item.custoUnitario,
            origemTipo: 'nota_entrada',
            origemId,
            usuarioId: request.usuarioAutenticado!.usuarioId,
            observacao,
            ocorridoEm: agora,
          })
        }
      })
      return reply.send({ status: 'ok', itensLancados: itens.length, origemId })
    },
  )
}
