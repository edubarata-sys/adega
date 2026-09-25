import {
  centavos,
  dataLojaIso,
  fimDoDiaLoja,
  gerarXmlRelatorioVendas,
  inicioDoDiaLoja,
  type VendaRelatorio,
} from '@adega/core'
import { schema } from '@adega/db'
import { and, asc, count, eq, gte, inArray, lte } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

/**
 * PASSO 11: extrato de vendas do periodo em XML, pra contadora. Decisao
 * registrada na conversa com o dono da loja: NAO e XML fiscal (isso e
 * resolvido pelo PDV da adquirente, fora deste sistema) -- e so um extrato
 * plano do que entrou, "separado por maquininha e junto", sem layout
 * especifico exigido por ela.
 */

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/

const QuerySchema = z.object({
  inicio: z.string().regex(RE_DATA, 'inicio precisa ser AAAA-MM-DD'),
  fim: z.string().regex(RE_DATA, 'fim precisa ser AAAA-MM-DD'),
})

async function buscarVendasDoPeriodo(
  deps: DependenciasApp,
  inicio: Date,
  fim: Date,
): Promise<VendaRelatorio[]> {
  const linhas = await deps.db
    .select({
      vendaId: schema.vendas.id,
      numero: schema.vendas.numero,
      ocorridoEm: schema.vendas.ocorridoEm,
      total: schema.vendas.total,
      pagamentoForma: schema.pagamentos.forma,
      pagamentoValor: schema.pagamentos.valor,
      pagamentoTerminal: schema.pagamentos.terminalApelido,
    })
    .from(schema.vendas)
    .innerJoin(schema.pagamentos, eq(schema.pagamentos.vendaId, schema.vendas.id))
    .where(
      and(
        eq(schema.vendas.status, 'paga'),
        gte(schema.vendas.ocorridoEm, inicio),
        lte(schema.vendas.ocorridoEm, fim),
      ),
    )
    .orderBy(asc(schema.vendas.ocorridoEm))

  const porVenda = new Map<string, VendaRelatorio>()
  for (const linha of linhas) {
    const existente = porVenda.get(linha.vendaId)
    const pagamento = {
      forma: linha.pagamentoForma,
      valor: centavos(linha.pagamentoValor),
      terminalApelido: linha.pagamentoTerminal,
    }
    if (existente) {
      ;(existente.pagamentos as (typeof pagamento)[]).push(pagamento)
    } else {
      porVenda.set(linha.vendaId, {
        vendaId: linha.vendaId,
        numero: linha.numero,
        ocorridoEm: linha.ocorridoEm,
        total: centavos(linha.total),
        pagamentos: [pagamento],
      })
    }
  }
  return [...porVenda.values()]
}

/**
 * Relatorio gerencial do periodo (tela Relatorios do PDV, pedido do cliente
 * 25/09): resumo, caixa por dia, por forma de pagamento/maquininha e por
 * produto, com custo e lucro.
 *
 * Custo: a venda ainda nao grava o custo do momento (venda_itens.custo_unitario
 * fica 0), entao usa o custo do item quando existir e, senao, o custo medio
 * ATUAL do cadastro do produto -- decisao do cliente: "vou ate o campo de
 * custo e faco uma media". Produto sem custo cadastrado (0) fica FORA do
 * calculo de lucro/margem e e contado a parte, pra nao inflar o lucro.
 */
