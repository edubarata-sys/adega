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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-auth' })
}

describe('POST /auth/login', () => {
  it('aceita credenciais corretas e seta cookie de sessao', async () => {
    await seedDados(ctx.db)
    const app = novoApp()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: SEED_CREDENCIAIS_DEV.adminSenha },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().usuario.perfil).toBe('admin')
    const cookieSessao = res.cookies.find((c) => c.name === 'adega_sessao')
    expect(cookieSessao).toBeDefined()
    expect(cookieSessao?.httpOnly).toBe(true)
  })

  it('recusa senha errada', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: 'senha-errada' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('recusa email que nao existe (mesma resposta de senha errada)', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-existe@adega.local', senha: 'qualquer' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('recusa corpo sem email/senha', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /auth/operadores', () => {
  it('lista o operador seedado, sem expor hash de PIN', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/auth/operadores' })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { operadores: Array<Record<string, unknown>> }
    expect(corpo.operadores).toHaveLength(1)
    expect(corpo.operadores[0]).not.toHaveProperty('pinHash')
    expect(corpo.operadores[0]?.nome).toBe(SEED_CREDENCIAIS_DEV.operadorNome)
  })
})

describe('POST /auth/pin', () => {
  it('aceita PIN correto do operador seedado', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const operadores = (await app.inject({ method: 'GET', url: '/auth/operadores' })).json() as {
      operadores: Array<{ id: string }>
    }
    const res = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { usuarioId: operadores.operadores[0]?.id, pin: SEED_CREDENCIAIS_DEV.operadorPin },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().usuario.perfil).toBe('caixa')
  })

  it('recusa PIN errado', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const operadores = (await app.inject({ method: 'GET', url: '/auth/operadores' })).json() as {
      operadores: Array<{ id: string }>
    }
    const res = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { usuarioId: operadores.operadores[0]?.id, pin: '000000' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /auth/eu', () => {
  it('recusa requisicao sem cookie de sessao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/auth/eu' })
    expect(res.statusCode).toBe(401)
  })

  it('identifica o usuario a partir do cookie emitido pelo login', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: SEED_CREDENCIAIS_DEV.adminSenha },
    })
    const cookieSessao = login.cookies.find((c) => c.name === 'adega_sessao')

    const res = await app.inject({
      method: 'GET',
      url: '/auth/eu',
      cookies: { adega_sessao: cookieSessao?.value ?? '' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().usuario.perfil).toBe('admin')
  })
})

describe('POST /auth/logout', () => {
  it('limpa o cookie de sessao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(200)
    const cookieSessao = res.cookies.find((c) => c.name === 'adega_sessao')
    expect(cookieSessao?.value).toBe('')
  })
})
