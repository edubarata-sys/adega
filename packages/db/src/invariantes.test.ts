import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as schema from './schema'
import { bancoDeTeste, limparTabelas, sql } from './test-helpers'

/**
 * Prova, contra Postgres real (via pglite), a invariante central do ledger
 * de estoque (arquitetura §3.1):
 *
 *   SUM(estoque_movimentos.quantidade) == estoque_saldos.quantidade
 *
 * E que ela se sustenta MESMO quando movimentos chegam fora de ordem --
 * o cenario normal do sync offline. A prova disso e que soma e comutativa:
 * o resultado nao depende da ordem de aplicacao dos deltas.
 */

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

const UM_USUARIO = '00000000-0000-7000-8000-000000000001'
const UM_PRODUTO = '00000000-0000-7000-8000-000000000002'

async function preparaProdutoEUsuario(db: (typeof ctx)['db']) {
  await db.insert(schema.usuarios).values({
    id: UM_USUARIO,
    nome: 'Admin',
    email: 'admin@adega.local',
    perfil: 'admin',
  })
  await db.insert(schema.produtos).values({
    id: UM_PRODUTO,
    descricao: 'Cerveja Pilsen 600ml',
    precoVenda: 1200,
  })
  await db.insert(schema.estoqueSaldos).values({ produtoId: UM_PRODUTO, quantidade: '0' })
}

/**
 * Aplica um movimento exatamente como o repositorio faria em producao:
 * insert no ledger + upsert no cache, na mesma transacao, via
 * `quantidade = quantidade + delta` (comutativo, arquitetura §3.1).
 */
async function aplicaMovimento(
  db: (typeof ctx)['db'],
  input: { id: string; tipo: 'entrada' | 'venda' | 'ajuste'; delta: number; ocorridoEm: Date },
) {
  await db.transaction(async (tx) => {
    await tx.insert(schema.estoqueMovimentos).values({
      id: input.id,
      produtoId: UM_PRODUTO,
      tipo: input.tipo,
      quantidade: String(input.delta),
      usuarioId: UM_USUARIO,
      ocorridoEm: input.ocorridoEm,
    })
    await tx
      .update(schema.estoqueSaldos)
      .set({
        quantidade: sql`${schema.estoqueSaldos.quantidade} + ${input.delta}`,
        versao: sql`${schema.estoqueSaldos.versao} + 1`,
        atualizadoEm: sql`now()`,
      })
      .where(sql`${schema.estoqueSaldos.produtoId} = ${UM_PRODUTO}`)
  })
}

async function somaDoLedger(db: (typeof ctx)['db']): Promise<number> {
  const [linha] = await db
    .select({ total: sql<string>`COALESCE(SUM(${schema.estoqueMovimentos.quantidade}), 0)` })
    .from(schema.estoqueMovimentos)
    .where(sql`${schema.estoqueMovimentos.produtoId} = ${UM_PRODUTO}`)
  return Number(linha?.total ?? 0)
}

async function saldoDoCache(db: (typeof ctx)['db']): Promise<number> {
  const [linha] = await db
    .select({ quantidade: schema.estoqueSaldos.quantidade })
    .from(schema.estoqueSaldos)
    .where(sql`${schema.estoqueSaldos.produtoId} = ${UM_PRODUTO}`)
  return Number(linha?.quantidade ?? 0)
}

describe('invariante de saldo de estoque (schema real via pglite)', () => {
  it('migration aplica sem erro e cria as 14 tabelas da Fase 1', async () => {
    const { rows } = await ctx.client.query<{ count: string }>(
      `SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public'`,
    )
    expect(Number(rows[0]?.count)).toBe(14)
  })

  it('SUM(movimentos) == saldo apos sequencia em ordem cronologica', async () => {
    await preparaProdutoEUsuario(ctx.db)
    const t0 = new Date('2026-09-01T10:00:00Z')

    await aplicaMovimento(ctx.db, { id: crypto.randomUUID(), tipo: 'entrada', delta: 100, ocorridoEm: t0 })
    await aplicaMovimento(ctx.db, {
      id: crypto.randomUUID(),
      tipo: 'venda',
      delta: -3,
      ocorridoEm: new Date(t0.getTime() + 1000),
    })
    await aplicaMovimento(ctx.db, {
      id: crypto.randomUUID(),
      tipo: 'venda',
      delta: -2,
      ocorridoEm: new Date(t0.getTime() + 2000),
    })

    expect(await saldoDoCache(ctx.db)).toBe(95)
    expect(await somaDoLedger(ctx.db)).toBe(95)
  })

  it('invariante se sustenta com venda chegando FORA DE ORDEM (sync offline)', async () => {
    await preparaProdutoEUsuario(ctx.db)
    const t0 = new Date('2026-09-01T10:00:00Z')

    // Entrada de estoque, registrada normalmente.
    await aplicaMovimento(ctx.db, { id: crypto.randomUUID(), tipo: 'entrada', delta: 50, ocorridoEm: t0 })

    // Venda das 20h chega ANTES (o caixa sincronizou primeiro).
    await aplicaMovimento(ctx.db, {
      id: crypto.randomUUID(),
      tipo: 'venda',
      delta: -10,
      ocorridoEm: new Date('2026-09-01T20:00:00Z'),
    })

    // Venda das 18h chega DEPOIS (dispositivo ficou offline e so sincronizou agora).
    // Nao existe `saldo_apos` para reescrever -- e exatamente o ponto da arquitetura.
    await aplicaMovimento(ctx.db, {
      id: crypto.randomUUID(),
      tipo: 'venda',
      delta: -5,
      ocorridoEm: new Date('2026-09-01T18:00:00Z'),
    })

    const esperado = 50 - 10 - 5
    expect(await saldoDoCache(ctx.db)).toBe(esperado)
    expect(await somaDoLedger(ctx.db)).toBe(esperado)
  })

  it('concorrencia: dois movimentos simultaneos nao se perdem (row lock do UPDATE serializa)', async () => {
    await preparaProdutoEUsuario(ctx.db)
    const t0 = new Date('2026-09-01T10:00:00Z')

    // 20 vendas de 1 unidade "simultaneas" -- simula duas abas/retries do mesmo
    // dispositivo tentando sincronizar ao mesmo tempo. Read-modify-write em
    // memoria perderia updates aqui; UPDATE ... SET x = x + delta nao perde.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        aplicaMovimento(ctx.db, {
          id: crypto.randomUUID(),
          tipo: 'venda',
          delta: -1,
          ocorridoEm: new Date(t0.getTime() + i * 1000),
        }),
      ),
    )

    expect(await saldoDoCache(ctx.db)).toBe(-20)
    expect(await somaDoLedger(ctx.db)).toBe(-20)
  })

  it('ledger e apendice: linha de movimento nunca e alterada ou removida por outro insert', async () => {
    await preparaProdutoEUsuario(ctx.db)
    const id = crypto.randomUUID()
    await aplicaMovimento(ctx.db, { id, tipo: 'entrada', delta: 10, ocorridoEm: new Date() })

    const [linha] = await ctx.db
      .select()
      .from(schema.estoqueMovimentos)
      .where(sql`${schema.estoqueMovimentos.id} = ${id}`)

    expect(linha).toBeDefined()
    expect(Number(linha!.quantidade)).toBe(10)
    // Nao ha coluna "saldo_apos" no schema: a ausencia e a garantia.
    expect(Object.keys(linha!)).not.toContain('saldoApos')
  })
})
