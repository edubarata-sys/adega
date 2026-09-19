import { AVISO_SEM_VALOR_FISCAL } from '@adega/core'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-recibo' })
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

describe('GET /vendas/:id/recibo', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/vendas/qualquer-id/recibo' })
    expect(res.statusCode).toBe(401)
  })

  it('responde 404 para venda que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/vendas/00000000-0000-7000-8000-000000000000/recibo',
      cookies,
    })
    expect(res.statusCode).toBe(404)
  })

  it('gera o recibo (texto + bytes ESC/POS) de uma venda de verdade, integrado ponta a ponta', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })

    const venda = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 2, precoUnitario: 550 }],
        pagamentos: [{ forma: 'dinheiro', valor: 1200 }],
      },
    })
    expect(venda.statusCode).toBe(201)
    const vendaId = venda.json().venda.id as string

    const res = await app.inject({ method: 'GET', url: `/vendas/${vendaId}/recibo`, cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { linhas: string[]; escPosBase64: string }

    // O texto do recibo tem que mostrar o produto, o total e o troco reais
    // desta venda -- nao um recibo generico desconectado do que foi vendido.
    expect(corpo.linhas.some((l) => l.includes('Cerveja Pilsen'))).toBe(true)
    expect(corpo.linhas.some((l) => l.includes('R$ 11,00'))).toBe(true) // total
    expect(corpo.linhas.some((l) => l.includes('R$ 1,00'))).toBe(true) // troco (1200 - 1100)
    expect(corpo.linhas.filter((l) => l.includes(AVISO_SEM_VALOR_FISCAL))).toHaveLength(2)

    // Os bytes ESC/POS vem prontos (base64, por causa do transporte JSON) e
    // comecam com o comando de inicializacao da impressora.
    const bytes = Buffer.from(corpo.escPosBase64, 'base64')
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })
})
