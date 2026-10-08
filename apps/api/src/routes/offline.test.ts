import { SEED_CREDENCIAIS_DEV, SEED_IDS, schema, seedDados } from '@adega/db'
import { bancoDeTeste, limparTabelas } from '@adega/db/teste'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { horaDaVenda } from './vendas'

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

function novoApp() {
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-offline' })
}
async function cookieAdmin(app: ReturnType<typeof novoApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: SEED_CREDENCIAIS_DEV.adminSenha },
  })
  return { adega_sessao: res.cookies.find((c) => c.name === 'adega_sessao')?.value ?? '' }
}

const CERVEJA = SEED_IDS.produtos.cervejaLata // 550

describe('modo offline (arquitetura §2)', () => {
  it('catalogo do PDV traz os produtos ativos com preco e estoque', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const r = await app.inject({ method: 'GET', url: '/produtos/catalogo-pdv', cookies })
    expect(r.statusCode).toBe(200)
    const cerveja = r.json().produtos.find((p: { id: string }) => p.id === CERVEJA)
    expect(cerveja).toMatchObject({ precoVenda: 550 })
    expect(Object.keys(cerveja).sort()).toEqual([
      'descricao',
      'ean',
      'estoqueAtual',
      'id',
      'precoVenda',
    ])
  })

  it('venda feita offline sobe com a hora do balcao e reenvio nao duplica', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    const id = crypto.randomUUID()
    const quando = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const corpo = {
      id,
      itens: [{ produtoId: CERVEJA, quantidade: 2, precoUnitario: 550 }],
      pagamentos: [{ forma: 'dinheiro', valor: 2000 }],
      ocorridoEm: quando,
    }
    const r1 = await app.inject({ method: 'POST', url: '/vendas', payload: corpo, cookies })
    const r2 = await app.inject({ method: 'POST', url: '/vendas', payload: corpo, cookies })
    expect(r1.statusCode).toBe(201)
    expect(r2.statusCode).toBe(200)
    expect(r2.json().idempotente).toBe(true)
    const linhas = await ctx.db.select().from(schema.vendas).where(eq(schema.vendas.id, id))
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.ocorridoEm.toISOString()).toBe(quando)
  })

  it('recusa venda com hora no futuro', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    const r = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: CERVEJA, quantidade: 1, precoUnitario: 550 }],
        pagamentos: [{ forma: 'pix', valor: 550 }],
        ocorridoEm: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    })
    expect(r.statusCode).toBe(400)
  })

  it('nao fecha o caixa com venda offline na fila', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    const comFila = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      cookies,
      payload: { valorContado: 0, filaPendente: 3 },
    })
    expect(comFila.statusCode).toBe(409)
    const semFila = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      cookies,
      payload: { valorContado: 0, filaPendente: 0 },
    })
    expect(semFila.statusCode).toBe(200)
  })

  it('horaDaVenda tolera relogio um pouco adiantado', () => {
    const agora = new Date('2026-10-08T20:00:00Z')
    expect(horaDaVenda(undefined, agora)).toBe(agora)
    expect(horaDaVenda('2026-10-08T20:05:00Z', agora)).toEqual(agora)
    expect(horaDaVenda('2026-10-08T21:00:00Z', agora)).toBeNull()
    expect(horaDaVenda('2026-10-08T18:00:00Z', agora)?.toISOString()).toBe(
      '2026-10-08T18:00:00.000Z',
    )
  })
})
