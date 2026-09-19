import { SEED_CREDENCIAIS_DEV, SEED_IDS, schema, seedDados } from '@adega/db'
import { bancoDeTeste, limparTabelas } from '@adega/db/teste'
import { eq } from 'drizzle-orm'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-vendas' })
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

async function abrirCaixa(app: ReturnType<typeof novoApp>, cookies: Record<string, string>) {
  await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
}

async function saldoDe(produtoId: string): Promise<number> {
  const [linha] = await ctx.db
    .select({ quantidade: schema.estoqueSaldos.quantidade })
    .from(schema.estoqueSaldos)
    .where(eq(schema.estoqueSaldos.produtoId, produtoId))
  return Number(linha?.quantidade ?? 0)
}

const CERVEJA = SEED_IDS.produtos.cervejaLata // preco 550, estoque inicial 120
const AGUA = SEED_IDS.produtos.agua // preco 300, estoque inicial 80
const SALGADINHO = SEED_IDS.produtos.salgadinho // preco 750, estoque inicial 25
const VINHO = SEED_IDS.produtos.vinho // preco 3490, estoque inicial 15

describe('POST /vendas', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'POST', url: '/vendas', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('recusa venda quando nao ha caixa aberto', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: AGUA, quantidade: 1, precoUnitario: 300 }],
        pagamentos: [{ forma: 'dinheiro', valor: 300 }],
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('recusa venda apos o caixa ter sido fechado (caixa inexistente/fechado)', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)
    await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado: 0 },
      cookies,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: AGUA, quantidade: 1, precoUnitario: 300 }],
        pagamentos: [{ forma: 'dinheiro', valor: 300 }],
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('registra venda paga em dinheiro exato (sem troco) e baixa o estoque', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const saldoAntes = await saldoDe(CERVEJA)
    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: CERVEJA, quantidade: 2, precoUnitario: 550 }],
        pagamentos: [{ forma: 'dinheiro', valor: 1100 }],
      },
    })
    expect(res.statusCode).toBe(201)
    const corpo = res.json() as {
      venda: { total: number }
      pagamentos: Array<{ forma: string; valor: number; troco: number }>
    }
    expect(corpo.venda.total).toBe(1100)
    expect(corpo.pagamentos[0]?.troco).toBe(0)
    expect(await saldoDe(CERVEJA)).toBe(saldoAntes - 2)
  })

  it('registra venda paga em cartao manual (debito/credito)', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: AGUA, quantidade: 1, precoUnitario: 300 }],
        pagamentos: [{ forma: 'credito', valor: 300 }],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().pagamentos[0].forma).toBe('credito')
  })

  it('registra venda paga em pix manual', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: SALGADINHO, quantidade: 1, precoUnitario: 750 }],
        pagamentos: [{ forma: 'pix', valor: 750 }],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().pagamentos[0].forma).toBe('pix')
  })

  it('aceita pagamento dividido (split): cartao + dinheiro, com troco so na parcela em dinheiro', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    // total = 3490 (vinho) + 550 (cerveja) = 4040
    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [
          { produtoId: VINHO, quantidade: 1, precoUnitario: 3490 },
          { produtoId: CERVEJA, quantidade: 1, precoUnitario: 550 },
        ],
        pagamentos: [
          { forma: 'credito', valor: 3000 },
          { forma: 'dinheiro', valor: 1200 },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const corpo = res.json() as {
      venda: { total: number }
      pagamentos: Array<{ forma: string; valor: number; troco: number }>
    }
    expect(corpo.venda.total).toBe(4040)
    const credito = corpo.pagamentos.find((p) => p.forma === 'credito')!
    const dinheiro = corpo.pagamentos.find((p) => p.forma === 'dinheiro')!
    expect(credito.troco).toBe(0)
    expect(dinheiro.troco).toBe(160) // (3000 + 1200) - 4040
  })

  it('recusa troco fora do dinheiro: pagamento em cartao nao pode exceder o total', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: AGUA, quantidade: 1, precoUnitario: 300 }],
        pagamentos: [{ forma: 'credito', valor: 500 }],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().codigo).toBe('PAGAMENTO_SEM_TROCO_EXCEDE')
  })

  it('permite vender alem do saldo em estoque (tolerancia a negativo) e o saldo fica negativo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const saldoAntes = await saldoDe(AGUA)
    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: AGUA, quantidade: saldoAntes + 20, precoUnitario: 300 }],
        pagamentos: [{ forma: 'dinheiro', valor: (saldoAntes + 20) * 300 }],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(await saldoDe(AGUA)).toBe(-20)
  })

  it('e idempotente: reenviar a mesma venda (mesmo id) nao processa nem baixa estoque duas vezes', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const vendaId = crypto.randomUUID()
    const payload = {
      id: vendaId,
      itens: [{ produtoId: CERVEJA, quantidade: 1, precoUnitario: 550 }],
      pagamentos: [{ forma: 'dinheiro', valor: 550 }],
    }
    const saldoAntes = await saldoDe(CERVEJA)

    const primeira = await app.inject({ method: 'POST', url: '/vendas', cookies, payload })
    expect(primeira.statusCode).toBe(201)
    expect(await saldoDe(CERVEJA)).toBe(saldoAntes - 1)

    const segunda = await app.inject({ method: 'POST', url: '/vendas', cookies, payload })
    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().idempotente).toBe(true)
    expect(segunda.json().venda.id).toBe(vendaId)
    // Estoque nao foi baixado de novo na retentativa.
    expect(await saldoDe(CERVEJA)).toBe(saldoAntes - 1)
  })

  it('reverte a transacao inteira quando um item referencia produto inexistente', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await abrirCaixa(app, cookies)

    const produtoInexistente = '00000000-0000-7000-8000-0000000000ff'
    const saldoAntes = await saldoDe(AGUA)

    const res = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [
          { produtoId: AGUA, quantidade: 1, precoUnitario: 300 },
          { produtoId: produtoInexistente, quantidade: 1, precoUnitario: 100 },
        ],
        pagamentos: [{ forma: 'dinheiro', valor: 400 }],
      },
    })
    expect(res.statusCode).toBe(500)

    // Nada deve ter sido gravado: nem a venda, nem a baixa do item valido.
    expect(await saldoDe(AGUA)).toBe(saldoAntes)
    const vendas = await ctx.db.select().from(schema.vendas)
    expect(vendas).toHaveLength(0)
  })
})
