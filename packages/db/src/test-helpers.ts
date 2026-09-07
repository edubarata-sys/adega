import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema'

/**
 * Banco Postgres em memoria (pglite) para teste de schema e invariantes,
 * sem depender de Docker. Aplica as migrations reais geradas pelo drizzle-kit,
 * entao o que passa aqui e o mesmo SQL que roda em producao.
 *
 * UMA INSTANCIA POR ARQUIVO DE TESTE, nao uma por teste: cada instancia de
 * pglite e um heap WASM que nao e liberado de forma confiavel entre criacoes
 * no mesmo processo, e ambientes com pouca memoria derrubam o worker por
 * volta da 3a instancia sequencial. `limparTabelas` reresolve isolamento
 * entre testes sem pagar o custo (e o risco) de recriar o banco.
 */
export async function bancoDeTeste() {
  const client = new PGlite()
  const db = drizzle(client, { schema, casing: 'snake_case' })

  const dirMigrations = join(import.meta.dirname, '..', 'drizzle')
  const arquivosSql = readdirSync(dirMigrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const arquivo of arquivosSql) {
    const sqlTexto = readFileSync(join(dirMigrations, arquivo), 'utf-8')
    for (const statement of sqlTexto.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed.length > 0) await client.query(trimmed)
    }
  }

  return { db, client }
}

/** Limpa todas as tabelas de dados entre testes, preservando o schema aplicado. */
export async function limparTabelas(client: PGlite) {
  await client.query(`
    TRUNCATE TABLE
      audit_log, pagamentos, conciliacao_itens, conciliacao_lotes,
      venda_itens, vendas, caixa_movimentos, caixa_sessoes,
      estoque_saldos, estoque_movimentos, produtos, categorias,
      dispositivos, usuarios
    RESTART IDENTITY CASCADE
  `)
}

export { sql }
