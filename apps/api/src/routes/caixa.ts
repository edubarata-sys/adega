import {
  calcularFechamento,
  centavos,
  podeFecharCaixa,
  TIPOS_MOVIMENTO_CAIXA,
  type TipoMovimentoCaixa,
} from '@adega/core'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema } from '@adega/db'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

const TIPOS_VALIDOS = new Set<string>(TIPOS_MOVIMENTO_CAIXA)

async function buscarSessaoAberta(deps: DependenciasApp) {
  const [sessao] = await deps.db
    .select()
    .from(schema.caixaSessoes)
    .where(isNull(schema.caixaSessoes.fechadoEm))
  return sessao ?? null
}

export function registrarRotasCaixa(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  app.get('/caixa/atual', { preHandler: requireAuth }, async () => {
    const sessao = await buscarSessaoAberta(deps)
    return { sessao }
  })

  /**
   * PREMISSA DE TERMINAL UNICO (arquitetura §2.1): so pode existir UMA
   * sessao de caixa aberta por vez em todo o sistema. Isso e o que torna a
   * trava de fechamento (`podeFecharCaixa`) informacao local suficiente --
   * com dois terminais abertos ao mesmo tempo essa premissa (e a trava)
   * deixam de valer, e isso e explicitamente fora de escopo da Fase 1.
   */
  app.post<{ Body: { fundoTroco?: unknown } }>(
    '/caixa/abrir',
    { preHandler: requireAuth },
    async (request, reply) => {
      const fundoTrocoNumero = Number(request.body?.fundoTroco ?? 0)
      if (!Number.isInteger(fundoTrocoNumero) || fundoTrocoNumero < 0) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'fundoTroco precisa ser um inteiro em centavos >= 0.' })
      }

      const jaAberta = await buscarSessaoAberta(deps)
      if (jaAberta) {
        return reply.code(409).send({
          status: 'erro',
          motivo:
            'Ja existe uma sessao de caixa aberta (terminal unico -- feche-a antes de abrir outra).',
          sessaoId: jaAberta.id,
        })
      }

      const [sessao] = await deps.db
        .insert(schema.caixaSessoes)
        .values({
          id: crypto.randomUUID(),
          usuarioAberturaId: request.usuarioAutenticado!.usuarioId,
          abertoEm: new Date(),
          fundoTroco: fundoTrocoNumero,
        })
        .returning()

      return reply.code(201).send({ sessao })
    },
  )

  app.post<{ Body: { tipo?: unknown; valor?: unknown; descricao?: unknown } }>(
    '/caixa/movimentos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const tipo = request.body?.tipo
      const valor = Number(request.body?.valor)
      const descricao = typeof request.body?.descricao === 'string' ? request.body.descricao : ''

      if (typeof tipo !== 'string' || !TIPOS_VALIDOS.has(tipo)) {
        return reply.code(400).send({
          status: 'erro',
          motivo: `tipo precisa ser um de: ${TIPOS_MOVIMENTO_CAIXA.join(', ')}.`,
        })
      }
      if (!Number.isInteger(valor) || valor <= 0) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'valor precisa ser um inteiro em centavos > 0.' })
      }
      if (!descricao.trim()) {
        return reply.code(400).send({ status: 'erro', motivo: 'descricao e obrigatoria.' })
      }

      const sessao = await buscarSessaoAberta(deps)
      if (!sessao) {
        return reply.code(409).send({ status: 'erro', motivo: 'Nenhuma sessao de caixa aberta.' })
      }

      const [movimento] = await deps.db
        .insert(schema.caixaMovimentos)
        .values({
          id: crypto.randomUUID(),
          sessaoId: sessao.id,
          tipo: tipo as TipoMovimentoCaixa,
          valor,
          descricao,
          usuarioId: request.usuarioAutenticado!.usuarioId,
        })
        .returning()

      return reply.code(201).send({ movimento })
    },
  )

  app.post<{ Body: { valorContado?: unknown } }>(
    '/caixa/fechar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const valorContadoNumero = Number(request.body?.valorContado)
      if (!Number.isInteger(valorContadoNumero) || valorContadoNumero < 0) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'valorContado precisa ser um inteiro em centavos >= 0.' })
      }

      const sessao = await buscarSessaoAberta(deps)
      if (!sessao) {
        return reply.code(409).send({ status: 'erro', motivo: 'Nenhuma sessao de caixa aberta.' })
      }

      // PWA/offline esta fora do escopo desta missao (nao existe fila local
      // de dispositivo ainda) -- fila pendente e sempre 0 aqui. Quando a fila
      // offline existir de verdade, o valor vem do dispositivo no corpo do
      // POST, nao um 0 fixo.
      const podeFechar = podeFecharCaixa({ status: 'aberta' }, { vendasPendentesNaFila: 0 })
      if (!podeFechar.ok) {
        return reply.code(409).send({ status: 'erro', motivo: podeFechar.erro.mensagem })
      }

      const [somaLinha] = await deps.db
        .select({
          total: sql<string>`COALESCE(SUM(${schema.pagamentos.valor}), 0)`,
          totalTroco: sql<string>`COALESCE(SUM(${schema.pagamentos.troco}), 0)`,
        })
        .from(schema.pagamentos)
        .innerJoin(schema.vendas, eq(schema.vendas.id, schema.pagamentos.vendaId))
        .where(
          and(eq(schema.vendas.sessaoCaixaId, sessao.id), eq(schema.pagamentos.forma, 'dinheiro')),
        )
      const somaDinheiro = somaLinha?.total ?? '0'
      const totalTroco = somaLinha?.totalTroco ?? '0'

      const movimentosSessao = await deps.db
        .select({ tipo: schema.caixaMovimentos.tipo, valor: schema.caixaMovimentos.valor })
        .from(schema.caixaMovimentos)
        .where(eq(schema.caixaMovimentos.sessaoId, sessao.id))

      // Efeito liquido na gaveta: dinheiro recebido MENOS troco devolvido --
      // troco e dinheiro saindo da gaveta, nao fica registrado como
      // caixa_movimento separado (ja esta em pagamentos.troco).
      const vendasEmDinheiro = centavos(Number(somaDinheiro) - Number(totalTroco))

      const fechamento = calcularFechamento({
        fundoTroco: centavos(sessao.fundoTroco),
        vendasEmDinheiro,
        movimentos: movimentosSessao.map((m) => ({ tipo: m.tipo, valor: centavos(m.valor) })),
        valorContado: centavos(valorContadoNumero),
      })

      const [sessaoFechada] = await deps.db
        .update(schema.caixaSessoes)
        .set({
          fechadoEm: new Date(),
          valorContado: fechamento.contado,
          valorEsperado: fechamento.esperado,
          diferenca: fechamento.diferenca,
          usuarioFechamentoId: request.usuarioAutenticado!.usuarioId,
        })
        .where(eq(schema.caixaSessoes.id, sessao.id))
        .returning()

      return { sessao: sessaoFechada, fechamento }
    },
  )
}
