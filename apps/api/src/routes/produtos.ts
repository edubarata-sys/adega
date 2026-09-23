import { aplicarMovimentoEstoque, schema } from '@adega/db'
import { and, desc, eq, ilike, inArray, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

const LIMITE_BUSCA_DESCRICAO = 20
const LIMITE_CADASTRO_PADRAO = 200

/**
 * Forma comum devolvida por todas as rotas de produto: dados de cadastro +
 * saldo de estoque (leitura do cache `estoque_saldos`, nunca usado aqui pra
 * decidir se a venda pode ocorrer -- arquitetura §2 tolera negativo, essa
 * decisao fica em routes/vendas.ts).
 */
function selecaoProdutoComSaldo() {
  return {
    id: schema.produtos.id,
    ean: schema.produtos.ean,
    descricao: schema.produtos.descricao,
    descricaoPdv: schema.produtos.descricaoPdv,
    unidade: schema.produtos.unidade,
    categoriaId: schema.produtos.categoriaId,
    precoVenda: schema.produtos.precoVenda,
    custoMedio: schema.produtos.custoMedio,
    estoqueMinimo: schema.produtos.estoqueMinimo,
    ativo: schema.produtos.ativo,
    estoqueAtual: schema.estoqueSaldos.quantidade,
  } as const
}

const ProdutoBodySchema = z.object({
  descricao: z.string().trim().min(1, 'Descricao e obrigatoria.'),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'EAN precisa ter entre 8 e 14 digitos.')
    .optional(),
  descricaoPdv: z.string().trim().min(1).optional(),
  unidade: z.enum(['UN', 'KG', 'L']).optional(),
  categoriaId: z.string().uuid().optional(),
  /** Centavos, igual ao resto do sistema -- nunca float. */
  precoVenda: z.number().int().nonnegative(),
  custoMedio: z.number().int().nonnegative().optional(),
  /** Numero (nao string) -- vira `String()` soh na hora de gravar, igual ao
   * padrao ja usado em vendas.ts/estoque.ts pra colunas `numeric`. */
  estoqueMinimo: z.number().nonnegative().optional(),
})

const NovoProdutoBodySchema = ProdutoBodySchema.extend({
  /** So faz sentido na criacao -- editar estoque depois e uma acao separada
   * (POST /produtos/:id/estoque), nunca escondida dentro de um PUT. */
  estoqueInicial: z.number().nonnegative().optional(),
})

const AtualizarProdutoBodySchema = ProdutoBodySchema.extend({
  ativo: z.boolean().optional(),
})

const AjusteEstoqueBodySchema = z.object({
  tipo: z.enum(['entrada', 'perda', 'ajuste']),
  /** Sempre positivo pra entrada/perda (o `tipo` que decide o sinal do
   * delta); pode ser negativo APENAS em 'ajuste', pra corrigir contagem
   * física pra baixo sem precisar fingir uma "perda". */
  quantidade: z.number().refine((v) => v !== 0, 'Quantidade nao pode ser zero.'),
  observacao: z.string().trim().min(1).max(200).optional(),
})

/**
 * Gera as variantes plausiveis de um EAN escaneado pra cobrir a ambiguidade
 * UPC-A (12 digitos) <-> EAN-13 (13 digitos, zero a esquerda) -- leitoras
 * fisicas podem emitir qualquer uma das duas formas dependendo da config,
 * enquanto o cadastro pode ter guardado so uma delas. Sem isso, a busca
 * EXATA por EAN falha silenciosamente pra produtos com codigo de 12 digitos
 * (bebidas importadas, tipicamente) mesmo com o EAN certo na etiqueta.
 */
function candidatosEan(eanBruto: string): string[] {
  const digitos = eanBruto.trim()
  const candidatos = new Set<string>([digitos])
  if (digitos.length === 13 && digitos.startsWith('0')) {
    candidatos.add(digitos.slice(1))
  }
  if (digitos.length === 12) {
    candidatos.add(`0${digitos}`)
  }
  return [...candidatos]
}

/** Verifica se ja existe outro produto ATIVO com o mesmo EAN -- o schema nao
 * tem unique constraint (granel/fracionado pode ter EAN nulo), mas dois
 * produtos ativos com o mesmo EAN quebrariam a busca exata da pistola
 * (GET /produtos/ean/:ean sempre pega o primeiro que bater). */
async function eanJaEmUso(
  deps: DependenciasApp,
  ean: string,
  ignorarProdutoId?: string,
): Promise<boolean> {
  const condicoes = [eq(schema.produtos.ean, ean), eq(schema.produtos.ativo, true)]
  if (ignorarProdutoId) condicoes.push(ne(schema.produtos.id, ignorarProdutoId))
  const [existente] = await deps.db
    .select({ id: schema.produtos.id })
    .from(schema.produtos)
    .where(and(...condicoes))
  return Boolean(existente)
}

