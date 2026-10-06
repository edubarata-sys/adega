import { dataLojaIso } from '@adega/core'
import { schema, SEED_CREDENCIAIS_DEV, SEED_IDS, seedDados } from '@adega/db'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-relatorios' })
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

/** Hoje no calendario da LOJA (Brasilia), AAAA-MM-DD -- as vendas de
 * teste nascem com `ocorridoEm = new Date()` no servidor, e o relatorio
 * corta os dias no horario da loja; usar UTC aqui quebrava o teste a noite. */
function hojeIso(): string {
  return dataLojaIso()
}

describe('GET /relatorios/vendas.xml', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({
      method: 'GET',
      url: `/relatorios/vendas.xml?inicio=${hojeIso()}&fim=${hojeIso()}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('400 quando os parametros de data estao ausentes ou mal formados', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)

    const semParametros = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas.xml',
      cookies,
    })
    expect(semParametros.statusCode).toBe(400)

    const dataInvalida = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas.xml?inicio=10-09-2026&fim=2026-09-30',
      cookies,
    })
    expect(dataInvalida.statusCode).toBe(400)
  })

  it('400 quando fim e anterior a inicio', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas.xml?inicio=2026-09-30&fim=2026-09-01',
      cookies,
    })
    expect(res.statusCode).toBe(400)
  })

  it('periodo sem nenhuma venda gera XML valido com total zero', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'GET',
      url: '/relatorios/vendas.xml?inicio=2020-01-01&fim=2020-01-31',
      cookies,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/xml')
    expect(res.body).toContain('<QuantidadeVendas>0</QuantidadeVendas>')
  })

  it('gera o extrato ponta a ponta: total combinado, por forma e por maquininha, de vendas reais', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { fundoTroco: 0 }, cookies })

    // Venda 1: dinheiro.
    const venda1 = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 2, precoUnitario: 550 }],
        pagamentos: [{ forma: 'dinheiro', valor: 1100 }],
      },
    })
    expect(venda1.statusCode).toBe(201)

    // Venda 2: credito na Maquininha 1.
    const venda2 = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 1, precoUnitario: 550 }],
        pagamentos: [{ forma: 'credito', valor: 550, terminalApelido: 'Maquininha 1' }],
      },
    })
    expect(venda2.statusCode).toBe(201)

    // Venda 3: debito na Maquininha 2.
    const venda3 = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 1, precoUnitario: 550 }],
        pagamentos: [{ forma: 'debito', valor: 550, terminalApelido: 'Maquininha 2' }],
      },
    })
    expect(venda3.statusCode).toBe(201)

    const hoje = hojeIso()
    const res = await app.inject({
      method: 'GET',
      url: `/relatorios/vendas.xml?inicio=${hoje}&fim=${hoje}`,
      cookies,
    })
    expect(res.statusCode).toBe(200)
    const xml = res.body

    // Total combinado das 3 vendas: 1100 + 550 + 550 = 2200 => "22.00".
    expect(xml).toContain('<QuantidadeVendas>3</QuantidadeVendas>')
    expect(xml).toContain('<Total valor="22.00"')

    // Separado por maquininha (o pedido original: "separado por maquininha e junto").
    expect(xml).toContain('<Maquininha apelido="Maquininha 1" quantidade="1" valor="5.50"')
    expect(xml).toContain('<Maquininha apelido="Maquininha 2" quantidade="1" valor="5.50"')

    // Separado por forma de pagamento tambem.
    expect(xml).toContain('<Forma nome="dinheiro" quantidade="1" valor="11.00"')
    expect(xml).toContain('<Forma nome="credito" quantidade="1" valor="5.50"')
    expect(xml).toContain('<Forma nome="debito" quantidade="1" valor="5.50"')

    // A venda em dinheiro nao aparece em PorMaquininha (nao passou por nenhuma).
    expect(xml).not.toMatch(/PorMaquininha[\s\S]*dinheiro[\s\S]*<\/PorMaquininha>/)
  })

  it('divide por via (02/10/2026): venda misturada rateia total e pagamento, e as vias somam o geral', async () => {
    await seedDados(ctx.db)
    // Salgadinho fica como "espetinho" so pra este teste (o seed nao tem espetinho).
    await ctx.db
      .update(schema.produtos)
      .set({ via: 'espetinho' })
      .where(eq(schema.produtos.id, SEED_IDS.produtos.salgadinho))
    await ctx.db
      .update(schema.produtos)
      .set({ via: 'adega' })
      .where(eq(schema.produtos.id, SEED_IDS.produtos.cervejaLata))
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 10000 },
      cookies,
    })

    // R$ 30 de cerveja + R$ 20 de "espetinho", pago com R$ 100 em dinheiro (troco R$ 50).
    const venda = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [
          { produtoId: SEED_IDS.produtos.cervejaLata, quantidade: 6, precoUnitario: 500 },
          { produtoId: SEED_IDS.produtos.salgadinho, quantidade: 2, precoUnitario: 1000 },
        ],
        pagamentos: [{ forma: 'dinheiro', valor: 10000 }],
      },
    })
    expect(venda.statusCode).toBe(201)

    const hoje = hojeIso()
    const baixar = (via: string) =>
      app.inject({
        method: 'GET',
        url: `/relatorios/vendas.xml?inicio=${hoje}&fim=${hoje}&via=${via}`,
        cookies,
      })

    const geral = (await baixar('geral')).body
    expect(geral).toContain('<RelatorioVendas via="Geral">')
    expect(geral).toContain('<Total valor="50.00"')
    // Dinheiro sem o troco: bate com o total.
    expect(geral).toContain('<Forma nome="dinheiro" quantidade="1" valor="50.00"')

    const adega = await baixar('adega')
    expect(adega.headers['content-disposition']).toContain('relatorio-vendas-adega-')
    expect(adega.body).toContain('<Total valor="30.00"')
    expect(adega.body).toContain('<Forma nome="dinheiro" quantidade="1" valor="30.00"')

    const espetinho = (await baixar('espetinho')).body
    expect(espetinho).toContain('<Total valor="20.00"')

    const outros = (await baixar('outros')).body
    expect(outros).toContain('<QuantidadeVendas>0</QuantidadeVendas>')

    const resumo = await app.inject({
      method: 'GET',
      url: `/relatorios/resumo?inicio=${hoje}&fim=${hoje}&via=espetinho`,
      cookies,
    })
    const corpo = resumo.json()
    expect(corpo.resumo.totalVendido).toBe(2000)
    expect(corpo.produtos).toHaveLength(1)
  })
})
