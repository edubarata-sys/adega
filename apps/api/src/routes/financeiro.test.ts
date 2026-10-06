import { SEED_CREDENCIAIS_DEV, SEED_IDS, schema, seedDados } from '@adega/db'
import { bancoDeTeste, limparTabelas } from '@adega/db/teste'
import { dataLojaIso } from '@adega/core'
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
  return buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-teste-fin' })
}

async function cookieAdmin(app: ReturnType<typeof novoApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: SEED_CREDENCIAIS_DEV.adminEmail, senha: SEED_CREDENCIAIS_DEV.adminSenha },
  })
  return { adega_sessao: res.cookies.find((c) => c.name === 'adega_sessao')?.value ?? '' }
}

async function cookieOperador(app: ReturnType<typeof novoApp>) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/pin',
    payload: { usuarioId: SEED_IDS.usuarioOperador, pin: SEED_CREDENCIAIS_DEV.operadorPin },
  })
  return { adega_sessao: res.cookies.find((c) => c.name === 'adega_sessao')?.value ?? '' }
}

async function venderNaSessao(sessaoCaixaId: string, total: number, status = 'paga' as const) {
  await ctx.db.insert(schema.vendas).values({
    id: crypto.randomUUID(),
    sessaoCaixaId,
    usuarioId: SEED_IDS.usuarioAdmin,
    status,
    subtotal: total,
    total,
    ocorridoEm: new Date(),
  })
}

const mes = dataLojaIso().slice(0, 7)

describe('financeiro pessoal', () => {
  it('so admin acessa', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    expect((await app.inject({ method: 'GET', url: '/financeiro/resumo' })).statusCode).toBe(401)
    const cookies = await cookieOperador(app)
    const res = await app.inject({ method: 'GET', url: '/financeiro/resumo', cookies })
    expect(res.statusCode).toBe(403)
  })

  it('fechar o caixa lanca a venda do dia como entrada da adega, uma vez so', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const abrir = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      cookies,
      payload: { fundoTroco: 0 },
    })
    const sessaoId = abrir.json().sessao.id as string
    await venderNaSessao(sessaoId, 15000)
    await venderNaSessao(sessaoId, 2500)
    const fechar = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      cookies,
      payload: { valorContado: 0 },
    })
    expect(fechar.statusCode).toBe(200)

    const r1 = await app.inject({ method: 'GET', url: `/financeiro/resumo?mes=${mes}`, cookies })
    const r2 = await app.inject({ method: 'GET', url: `/financeiro/resumo?mes=${mes}`, cookies })
    expect(r1.statusCode).toBe(200)
    const corpo = r2.json()
    const doCaixa = corpo.lancamentos.filter((l: { origem: string }) => l.origem === 'caixa')
    expect(doCaixa).toHaveLength(1)
    expect(doCaixa[0].valor).toBe(17500)
    expect(corpo.totais.entradaAdega).toBe(17500)

    const apagar = await app.inject({
      method: 'DELETE',
      url: `/financeiro/lancamentos/${doCaixa[0].id}`,
      cookies,
    })
    expect(apagar.statusCode).toBe(409)
  })

  it('gasto casa/adega, entrada de fora e saldo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const lancar = (payload: object) =>
      app.inject({ method: 'POST', url: '/financeiro/lancamentos', cookies, payload })

    expect(
      (
        await lancar({
          tipo: 'saida',
          grupo: 'casa',
          valor: 8000,
          descricao: 'Mercado',
          origem: 'voz',
        })
      ).statusCode,
    ).toBe(201)
    expect(
      (await lancar({ tipo: 'saida', grupo: 'adega', valor: 30000, descricao: 'Gelo' })).statusCode,
    ).toBe(201)
    expect(
      (await lancar({ tipo: 'entrada', grupo: 'outros', valor: 150000, descricao: 'Seguro' }))
        .statusCode,
    ).toBe(201)
    expect(
      (await lancar({ tipo: 'saida', grupo: 'outros', valor: 100, descricao: 'x' })).statusCode,
    ).toBe(400)
    expect(
      (await lancar({ tipo: 'saida', grupo: 'casa', valor: 12.5, descricao: 'x' })).statusCode,
    ).toBe(400)

    const t = (
      await app.inject({ method: 'GET', url: `/financeiro/resumo?mes=${mes}`, cookies })
    ).json().totais
    expect(t).toMatchObject({
      entradaOutros: 150000,
      saidaCasa: 8000,
      saidaAdega: 30000,
      saldo: 112000,
    })
  })

  it('gasto fixo fica pendente ate pagar e boleto some depois de pago', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const fixo = await app.inject({
      method: 'POST',
      url: '/financeiro/contas',
      cookies,
      payload: {
        tipo: 'fixo',
        grupo: 'casa',
        descricao: 'Aluguel',
        valor: 120000,
        diaVencimento: 10,
      },
    })
    expect(fixo.statusCode).toBe(201)
    const boleto = await app.inject({
      method: 'POST',
      url: '/financeiro/contas',
      cookies,
      payload: {
        tipo: 'boleto',
        grupo: 'adega',
        descricao: 'Ambev',
        valor: 54000,
        vencimento: `${mes}-15`,
      },
    })
    expect(boleto.statusCode).toBe(201)

    let r = (
      await app.inject({ method: 'GET', url: `/financeiro/resumo?mes=${mes}`, cookies })
    ).json()
    expect(r.contasPendentes.map((c: { descricao: string }) => c.descricao)).toEqual([
      'Aluguel',
      'Ambev',
    ])
    expect(r.contasPendentes[0].vencimento).toBe(`${mes}-10`)

    const idFixo = fixo.json().conta.id
    const pagar = await app.inject({
      method: 'POST',
      url: `/financeiro/contas/${idFixo}/pagar`,
      cookies,
      payload: { competencia: mes, valor: 125000 },
    })
    expect(pagar.statusCode).toBe(201)
    const deNovo = await app.inject({
      method: 'POST',
      url: `/financeiro/contas/${idFixo}/pagar`,
      cookies,
      payload: { competencia: mes },
    })
    expect(deNovo.statusCode).toBe(409)
    await app.inject({
      method: 'POST',
      url: `/financeiro/contas/${boleto.json().conta.id}/pagar`,
      cookies,
      payload: {},
    })

    r = (await app.inject({ method: 'GET', url: `/financeiro/resumo?mes=${mes}`, cookies })).json()
    expect(r.contasPendentes).toHaveLength(0)
    expect(r.totais.saidaCasa).toBe(125000)
    expect(r.totais.saidaAdega).toBe(54000)
  })
})