export function registrarRotasProdutos(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  /**
   * Busca EXATA por EAN -- e o caminho da pistola: le o codigo de barras,
   * o PDV chama isto direto (sem digitacao de texto no meio).
   */
  app.get<{ Params: { ean: string } }>(
    '/produtos/ean/:ean',
    { preHandler: requireAuth },
    async (request, reply) => {
      const candidatos = candidatosEan(request.params.ean)
      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(and(inArray(schema.produtos.ean, candidatos), eq(schema.produtos.ativo, true)))

      if (!produto) {
        return reply
          .code(404)
          .send({ status: 'erro', motivo: 'Produto nao encontrado para este EAN.' })
      }
      return { produto }
    },
  )

  /**
   * Busca por descricao (parcial, case-insensitive) -- caminho manual quando
   * o operador digita em vez de passar a pistola (produto sem etiqueta legivel,
   * granel, etc.). Limitada a 20 resultados: e busca de PDV, nao relatorio.
   */
  app.get<{ Querystring: { q?: string } }>(
    '/produtos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const termo = (request.query.q ?? '').trim()
      if (termo.length < 2) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Informe ao menos 2 caracteres em "q" para buscar.' })
      }

      const produtos = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(ilike(schema.produtos.descricao, `%${termo}%`))
        .limit(LIMITE_BUSCA_DESCRICAO)

      return { produtos: produtos.filter((p) => p.ativo) }
    },
  )

  /**
   * PASSO 10: listagem pra tela de cadastro/estoque -- ao contrario de
   * GET /produtos (busca do PDV), mostra produtos INATIVOS tambem (o dono
   * precisa poder reativar um produto que desativou por engano) e nao exige
   * termo de busca (tela de gestao, nao balcao).
   */
  app.get<{ Querystring: { q?: string } }>(
    '/produtos/cadastro',
    { preHandler: requireAuth },
    async (request, reply) => {
      const termo = (request.query.q ?? '').trim()
      const condicoes =
        termo.length > 0 ? ilike(schema.produtos.descricao, `%${termo}%`) : undefined

      const produtos = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(condicoes)
        .orderBy(desc(schema.produtos.atualizadoEm))
        .limit(LIMITE_CADASTRO_PADRAO)

      return reply.send({ produtos })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/produtos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.id, request.params.id))

      if (!produto) {
        return reply.code(404).send({ status: 'erro', motivo: 'Produto nao encontrado.' })
      }
      return { produto }
    },
  )

  /**
   * PASSO 10 (cadastro): cria um produto novo. Sempre cria a linha de saldo
   * de estoque junto (zerada) -- `aplicarMovimentoEstoque` pressupoe que ela
   * ja existe (packages/db/src/repositorios/estoque.ts) -- e, se um estoque
   * inicial foi informado, registra ele pelo MESMO caminho que qualquer
   * outra entrada de estoque usaria, nunca inventando um atalho que a
   * invariante SUM(movimentos) == saldo nao cobriria.
   */
  app.post<{ Body: z.infer<typeof NovoProdutoBodySchema> }>(
    '/produtos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parse = NovoProdutoBodySchema.safeParse(request.body)
      if (!parse.success) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Corpo invalido.', detalhes: parse.error.flatten() })
      }
      const corpo = parse.data

      if (corpo.ean && (await eanJaEmUso(deps, corpo.ean))) {
        return reply
          .code(409)
          .send({ status: 'erro', motivo: `Ja existe um produto ativo com o EAN ${corpo.ean}.` })
      }

      const produtoId = crypto.randomUUID()
      const usuarioId = request.usuarioAutenticado!.usuarioId
      const agora = new Date()

      await deps.db.transaction(async (tx) => {
        await tx.insert(schema.produtos).values({
          id: produtoId,
          descricao: corpo.descricao,
          ean: corpo.ean,
          descricaoPdv: corpo.descricaoPdv,
          unidade: corpo.unidade ?? 'UN',
          categoriaId: corpo.categoriaId,
          precoVenda: corpo.precoVenda,
          custoMedio: corpo.custoMedio ?? 0,
          estoqueMinimo: String(corpo.estoqueMinimo ?? 0),
          criadoEm: agora,
          atualizadoEm: agora,
        })

        await tx.insert(schema.estoqueSaldos).values({ produtoId, quantidade: '0' })

        if (corpo.estoqueInicial && corpo.estoqueInicial > 0) {
          await aplicarMovimentoEstoque(tx, {
            id: crypto.randomUUID(),
            produtoId,
            tipo: 'entrada',
            quantidade: corpo.estoqueInicial,
            custoUnitario: corpo.custoMedio ?? 0,
            origemTipo: 'cadastro',
            usuarioId,
            observacao: 'Estoque inicial informado no cadastro do produto.',
            ocorridoEm: agora,
          })
        }
      })

      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.id, produtoId))

      return reply.code(201).send({ produto })
    },
  )

  /**
   * PASSO 10 (cadastro): edita os dados de cadastro de um produto -- NUNCA
   * mexe em estoque (isso e POST /produtos/:id/estoque, uma acao separada e
   * auditavel, nao um efeito colateral escondido de editar preco/descricao).
   * Tambem serve pra desativar/reativar (`ativo`) em vez de apagar --
   * apagar quebraria o historico de vendas que referenciam este produto.
   */
  app.put<{ Params: { id: string }; Body: z.infer<typeof AtualizarProdutoBodySchema> }>(
    '/produtos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parse = AtualizarProdutoBodySchema.safeParse(request.body)
      if (!parse.success) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Corpo invalido.', detalhes: parse.error.flatten() })
      }
      const corpo = parse.data
      const produtoId = request.params.id

      const [existente] = await deps.db
        .select({ id: schema.produtos.id })
        .from(schema.produtos)
        .where(eq(schema.produtos.id, produtoId))
      if (!existente) {
        return reply.code(404).send({ status: 'erro', motivo: 'Produto nao encontrado.' })
      }

      if (corpo.ean && (await eanJaEmUso(deps, corpo.ean, produtoId))) {
        return reply
          .code(409)
          .send({ status: 'erro', motivo: `Ja existe outro produto ativo com o EAN ${corpo.ean}.` })
      }

      await deps.db
        .update(schema.produtos)
        .set({
          descricao: corpo.descricao,
          ean: corpo.ean,
          descricaoPdv: corpo.descricaoPdv,
          unidade: corpo.unidade ?? 'UN',
          categoriaId: corpo.categoriaId,
          precoVenda: corpo.precoVenda,
          custoMedio: corpo.custoMedio ?? 0,
          estoqueMinimo: String(corpo.estoqueMinimo ?? 0),
          ativo: corpo.ativo ?? true,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.produtos.id, produtoId))

      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.id, produtoId))

      return reply.send({ produto })
    },
  )

  /**
   * PASSO 10 (estoque manual): entrada de mercadoria, perda/quebra, ou
   * ajuste de contagem fisica -- os tres casos que uma loja real precisa
   * fora do fluxo automatico de venda. Sempre pelo mesmo ledger
   * (`aplicarMovimentoEstoque`) que a venda usa, entao a mesma invariante
   * (SUM(movimentos) == saldo) vale pra estoque mexido na mao tambem.
   */
  app.post<{ Params: { id: string }; Body: z.infer<typeof AjusteEstoqueBodySchema> }>(
    '/produtos/:id/estoque',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parse = AjusteEstoqueBodySchema.safeParse(request.body)
      if (!parse.success) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Corpo invalido.', detalhes: parse.error.flatten() })
      }
      const corpo = parse.data
      const produtoId = request.params.id

      const [existente] = await deps.db
        .select({ id: schema.produtos.id })
        .from(schema.produtos)
        .where(eq(schema.produtos.id, produtoId))
      if (!existente) {
        return reply.code(404).send({ status: 'erro', motivo: 'Produto nao encontrado.' })
      }

      // 'entrada' e 'perda' tem sinal fixo -- o operador so informa a
      // magnitude (sempre positiva); 'ajuste' aceita o delta com sinal,
      // porque corrigir uma contagem física pode ir pra cima ou pra baixo.
      if (corpo.tipo !== 'ajuste' && corpo.quantidade < 0) {
        return reply.code(400).send({
          status: 'erro',
          motivo: `Quantidade de "${corpo.tipo}" deve ser positiva (o tipo ja define o sinal).`,
        })
      }
      const delta = corpo.tipo === 'perda' ? -Math.abs(corpo.quantidade) : corpo.quantidade

      await deps.db.transaction(async (tx) => {
        await aplicarMovimentoEstoque(tx, {
          id: crypto.randomUUID(),
          produtoId,
          tipo: corpo.tipo,
          quantidade: delta,
          origemTipo: 'ajuste_manual',
          usuarioId: request.usuarioAutenticado!.usuarioId,
          observacao: corpo.observacao,
          ocorridoEm: new Date(),
        })
      })

      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.id, produtoId))

      return reply.send({ produto })
    },
  )
}
