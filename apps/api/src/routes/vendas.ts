import {
  calcularVenda,
  centavos,
  conferirPagamentos,
  FORMAS_PAGAMENTO,
  ManualAdapter,
  type Centavos,
  type FormaPagamento,
  type Pagamento,
} from '@adega/core'
import { aplicarMovimentoEstoque, schema } from '@adega/db'
import { desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

const ItemBodySchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive(),
  /** Preco unitario em centavos, capturado no carrinho no momento em que o
   * item foi adicionado (leitura de EAN/busca) -- o servidor nao re-consulta
   * o preco atual do produto no fechamento da venda, pois o operador ja
   * confirmou este valor na tela do PDV. */
  precoUnitario: z.number().int(),
  descontoItem: z.number().int().nonnegative().optional(),
})

const PagamentoBodySchema = z.object({
  forma: z.enum(FORMAS_PAGAMENTO),
  valor: z.number().int().positive(),
  /** Qual maquininha fisica recebeu o pagamento (a loja tem duas) --
   * so faz sentido pra debito/credito, mas nao e validado contra a forma
   * aqui: o operador escolhe na tela, o servidor so guarda o que veio.
   * Usado depois pra separar o relatorio de vendas por maquininha. */
  terminalApelido: z.string().trim().min(1).max(60).optional(),
})

const VendaBodySchema = z.object({
  /** Gerado no cliente (arquitetura §2: id nasce fora do banco). Se omitido,
   * o servidor gera -- mas o cliente DEVE reenviar o mesmo id numa retentativa
   * de rede para que a venda seja idempotente. */
  id: z.string().uuid().optional(),
  itens: z.array(ItemBodySchema).min(1),
  descontoGeral: z.number().int().nonnegative().optional(),
  pagamentos: z.array(PagamentoBodySchema).min(1),
})

async function buscarSessaoCaixaAberta(deps: DependenciasApp) {
  const [sessao] = await deps.db
    .select()
    .from(schema.caixaSessoes)
    .where(isNull(schema.caixaSessoes.fechadoEm))
  return sessao ?? null
}

async function buscarVendaCompleta(deps: DependenciasApp, vendaId: string) {
  const [venda] = await deps.db.select().from(schema.vendas).where(eq(schema.vendas.id, vendaId))
  if (!venda) return null
  const itens = await deps.db
    .select()
    .from(schema.vendaItens)
    .where(eq(schema.vendaItens.vendaId, vendaId))
  const pagamentos = await deps.db
    .select()
    .from(schema.pagamentos)
    .where(eq(schema.pagamentos.vendaId, vendaId))
  return { venda, itens, pagamentos }
}

const LIMITE_VENDAS_RECENTES_PADRAO = 20
const LIMITE_VENDAS_RECENTES_MAXIMO = 100

/**
 * PASSO 9 (localizar): lista as vendas mais recentes primeiro -- e a tela
 * de "o que vendi ha pouco" que o operador ou o dono usa para achar uma
 * venda especifica antes de abrir o detalhe (GET /vendas/:id).
 */
async function listarVendasRecentes(deps: DependenciasApp, limite: number) {
  return deps.db
    .select({
      id: schema.vendas.id,
      numero: schema.vendas.numero,
      total: schema.vendas.total,
      status: schema.vendas.status,
      ocorridoEm: schema.vendas.ocorridoEm,
      operadorNome: schema.usuarios.nome,
    })
    .from(schema.vendas)
    .innerJoin(schema.usuarios, eq(schema.usuarios.id, schema.vendas.usuarioId))
    .orderBy(desc(schema.vendas.ocorridoEm))
    .limit(limite)
}

/**
 * PASSO 9 (inspecionar): tudo que se espera conferir numa venda especifica
 * -- itens (com descricao do produto, nao so o id), valores, forma(s) de
 * pagamento, QUEM vendeu e EM QUAL sessao de caixa, e quando.
 */
