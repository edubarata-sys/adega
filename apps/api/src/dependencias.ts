import type { Executor } from '@adega/db'

/**
 * Dependencias injetadas na app Fastify. Receber por parametro (em vez de
 * importar um client de banco global) e o que permite testar rotas com
 * `app.inject` contra pglite sem subir Postgres de verdade -- o mesmo
 * principio ja usado no healthcheck original, agora estendido pra `db` dar
 * acesso de consulta/escrita completo (nao so `ping`) porque as rotas de
 * negocio precisam disso.
 */
export interface DependenciasApp {
  readonly db: Executor
  readonly versao: string
  /** Segredo HMAC pra assinar/verificar o cookie de sessao. Ver seguranca/sessao.ts. */
  readonly sessionSecret: string
}