export async function montarResumoPeriodo(deps: DependenciasApp, inicio: Date, fim: Date) {
  const vendasPeriodo = await deps.db
    .select({
      id: schema.vendas.id,
      ocorridoEm: schema.vendas.ocorridoEm,
      total: schema.vendas.total,
    })
    .from(schema.vendas)
    .where(
      and(
        eq(schema.vendas.status, 'paga'),
        gte(schema.vendas.ocorridoEm, inicio),
        lte(schema.vendas.ocorridoEm, fim),
      ),
    )
    .orderBy(asc(schema.vendas.ocorridoEm))

  const ids = vendasPeriodo.map((v) => v.id)
  const itens =
    ids.length === 0
      ? []
      : await deps.db
          .select({
            produtoId: schema.vendaItens.produtoId,
            descricao: schema.produtos.descricao,
            quantidade: schema.vendaItens.quantidade,
            totalItem: schema.vendaItens.totalItem,
            custoItem: schema.vendaItens.custoUnitario,
            custoCadastro: schema.produtos.custoMedio,
          })
          .from(schema.vendaItens)
          .innerJoin(schema.produtos, eq(schema.produtos.id, schema.vendaItens.produtoId))
          .where(inArray(schema.vendaItens.vendaId, ids))
  const pags =
    ids.length === 0
      ? []
      : await deps.db
          .select({
            forma: schema.pagamentos.forma,
            valor: schema.pagamentos.valor,
            troco: schema.pagamentos.troco,
            terminal: schema.pagamentos.terminalApelido,
          })
          .from(schema.pagamentos)
          .where(inArray(schema.pagamentos.vendaId, ids))

  // Por dia (no fuso da loja).
  const porDiaMapa = new Map<string, { data: string; vendas: number; total: number }>()
  let totalVendido = 0
  for (const v of vendasPeriodo) {
    totalVendido += v.total
    const data = dataLojaIso(v.ocorridoEm)
    const dia = porDiaMapa.get(data) ?? { data, vendas: 0, total: 0 }
    dia.vendas += 1
    dia.total += v.total
    porDiaMapa.set(data, dia)
  }

  // Por produto, com custo/lucro.
  interface LinhaProduto {
    produtoId: string
    descricao: string
    quantidade: number
    faturamento: number
    custo: number | null
    lucro: number | null
  }
  const porProdutoMapa = new Map<string, LinhaProduto>()
  let faturamentoComCusto = 0
  let custoTotal = 0
  let faturamentoSemCusto = 0
  for (const it of itens) {
    const qtd = Number(it.quantidade)
    const custoUnit = it.custoItem > 0 ? it.custoItem : it.custoCadastro
    const linha = porProdutoMapa.get(it.produtoId) ?? {
      produtoId: it.produtoId,
      descricao: it.descricao,
      quantidade: 0,
      faturamento: 0,
      custo: 0,
      lucro: 0,
    }
    linha.quantidade += qtd
    linha.faturamento += it.totalItem
    if (custoUnit > 0 && linha.custo !== null) {
      const custo = Math.round(custoUnit * qtd)
      linha.custo += custo
      custoTotal += custo
      faturamentoComCusto += it.totalItem
    } else {
      // Um item sem custo deixa o produto inteiro "sem custo" (nao mistura).
      if (linha.custo !== null) {
        custoTotal -= linha.custo
        faturamentoComCusto -= linha.faturamento - it.totalItem
        faturamentoSemCusto += linha.faturamento - it.totalItem
      }
      linha.custo = null
      faturamentoSemCusto += it.totalItem
    }
    porProdutoMapa.set(it.produtoId, linha)
  }
  const produtos = [...porProdutoMapa.values()].map((p) => ({
    ...p,
    quantidade: Math.round(p.quantidade * 1000) / 1000,
    lucro: p.custo === null ? null : p.faturamento - p.custo,
    margem:
      p.custo === null || p.faturamento === 0
        ? null
        : Math.round(((p.faturamento - p.custo) / p.faturamento) * 1000) / 10,
  }))
  produtos.sort((a, b) => b.quantidade - a.quantidade || b.faturamento - a.faturamento)

  // Por forma de pagamento (valor liquido de troco) e por maquininha.
  const porPagamentoMapa = new Map<
    string,
    { forma: string; maquininha: string | null; valor: number; quantidade: number }
  >()
  for (const p of pags) {
    const chave = `${p.forma}|${p.terminal ?? ''}`
    const linha = porPagamentoMapa.get(chave) ?? {
      forma: p.forma,
      maquininha: p.terminal,
      valor: 0,
      quantidade: 0,
    }
    linha.valor += p.valor - p.troco
    linha.quantidade += 1
    porPagamentoMapa.set(chave, linha)
  }

  // Cadastro inteiro (nao so o periodo): quantos produtos ativos estao sem
  // custo -- o dono vai completar, e a margem so fica fiel quando chegar a 0.
  const [cadastro] = await deps.db
    .select({ total: count() })
    .from(schema.produtos)
    .where(and(eq(schema.produtos.ativo, true), eq(schema.produtos.custoMedio, 0)))
  const [ativos] = await deps.db
    .select({ total: count() })
    .from(schema.produtos)
    .where(eq(schema.produtos.ativo, true))

  const lucro = faturamentoComCusto - custoTotal
  return {
    cadastro: {
      produtosAtivos: Number(ativos?.total ?? 0),
      produtosAtivosSemCusto: Number(cadastro?.total ?? 0),
    },
    resumo: {
      totalVendido,
      quantidadeVendas: vendasPeriodo.length,
      ticketMedio: vendasPeriodo.length ? Math.round(totalVendido / vendasPeriodo.length) : 0,
      faturamentoComCusto,
      custoTotal,
      lucro,
      margem: faturamentoComCusto ? Math.round((lucro / faturamentoComCusto) * 1000) / 10 : null,
      faturamentoSemCusto,
      produtosSemCusto: produtos.filter((p) => p.custo === null).length,
    },
    porDia: [...porDiaMapa.values()],
    porPagamento: [...porPagamentoMapa.values()].sort((a, b) => b.valor - a.valor),
    produtos,
  }
}

