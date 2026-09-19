import { SEED_CREDENCIAIS_DEV, SEED_IDS, seedDados } from '@adega/db'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-consulta' })
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

async function registrarVendaDeTeste(
  app: ReturnType<typeof novoApp>,
  cookies: Record<string, string>,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/vendas',
    cookies,
    payload: {
      itens: [{ produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 2, precoUnitario: 550 }],
      pagamentos: [{ forma: 'dinheiro', valor: 1200 }],
    },
  })
  expect(res.statusCode).toBe(201)
  return res.json().venda.id as string
}

describe('GET /vendas (localizar)', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/vendas' })
    expect(res.statusCode).toBe(401)
  })

  it('lista as vendas mais recentes primeiro', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })

    const primeiraId = await registrarVendaDeTeste(app, cookies)
    const segundaId = await registrarVendaDeTeste(app, cookies)

    const res = await app.inject({ method: 'GET', url: '/vendas', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as {
      vendas: Array<{ id: string; total: number; operadorNome: string }>
    }
    expect(corpo.vendas.map((v) => v.id)).toEqual([segundaId, primeiraId])
    expect(corpo.vendas[0]?.operadorNome).toBe('Admin (seed)')
    expect(corpo.vendas[0]?.total).toBe(1100)
  })

  it('respeita o parametro limite', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    await registrarVendaDeTeste(app, cookies)
    await registrarVendaDeTeste(app, cookies)

    const res = await app.inject({ method: 'GET', url: '/vendas?limite=1', cookies })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { vendas: unknown[] }).vendas).toHaveLength(1)
  })
})

describe('GET /vendas/:id (inspecionar)', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/vendas/qualquer-id' })
    expect(res.statusCode).toBe(401)
  })

  it('responde 404 para venda que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/vendas/00000000-0000-7000-8000-000000000000',
      cookies,
    })
    expect(res.statusCode).toBe(404)
  })

  it('mostra itens, valores, pagamento, operador, caixa e data/hora da venda', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const abertura = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 0 },
      cookies,
    })
    const sessaoCaixaId = abertura.json().sessao.id as string
    const vendaId = await registrarVendaDeTeste(app, cookies)

    const res = await app.inject({ method: 'GET', url: `/vendas/${vendaId}`, cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as {
      venda: { id: string; total: number; ocorridoEm: string }
      operador: { nome: string } | null
      caixaSessao: { id: string } | null
      itens: Array<{ descricao: string; ean: string | null; quantidade: string; totalItem: number }>
      pagamentos: Array<{ forma: string; valor: number; troco: number }>
    }

    expect(corpo.venda.id).toBe(vendaId)
    expect(corpo.venda.total).toBe(1100)
    expect(corpo.venda.ocorridoEm).toBeTruthy()
    expect(corpo.operador?.nome).toBe('Admin (seed)')
    expect(corpo.caixaSessao?.id).toBe(sessaoCaixaId)
    expect(corpo.itens).toHaveLength(1)
    expect(corpo.itens[0]?.descricao).toBe('Cerveja Pilsen Lata 350ml')
    expect(corpo.itens[0]?.ean).toBe('7891000100019')
    expect(Number(corpo.itens[0]?.totalItem)).toBe(1100)
    expect(corpo.pagamentos[0]?.forma).toBe('dinheiro')
    expect(corpo.pagamentos[0]?.valor).toBe(1200)
    expect(corpo.pagamentos[0]?.troco).toBe(100)
  })
})
