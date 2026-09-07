import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Fabrica UNICA de client Drizzle para producao.
 *
 * `casing: 'snake_case'` tem que ser identico aqui e em qualquer outro lugar
 * que instancie `drizzle()` (inclusive nos testes, ver test-helpers.ts) --
 * a divergencia entre as duas configs foi um bug real encontrado ao rodar
 * o teste de invariante: sem isso, Drizzle gera `senhaHash` em vez de
 * `senha_hash` e a query falha em runtime, nao em typecheck.
 */
export function criarDb(databaseUrl: string) {
  const client = postgres(databaseUrl)
  return drizzle(client, { schema, casing: 'snake_case' })
}

export type Db = ReturnType<typeof criarDb>
