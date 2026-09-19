import cookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import type { DependenciasApp } from './dependencias'
import { registrarRotasAuth } from './routes/auth'
import { registrarRotasCaixa } from './routes/caixa'
import { registrarRotasDiagnostico } from './routes/diagnostico'
import { registrarRotasProdutos } from './routes/produtos'
import { registrarRotasRecibo } from './routes/recibo'
import { registrarRotasRelatorios } from './routes/relatorios'
import { registrarRotasVendas } from './routes/vendas'

export type { DependenciasApp } from './dependencias'

/**
 * Fabrica da aplicacao Fastify, separada do bootstrap (server.ts).
 *
 * Receber as dependencias por parametro (em vez de importar um client de
 * banco global) e o que permite testar as rotas com `app.inject` -- contra
 * pglite (ver packages/db/src/test-helpers.ts), nunca contra Postgres real
 * subido de verdade.
 */
export function buildApp(deps: DependenciasApp): FastifyInstance {
  const app = Fastify({ logger: false })

  // Cookie httpOnly de sessao (arquitetura §4). `secret` aqui e so pra
  // suportar cookies ASSINADOS PELO PLUGIN se algum dia forem usados; a
  // sessao em si (seguranca/sessao.ts) tem a propria assinatura HMAC e nao
  // depende deste segredo do plugin.
  app.register(cookie)

  /**
   * Liveness: o processo esta de pe e respondendo. NAO depende do banco.
   * Um orquestrador usa isso para decidir se reinicia o container.
   */
  app.get('/health', async () => {
    return { status: 'ok', versao: deps.versao }
  })

  /**
   * Readiness: o processo esta de pe E consegue falar com o banco.
   * Um orquestrador/balanceador usa isso para decidir se envia trafego.
   * A distincao importa: reiniciar o processo nao resolve o Postgres
   * estar fora do ar, e enviar trafego para um processo sem banco so
   * produz erro 500 em cascata.
   */
  app.get('/health/ready', async (_req, reply) => {
    try {
      await deps.db.execute(sql`select 1`)
      return { status: 'ok' }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      return reply.code(503).send({ status: 'indisponivel', motivo: mensagem })
    }
  })

  registrarRotasAuth(app, deps)
  registrarRotasProdutos(app, deps)
  registrarRotasCaixa(app, deps)
  registrarRotasVendas(app, deps)
  registrarRotasRecibo(app, deps)
  registrarRotasRelatorios(app, deps)
  registrarRotasDiagnostico(app)

  return app
}
