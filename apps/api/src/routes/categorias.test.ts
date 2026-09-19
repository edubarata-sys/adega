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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-categorias' })
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

describe('GET /categorias', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/categorias' })
    expect(res.statusCode).toBe(401)
  })

  it('lista as categorias existentes (seed cria "Geral (seed)")', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/categorias', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { categorias: Array<{ nome: string }> }
    expect(corpo.categorias.some((c) => c.nome === 'Geral (seed)')).toBe(true)
  })
})

describe('POST /categorias', () => {
  it('cria uma categoria nova e ela aparece na listagem', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const criar = await app.inject({
      method: 'POST',
      url: '/categorias',
      cookies,
      payload: { nome: 'Vinhos' },
    })
    expect(criar.statusCode).toBe(201)

    const lista = await app.inject({ method: 'GET', url: '/categorias', cookies })
    const corpo = lista.json() as { categorias: Array<{ nome: string }> }
    expect(corpo.categorias.some((c) => c.nome === 'Vinhos')).toBe(true)
  })

  it('400 quando nome esta vazio', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/categorias',
      cookies,
      payload: { nome: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})
