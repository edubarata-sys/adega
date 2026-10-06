import {
  competenciaDe,
  dataLojaIso,
  situacaoConta,
  vencimentoFixoNoMes,
  type SituacaoConta,
} from '@adega/core'
import { schema, type Executor } from '@adega/db'
import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

/**
 * Financeiro pessoal do dono (SO admin). A venda de cada caixa fechado entra
 * sozinha como entrada (grupo adega); gastos o dono marca Casa ou Adega;
 * boletos e gastos fixos viram "a pagar" ate ele marcar pago.
 */

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
const GRUPOS = new Set(['adega', 'casa', 'outros'])
const GRUPOS_CONTA = new Set(['adega', 'casa'])

function dataBr(dataIso: string): string {
  return `${dataIso.slice(8, 10)}/${dataIso.slice(5, 7)}`
}

function ultimoDiaDoMes(mes: string): string {
  return vencimentoFixoNoMes(31, mes)
}

/**
 * Cria a entrada "Caixa da adega" pra toda sessao FECHADA que ainda nao tem.
 * Idempotente (unique em sessao_caixa_id + onConflictDoNothing): pode rodar
 * no fechamento e de novo ao abrir o financeiro sem duplicar nada. Sessao
 * sem venda nao gera linha.
 */
export async function sincronizarEntradasCaixa(db: Executor): Promise<number> {
  const pendentes = await db
    .select({
      sessaoId: schema.caixaSessoes.id,
      abertoEm: schema.caixaSessoes.abertoEm,
      total: sql<string>`COALESCE(SUM(${schema.vendas.total}) FILTER (WHERE ${schema.vendas.status} = 'paga'), 0)`,
    })
    .from(schema.caixaSessoes)
    .leftJoin(schema.vendas, eq(schema.vendas.sessaoCaixaId, schema.caixaSessoes.id))
    .where(
      and(
        isNotNull(schema.caixaSessoes.fechadoEm),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.financeiroLancamentos} l WHERE l.sessao_caixa_id = ${schema.caixaSessoes.id})`,
      ),
    )
    .groupBy(schema.caixaSessoes.id, schema.caixaSessoes.abertoEm)

  let criadas = 0
  for (const p of pendentes) {
    const total = Number(p.total)
    if (!(total > 0)) continue
    const data = dataLojaIso(p.abertoEm)
    const linhas = await db
      .insert(schema.financeiroLancamentos)
      .values({
        id: crypto.randomUUID(),
        tipo: 'entrada',
        grupo: 'adega',
        valor: total,
        descricao: `Caixa da adega ${dataBr(data)}`,
        data,
        origem: 'caixa',
        sessaoCaixaId: p.sessaoId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.financeiroLancamentos.id })
    criadas += linhas.length
  }
  return criadas
}

interface ContaPendente {
  readonly contaId: string
  readonly tipo: 'boleto' | 'fixo'
  readonly grupo: 'adega' | 'casa' | 'outros'
  readonly descricao: string
  readonly valor: number
  readonly vencimento: string
  readonly competencia: string
  readonly situacao: SituacaoConta
}

export function registrarRotasFinanceiro(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAdmin = criarRequireAuth(deps.sessionSecret, { perfil: 'admin' })

  app.get<{ Querystring: { mes?: string } }>(
    '/financeiro/resumo',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const hoje = dataLojaIso()
      const mes = request.query.mes ?? competenciaDe(hoje)
      if (!RE_MES.test(mes)) {
        return reply.code(400).send({ status: 'erro', motivo: 'mes precisa ser AAAA-MM.' })
      }

      await sincronizarEntradasCaixa(deps.db)

      const inicio = `${mes}-01`
      const fim = ultimoDiaDoMes(mes)
      const lancamentos = await deps.db
        .select()
        .from(schema.financeiroLancamentos)
        .where(
          and(
            gte(schema.financeiroLancamentos.data, inicio),
            lte(schema.financeiroLancamentos.data, fim),
          ),
        )
        .orderBy(
          desc(schema.financeiroLancamentos.data),
          desc(schema.financeiroLancamentos.criadoEm),
        )

      const totais = { entradaAdega: 0, entradaOutros: 0, saidaAdega: 0, saidaCasa: 0 }
      for (const l of lancamentos) {
        if (l.tipo === 'entrada') {
          if (l.grupo === 'adega') totais.entradaAdega += l.valor
          else totais.entradaOutros += l.valor
        } else if (l.grupo === 'adega') totais.saidaAdega += l.valor
        else totais.saidaCasa += l.valor
      }
      const entradas = totais.entradaAdega + totais.entradaOutros
      const saidas = totais.saidaAdega + totais.saidaCasa

      const contas = await deps.db
        .select()
        .from(schema.financeiroContas)
        .where(eq(schema.financeiroContas.ativo, true))
        .orderBy(schema.financeiroContas.descricao)
      const pagamentos = await deps.db
        .select({
          contaId: schema.financeiroLancamentos.contaId,
          competencia: schema.financeiroLancamentos.competencia,
        })
        .from(schema.financeiroLancamentos)
        .where(isNotNull(schema.financeiroLancamentos.contaId))
      const pagas = new Set(pagamentos.map((p) => `${p.contaId}|${p.competencia}`))
      const boletosPagos = new Set(pagamentos.map((p) => p.contaId))

      const pendentes: ContaPendente[] = []
      for (const c of contas) {
        if (c.tipo === 'boleto') {
          if (!c.vencimento || boletosPagos.has(c.id)) continue
          pendentes.push({
            contaId: c.id,
            tipo: 'boleto',
            grupo: c.grupo,
            descricao: c.descricao,
            valor: c.valor,
            vencimento: c.vencimento,
            competencia: competenciaDe(c.vencimento),
            situacao: situacaoConta(c.vencimento, hoje),
          })
        } else if (c.diaVencimento) {
          if (pagas.has(`${c.id}|${mes}`)) continue
          const vencimento = vencimentoFixoNoMes(c.diaVencimento, mes)
          pendentes.push({
            contaId: c.id,
            tipo: 'fixo',
            grupo: c.grupo,
            descricao: c.descricao,
            valor: c.valor,
            vencimento,
            competencia: mes,
            situacao: situacaoConta(vencimento, hoje),
          })
        }
      }
      pendentes.sort((a, b) => a.vencimento.localeCompare(b.vencimento))

      return {
        mes,
        hoje,
        totais: { ...totais, entradas, saidas, saldo: entradas - saidas },
        lancamentos,
        contasPendentes: pendentes,
        contas,
      }
    },
  )

  app.post<{
    Body: {
      tipo?: unknown
      grupo?: unknown
      valor?: unknown
      descricao?: unknown
      data?: unknown
      origem?: unknown
    }
  }>('/financeiro/lancamentos', { preHandler: requireAdmin }, async (request, reply) => {
    const b = request.body ?? {}
    const tipo = b.tipo
    const grupo = b.grupo
    const valor = Number(b.valor)
    const descricao = typeof b.descricao === 'string' ? b.descricao.trim() : ''
    const data = typeof b.data === 'string' && b.data ? b.data : dataLojaIso()
    const origem = b.origem === 'voz' ? 'voz' : 'manual'

    if (tipo !== 'entrada' && tipo !== 'saida') {
      return reply.code(400).send({ status: 'erro', motivo: 'tipo precisa ser entrada ou saida.' })
    }
    if (typeof grupo !== 'string' || !GRUPOS.has(grupo)) {
      return reply
        .code(400)
        .send({ status: 'erro', motivo: 'grupo precisa ser adega, casa ou outros.' })
    }
    if (tipo === 'saida' && !GRUPOS_CONTA.has(grupo)) {
      return reply.code(400).send({ status: 'erro', motivo: 'Gasto precisa ser Casa ou Adega.' })
    }
    if (!Number.isInteger(valor) || valor <= 0) {
      return reply
        .code(400)
        .send({ status: 'erro', motivo: 'valor precisa ser um inteiro em centavos > 0.' })
    }
    if (!descricao) {
      return reply.code(400).send({ status: 'erro', motivo: 'descricao e obrigatoria.' })
    }
    if (!RE_DATA.test(data)) {
      return reply.code(400).send({ status: 'erro', motivo: 'data precisa ser AAAA-MM-DD.' })
    }

    const [lancamento] = await deps.db
      .insert(schema.financeiroLancamentos)
      .values({
        id: crypto.randomUUID(),
        tipo,
        grupo: grupo as 'adega' | 'casa' | 'outros',
        valor,
        descricao,
        data,
        origem,
        usuarioId: request.usuarioAutenticado!.usuarioId,
      })
      .returning()
    return reply.code(201).send({ lancamento })
  })

  app.delete<{ Params: { id: string } }>(
    '/financeiro/lancamentos/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [atual] = await deps.db
        .select()
        .from(schema.financeiroLancamentos)
        .where(eq(schema.financeiroLancamentos.id, request.params.id))
      if (!atual)
        return reply.code(404).send({ status: 'erro', motivo: 'Lancamento nao encontrado.' })
      if (atual.origem === 'caixa') {
        return reply.code(409).send({
          status: 'erro',
          motivo: 'Entrada do caixa vem sozinha do fechamento e nao pode ser apagada.',
        })
      }
      await deps.db
        .delete(schema.financeiroLancamentos)
        .where(eq(schema.financeiroLancamentos.id, atual.id))
      return { status: 'ok' }
    },
  )

  app.post<{
    Body: {
      tipo?: unknown
      grupo?: unknown
      descricao?: unknown
      valor?: unknown
      vencimento?: unknown
      diaVencimento?: unknown
      codigoBarras?: unknown
    }
  }>('/financeiro/contas', { preHandler: requireAdmin }, async (request, reply) => {
    const b = request.body ?? {}
    const valor = Number(b.valor)
    const descricao = typeof b.descricao === 'string' ? b.descricao.trim() : ''
    if (b.tipo !== 'boleto' && b.tipo !== 'fixo') {
      return reply.code(400).send({ status: 'erro', motivo: 'tipo precisa ser boleto ou fixo.' })
    }
    if (typeof b.grupo !== 'string' || !GRUPOS_CONTA.has(b.grupo)) {
      return reply.code(400).send({ status: 'erro', motivo: 'grupo precisa ser casa ou adega.' })
    }
    if (!descricao) {
      return reply.code(400).send({ status: 'erro', motivo: 'descricao e obrigatoria.' })
    }
    if (!Number.isInteger(valor) || valor <= 0) {
      return reply
        .code(400)
        .send({ status: 'erro', motivo: 'valor precisa ser um inteiro em centavos > 0.' })
    }
    let vencimento: string | null = null
    let diaVencimento: number | null = null
    if (b.tipo === 'boleto') {
      if (typeof b.vencimento !== 'string' || !RE_DATA.test(b.vencimento)) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'boleto precisa de vencimento AAAA-MM-DD.' })
      }
      vencimento = b.vencimento
    } else {
      const dia = Number(b.diaVencimento)
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'gasto fixo precisa de dia de vencimento (1 a 31).' })
      }
      diaVencimento = dia
    }
    const codigoBarras =
      typeof b.codigoBarras === 'string' && b.codigoBarras.trim() ? b.codigoBarras.trim() : null

    const [conta] = await deps.db
      .insert(schema.financeiroContas)
      .values({
        id: crypto.randomUUID(),
        tipo: b.tipo,
        grupo: b.grupo as 'adega' | 'casa',
        descricao,
        valor,
        vencimento,
        diaVencimento,
        codigoBarras,
      })
      .returning()
    return reply.code(201).send({ conta })
  })

  app.delete<{ Params: { id: string } }>(
    '/financeiro/contas/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const [conta] = await deps.db
        .update(schema.financeiroContas)
        .set({ ativo: false })
        .where(eq(schema.financeiroContas.id, request.params.id))
        .returning()
      if (!conta) return reply.code(404).send({ status: 'erro', motivo: 'Conta nao encontrada.' })
      return { status: 'ok' }
    },
  )

  app.post<{
    Params: { id: string }
    Body: { competencia?: unknown; valor?: unknown; data?: unknown }
  }>('/financeiro/contas/:id/pagar', { preHandler: requireAdmin }, async (request, reply) => {
    const [conta] = await deps.db
      .select()
      .from(schema.financeiroContas)
      .where(eq(schema.financeiroContas.id, request.params.id))
    if (!conta) return reply.code(404).send({ status: 'erro', motivo: 'Conta nao encontrada.' })

    const b = request.body ?? {}
    const data = typeof b.data === 'string' && RE_DATA.test(b.data) ? b.data : dataLojaIso()
    const valor = b.valor === undefined || b.valor === null ? conta.valor : Number(b.valor)
    if (!Number.isInteger(valor) || valor <= 0) {
      return reply
        .code(400)
        .send({ status: 'erro', motivo: 'valor precisa ser um inteiro em centavos > 0.' })
    }
    let competencia: string
    if (conta.tipo === 'boleto') {
      competencia = competenciaDe(conta.vencimento ?? data)
    } else {
      competencia =
        typeof b.competencia === 'string' && RE_MES.test(b.competencia)
          ? b.competencia
          : competenciaDe(data)
    }

    const linhas = await deps.db
      .insert(schema.financeiroLancamentos)
      .values({
        id: crypto.randomUUID(),
        tipo: 'saida',
        grupo: conta.grupo,
        valor,
        descricao: conta.descricao,
        data,
        origem: 'conta',
        contaId: conta.id,
        competencia,
        usuarioId: request.usuarioAutenticado!.usuarioId,
      })
      .onConflictDoNothing()
      .returning()
    if (linhas.length === 0) {
      return reply.code(409).send({ status: 'erro', motivo: 'Essa conta ja foi paga nesse mes.' })
    }
    return reply.code(201).send({ lancamento: linhas[0] })
  })
}
