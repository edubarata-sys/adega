import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as schema from './schema'
import { seedDados, SEED_CREDENCIAIS_DEV, SEED_IDS } from './seed'
import { verificarSenha } from './senha'
import { bancoDeTeste, limparTabelas } from './test-helpers'

let ctx: Awaited<ReturnType<typeof bancoDeTeste>>

beforeAll(async () => {
  ctx = await bancoDeTeste()
})

afterEach(async () => {
  await limparTabelas(ctx.client)
})

afterAll(async () => {
  await ctx.client.close()
})

describe('seedDados', () => {
  it('cria admin, operador, dispositivo, categoria e 5 produtos com estoque', async () => {
    await seedDados(ctx.db)

    const usuarios = await ctx.db.select().from(schema.usuarios)
    expect(usuarios).toHaveLength(2)

    const admin = usuarios.find((u) => u.id === SEED_IDS.usuarioAdmin)
    expect(admin?.perfil).toBe('admin')
    expect(admin?.senhaHash).toBeTruthy()
    expect(await verificarSenha(admin!.senhaHash!, SEED_CREDENCIAIS_DEV.adminSenha)).toBe(true)

    const operador = usuarios.find((u) => u.id === SEED_IDS.usuarioOperador)
    expect(operador?.perfil).toBe('caixa')
    expect(await verificarSenha(operador!.pinHash!, SEED_CREDENCIAIS_DEV.operadorPin)).toBe(true)

    const produtos = await ctx.db.select().from(schema.produtos)
    expect(produtos).toHaveLength(5)
    expect(produtos.every((p) => p.ean)).toBe(true)
    expect(new Set(produtos.map((p) => p.ean)).size).toBe(5) // EANs distintos

    const saldos = await ctx.db.select().from(schema.estoqueSaldos)
    expect(saldos.every((s) => Number(s.quantidade) > 0)).toBe(true)
  })

  it('mantem a invariante SUM(movimentos) == saldo apos o seed', async () => {
    await seedDados(ctx.db)

    const produtos = await ctx.db.select().from(schema.produtos)
    for (const produto of produtos) {
      const [somaLedger] = await ctx.db
        .select({ total: sql<string>`COALESCE(SUM(${schema.estoqueMovimentos.quantidade}), 0)` })
        .from(schema.estoqueMovimentos)
        .where(eq(schema.estoqueMovimentos.produtoId, produto.id))
      const [saldoCache] = await ctx.db
        .select({ quantidade: schema.estoqueSaldos.quantidade })
        .from(schema.estoqueSaldos)
        .where(eq(schema.estoqueSaldos.produtoId, produto.id))

      expect(Number(saldoCache?.quantidade)).toBe(Number(somaLedger?.total))
    }
  })

  it('e idempotente: rodar duas vezes nao duplica usuarios, produtos nem estoque', async () => {
    await seedDados(ctx.db)
    await seedDados(ctx.db)

    const usuarios = await ctx.db.select().from(schema.usuarios)
    const produtos = await ctx.db.select().from(schema.produtos)
    const saldos = await ctx.db.select().from(schema.estoqueSaldos)

    expect(usuarios).toHaveLength(2)
    expect(produtos).toHaveLength(5)
    // Estoque nao dobra na segunda chamada -- a entrada inicial so acontece
    // quando ainda nao existe saldo pro produto.
    const saldoCerveja = saldos.find((s) => s.produtoId === SEED_IDS.produtos.cervejaLata)
    expect(Number(saldoCerveja?.quantidade)).toBe(120)
  })
})
