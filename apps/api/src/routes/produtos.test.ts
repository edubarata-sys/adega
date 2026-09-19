import { SEED_CREDENCIAIS_DEV, seedDados } from '@adega/db'
import { bancoDeTeste, limparTabelas } from '@adega/db/teste'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app'

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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-produtos' })
}

async function cookieAdmin(app: ReturnType<typeof novoApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: SEED_CREDENCIAIS_DEV.adminSenha },
  })
  const cookie = res.cookies.find((c) => c.name === 'adega_sessao')?.value ?? ''
  return { adega_sessao: cookie }
}

describe('GET /produtos/ean/:ean', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/produtos/ean/7891000100019' })
    expect(res.statusCode).toBe(401)
  })

  it('encontra produto pelo EAN com estoque e preco', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)

    const res = await app.inject({ method: 'GET', url: '/produtos/ean/7891000100019', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(corpo.produto.descricao).toBe('Cerveja Pilsen Lata 350ml')
    expect(corpo.produto.precoVenda).toBe(550)
    expect(Number(corpo.produto.estoqueAtual)).toBe(120)
  })

  it('responde 404 para EAN que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/produtos/ean/0000000000000', cookies })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /produtos?q=', () => {
  it('busca por descricao parcial, case-insensitive', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)

    const res = await app.inject({ method: 'GET', url: '/produtos?q=cerveja', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produtos: Array<Record<string, unknown>> }
    expect(corpo.produtos).toHaveLength(1)
    expect(corpo.produtos[0]?.descricao).toBe('Cerveja Pilsen Lata 350ml')
  })

  it('recusa termo de busca curto demais', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/produtos?q=c', cookies })
    expect(res.statusCode).toBe(400)
  })

  it('retorna lista vazia quando nada bate com o termo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/produtos?q=inexistente-xyz', cookies })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { produtos: unknown[] }).produtos).toHaveLength(0)
  })
})

describe('GET /produtos/:id', () => {
  it('responde 404 para id que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/produtos/00000000-0000-7000-8000-000000000000',
      cookies,
    })
    expect(res.statusCode).toBe(404)
  })
})
