import { centavos, gerarXmlRelatorioVendas, type VendaRelatorio } from '@adega/core'
import { schema } from '@adega/db'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
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

/** `fim` e inclusivo o dia inteiro (23:59:59.999), nao so a meia-noite --
 * senao um pedido de "01 a 30" perderia as vendas do proprio dia 30. */
function finalDoDia(dataIso: string): Date {
  const data = new Date(`${dataIso}T00:00:00.000Z`)
  data.setUTCHours(23, 59, 59, 999)
  return data
}

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

export function registrarRotasRelatorios(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

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
      const periodoInicio = new Date(`${inicio}T00:00:00.000Z`)
      const periodoFim = finalDoDia(fim)
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
