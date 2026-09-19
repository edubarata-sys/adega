import { SEED_CREDENCIAIS_DEV, SEED_IDS, schema, seedDados } from '@adega/db'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-caixa' })
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

/**
 * Insere uma venda + pagamento em DINHEIRO direto no banco, simulando o que
 * PASSO 5 (venda transacional) vai produzir de verdade. Nao existe rota de
 * venda ainda -- aqui so precisamos de uma linha de pagamento em dinheiro
 * ligada a sessao de caixa pra exercitar o calculo de fechamento.
 */
async function inserirVendaEmDinheiro(sessaoCaixaId: string, valor: number, troco: number) {
  const vendaId = crypto.randomUUID()
  await ctx.db.insert(schema.vendas).values({
    id: vendaId,
    sessaoCaixaId,
    usuarioId: SEED_IDS.usuarioAdmin,
    status: 'paga',
    subtotal: valor,
    total: valor,
    ocorridoEm: new Date(),
  })
  await ctx.db.insert(schema.pagamentos).values({
    id: crypto.randomUUID(),
    vendaId,
    forma: 'dinheiro',
    valor: valor + troco,
    troco,
  })
}

describe('GET /caixa/atual', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({ method: 'GET', url: '/caixa/atual' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna sessao nula quando nenhum caixa esta aberto', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/caixa/atual', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json().sessao).toBeNull()
  })
})

describe('POST /caixa/abrir', () => {
  it('abre uma sessao de caixa com fundo de troco', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 10000 },
      cookies,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().sessao.fundoTroco).toBe(10000)
    expect(res.json().sessao.fechadoEm).toBeNull()
  })

  it('recusa fundoTroco negativo ou nao inteiro', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: -5 },
      cookies,
    })
    expect(res.statusCode).toBe(400)
  })

  it('respeita premissa de terminal unico: recusa abrir com sessao ja aberta', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })

    const res = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 0 },
      cookies,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().sessaoId).toBeDefined()
  })
})

describe('POST /caixa/movimentos', () => {
  it('recusa quando nao ha caixa aberto', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { tipo: 'suprimento', valor: 1000, descricao: 'reforco' },
      cookies,
    })
    expect(res.statusCode).toBe(409)
  })

  it('recusa tipo invalido', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { tipo: 'deposito-bancario', valor: 1000, descricao: 'x' },
      cookies,
    })
    expect(res.statusCode).toBe(400)
  })

  it('registra suprimento, sangria e despesa numa sessao aberta', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })

    for (const tipo of ['suprimento', 'sangria', 'despesa'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/caixa/movimentos',
        payload: { tipo, valor: 500, descricao: `teste ${tipo}` },
        cookies,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().movimento.tipo).toBe(tipo)
    }
  })
})

describe('POST /caixa/fechar', () => {
  it('recusa quando nao ha caixa aberto', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado: 0 },
      cookies,
    })
    expect(res.statusCode).toBe(409)
  })

  it('calcula fechamento cego: fundo + vendas em dinheiro (liquidas de troco) + suprimento - sangria', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const abertura = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 10000 },
      cookies,
    })
    const sessaoId = abertura.json().sessao.id as string

    // Venda de 5000 paga com 6000 em dinheiro (1000 de troco) -> entra liquido 5000 na gaveta.
    await inserirVendaEmDinheiro(sessaoId, 5000, 1000)
    // Venda de 2000 paga exata, sem troco.
    await inserirVendaEmDinheiro(sessaoId, 2000, 0)

    await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { tipo: 'suprimento', valor: 3000, descricao: 'reforco de troco' },
      cookies,
    })
    await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { tipo: 'sangria', valor: 4000, descricao: 'retirada para cofre' },
      cookies,
    })

    // esperado = 10000 (fundo) + 5000 + 2000 (vendas liquidas) + 3000 (suprimento) - 4000 (sangria) = 16000
    const res = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado: 16000 },
      cookies,
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as {
      fechamento: { esperado: number; contado: number; diferenca: number }
    }
    expect(corpo.fechamento.esperado).toBe(16000)
    expect(corpo.fechamento.contado).toBe(16000)
    expect(corpo.fechamento.diferenca).toBe(0)
  })

  it('registra diferenca (falta/sobra) quando contado diverge do esperado', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 5000 },
      cookies,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado: 4500 },
      cookies,
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { fechamento: { esperado: number; diferenca: number } }
    expect(corpo.fechamento.esperado).toBe(5000)
    expect(corpo.fechamento.diferenca).toBe(-500)
  })

  it('depois de fechar, terminal unico permite abrir uma nova sessao', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })
    await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado: 0 },
      cookies,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 0 },
      cookies,
    })
    expect(res.statusCode).toBe(201)
  })
})