async function buscarVendaDetalhada(deps: DependenciasApp, vendaId: string) {
  const [venda] = await deps.db.select().from(schema.vendas).where(eq(schema.vendas.id, vendaId))
  if (!venda) return null

  const [operador] = await deps.db
    .select({ id: schema.usuarios.id, nome: schema.usuarios.nome })
    .from(schema.usuarios)
    .where(eq(schema.usuarios.id, venda.usuarioId))

  const caixaSessao = venda.sessaoCaixaId
    ? (
        await deps.db
          .select({
            id: schema.caixaSessoes.id,
            abertoEm: schema.caixaSessoes.abertoEm,
            fechadoEm: schema.caixaSessoes.fechadoEm,
          })
          .from(schema.caixaSessoes)
          .where(eq(schema.caixaSessoes.id, venda.sessaoCaixaId))
      )[0]
    : undefined

  const itens = await deps.db
    .select({
      id: schema.vendaItens.id,
      produtoId: schema.vendaItens.produtoId,
      descricao: schema.produtos.descricao,
      ean: schema.produtos.ean,
      quantidade: schema.vendaItens.quantidade,
      precoUnitario: schema.vendaItens.precoUnitario,
      descontoItem: schema.vendaItens.descontoItem,
      totalItem: schema.vendaItens.totalItem,
    })
    .from(schema.vendaItens)
    .innerJoin(schema.produtos, eq(schema.produtos.id, schema.vendaItens.produtoId))
    .where(eq(schema.vendaItens.vendaId, vendaId))

  const pagamentos = await deps.db
    .select()
    .from(schema.pagamentos)
    .where(eq(schema.pagamentos.vendaId, vendaId))

  return { venda, operador: operador ?? null, caixaSessao: caixaSessao ?? null, itens, pagamentos }
}