export function registrarRotasRelatorios(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)
  const requireAdmin = criarRequireAuth(deps.sessionSecret, { perfil: 'admin' })

  app.get<{ Querystring: { inicio?: string; fim?: string } }>(
    '/relatorios/resumo',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const parse = QuerySchema.safeParse(request.query)
      if (!parse.success) {
        return reply.code(400).send({
          status: 'erro',
          motivo: 'Parametros invalidos.',
          detalhes: parse.error.flatten(),
        })
      }
      const periodoInicio = inicioDoDiaLoja(parse.data.inicio)
      const periodoFim = fimDoDiaLoja(parse.data.fim)
      if (periodoFim < periodoInicio) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: '"fim" nao pode ser anterior a "inicio".' })
      }
      const dados = await montarResumoPeriodo(deps, periodoInicio, periodoFim)
      return reply.send({ inicio: parse.data.inicio, fim: parse.data.fim, ...dados })
    },
  )

  app.get<{ Querystring: { inicio?: string; fim?: string } }>(
    '/relatorios/vendas.xml',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parse = QuerySchema.safeParse(request.query)
      if (!parse.success) {
        return reply.code(400).send({
          status: 'erro',
          motivo: 'Parametros invalidos.',
          detalhes: parse.error.flatten(),
        })
      }
      const { inicio, fim } = parse.data
      // Dias no horario da LOJA (Brasilia), nao do servidor (UTC): antes,
      // o "dia 24" ia das 21h do dia 23 as 20h59 do dia 24 e as vendas da
      // noite caiam no dia seguinte. `fim` e inclusivo o dia inteiro.
      const periodoInicio = inicioDoDiaLoja(inicio)
      const periodoFim = fimDoDiaLoja(fim)
      if (periodoFim < periodoInicio) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: '"fim" nao pode ser anterior a "inicio".' })
      }

      const vendas = await buscarVendasDoPeriodo(deps, periodoInicio, periodoFim)
      const xml = gerarXmlRelatorioVendas({ periodoInicio, periodoFim, vendas })

      return reply
        .code(200)
        .header('content-type', 'application/xml; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="relatorio-vendas-${inicio}-a-${fim}.xml"`,
        )
        .send(xml)
    },
  )
}
