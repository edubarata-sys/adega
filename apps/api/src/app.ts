import Fastify, { type FastifyInstance } from 'fastify'

export interface DependenciasApp {
  /** Abstracao minima de banco: soh o suficiente para checar readiness. */
  readonly db: { ping: () => Promise<void> }
  readonly versao: string
}

/**
 * Fabrica da aplicacao Fastify, separada do bootstrap (server.ts).
 *
 * Receber as dependencias por parametro (em vez de importar um client de
 * banco global) e o que permite testar as rotas com `app.inject` sem subir
 * Postgres de verdade -- o teste injeta um `db.ping` fake.
 */
export function buildApp(deps: DependenciasApp): FastifyInstance {
  const app = Fastify({ logger: false })

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
      await deps.db.ping()
      return { status: 'ok' }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      return reply.code(503).send({ status: 'indisponivel', motivo: mensagem })
    }
  })

  return app
}