export function registrarRotasVendas(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  // PASSO 9: localizar uma venda recente.
  app.get<{ Querystring: { limite?: string } }>(
    '/vendas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const limiteBruto = Number(request.query.limite ?? LIMITE_VENDAS_RECENTES_PADRAO)
      if (!Number.isInteger(limiteBruto) || limiteBruto <= 0) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'limite precisa ser um inteiro > 0.' })
      }
      const limite = Math.min(limiteBruto, LIMITE_VENDAS_RECENTES_MAXIMO)
      const vendas = await listarVendasRecentes(deps, limite)
      return { vendas }
    },
  )

  // PASSO 9: inspecionar uma venda especifica (itens, valores, pagamento,
  // operador, sessao de caixa, data/hora).
  app.get<{ Params: { id: string } }>(
    '/vendas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const detalhe = await buscarVendaDetalhada(deps, request.params.id)
      if (!detalhe) {
        return reply.code(404).send({ status: 'erro', motivo: 'Venda nao encontrada.' })
      }
      return detalhe
    },
  )

  /**
   * NUCLEO DA MISSAO: registra uma venda completa numa unica transacao --
   * venda + itens + pagamento(s) + baixa de estoque + vinculo com a sessao
   * de caixa e o operador. Ou tudo entra, ou nada entra (rollback).
   *
   * Estoque NUNCA bloqueia a venda (arquitetura §2 tolera saldo negativo --
   * conferencia fisica e responsabilidade do dono, nao trava de sistema).
   */
  app.post<{
    Body: z.infer<typeof VendaBodySchema>
  }>('/vendas', { preHandler: requireAuth }, async (request, reply) => {
    const parse = VendaBodySchema.safeParse(request.body)
    if (!parse.success) {
      return reply
        .code(400)
        .send({ status: 'erro', motivo: 'Corpo invalido.', detalhes: parse.error.flatten() })
    }
    const corpo = parse.data
    const vendaId = corpo.id ?? crypto.randomUUID()

    // Idempotencia: reenvio da mesma venda (retentativa apos queda de rede)
    // devolve o resultado ja gravado em vez de processar (e baixar estoque)
    // de novo.
    const jaExiste = await buscarVendaCompleta(deps, vendaId)
    if (jaExiste) {
      return reply.code(200).send({ ...jaExiste, idempotente: true })
    }

    const sessaoCaixa = await buscarSessaoCaixaAberta(deps)
    if (!sessaoCaixa) {
      return reply.code(409).send({
        status: 'erro',
        motivo: 'Nenhuma sessao de caixa aberta -- abra o caixa antes de registrar uma venda.',
      })
    }

    const descontoGeral = centavos(corpo.descontoGeral ?? 0)
    const vendaCalculada = calcularVenda(
      corpo.itens.map((item) => ({
        quantidade: item.quantidade,
        precoUnitario: centavos(item.precoUnitario),
        descontoItem: item.descontoItem === undefined ? undefined : centavos(item.descontoItem),
      })),
      descontoGeral,
    )
    if (!vendaCalculada.ok) {
      return reply.code(400).send({
        status: 'erro',
        motivo: vendaCalculada.erro.mensagem,
        codigo: vendaCalculada.erro.codigo,
      })
    }

    const pagamentosNormalizados: Pagamento[] = corpo.pagamentos.map((p) => ({
      forma: p.forma as FormaPagamento,
      valor: centavos(p.valor),
    }))
    const numeroDePagamentosEmDinheiro = pagamentosNormalizados.filter(
      (p) => p.forma === 'dinheiro',
    ).length
    if (numeroDePagamentosEmDinheiro > 1) {
      return reply.code(400).send({
        status: 'erro',
        motivo:
          'Apenas um pagamento em dinheiro e suportado por venda (para trocar sem ambiguidade).',
      })
    }

    const resumoPagamento = conferirPagamentos(vendaCalculada.valor.total, pagamentosNormalizados)
    if (!resumoPagamento.ok) {
      return reply.code(400).send({
        status: 'erro',
        motivo: resumoPagamento.erro.mensagem,
        codigo: resumoPagamento.erro.codigo,
      })
    }

    // ManualAdapter (decisao congelada da Torre, secao 3): "processar" aqui
    // nao fala com nenhuma adquirente/TEF, so formaliza que o operador ja
    // confirmou visualmente o pagamento na tela do PDV -- e o unico ponto
    // do codigo que sabe disso, para que trocar por um adapter real
    // (Rede/Itau/TEF, fora de escopo desta missao) nao exija tocar o resto
    // desta rota.
    const processamentos = pagamentosNormalizados.map((p, indice) => ({
      pagamento: p,
      resultado: ManualAdapter.processar(p),
      // Nao faz parte do dominio puro (core/venda.ts) -- e so um rotulo
      // do operador pra separar o relatorio de vendas por maquininha depois.
      terminalApelido: corpo.pagamentos[indice]?.terminalApelido ?? null,
    }))
    const naoConfirmado = processamentos.find((p) => !p.resultado.confirmado)
    if (naoConfirmado) {
      return reply.code(400).send({
        status: 'erro',
        motivo: `Pagamento em ${naoConfirmado.pagamento.forma} nao foi confirmado.`,
      })
    }

    const operadorId = request.usuarioAutenticado!.usuarioId
    const agora = new Date()
    const troco: Centavos = resumoPagamento.valor.troco

    try {
      const resultado = await deps.db.transaction(async (tx) => {
        await tx.insert(schema.vendas).values({
          id: vendaId,
          sessaoCaixaId: sessaoCaixa.id,
          usuarioId: operadorId,
          status: 'paga',
          subtotal: vendaCalculada.valor.subtotal,
          desconto: vendaCalculada.valor.desconto,
          total: vendaCalculada.valor.total,
          ocorridoEm: agora,
        })

        for (const [indice, item] of vendaCalculada.valor.itens.entries()) {
          const itemOriginal = corpo.itens[indice]!
          const itemId = crypto.randomUUID()
          await tx.insert(schema.vendaItens).values({
            id: itemId,
            vendaId,
            produtoId: itemOriginal.produtoId,
            quantidade: String(item.quantidade),
            precoUnitario: item.precoUnitario,
            descontoItem: item.desconto,
            totalItem: item.total,
          })

          // Baixa de estoque pelo unico caminho que escreve ledger + saldo
          // (packages/db/src/repositorios/estoque.ts) -- quantidade negativa,
          // e permitido ficar negativo (arquitetura §2).
          await aplicarMovimentoEstoque(tx, {
            id: crypto.randomUUID(),
            produtoId: itemOriginal.produtoId,
            tipo: 'venda',
            quantidade: -item.quantidade,
            origemTipo: 'venda',
            origemId: vendaId,
            usuarioId: operadorId,
            ocorridoEm: agora,
          })
        }

        for (const { pagamento, resultado, terminalApelido } of processamentos) {
          await tx.insert(schema.pagamentos).values({
            id: crypto.randomUUID(),
            vendaId,
            forma: pagamento.forma,
            valor: pagamento.valor,
            troco: pagamento.forma === 'dinheiro' ? troco : 0,
            terminalApelido,
            // Campos de adquirente vem do adapter, nunca inventados aqui --
            // com o ManualAdapter sao sempre nulos (ver pagamento-adapter.ts).
            adquirente: resultado.adquirente,
            nsu: resultado.nsu,
            autorizacao: resultado.autorizacao,
            bandeira: resultado.bandeira,
            parcelas: resultado.parcelas,
          })
        }

        return await buscarVendaCompleta({ ...deps, db: tx }, vendaId)
      })

      return reply.code(201).send(resultado)
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      request.log.error(
        { erro: mensagem, vendaId },
        'falha ao registrar venda -- transacao revertida',
      )
      return reply.code(500).send({
        status: 'erro',
        motivo:
          'Nao foi possivel registrar a venda (a operacao foi totalmente revertida, nenhum dado parcial foi gravado).',
      })
    }
  })
}
