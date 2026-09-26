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

  it('busca por palavras em qualquer ordem, sem acento', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    for (const q of ['lata cerveja', 'CERVÉJA pilsen', 'pilsen 350']) {
      const res = await app.inject({
        method: 'GET',
        url: `/produtos?q=${encodeURIComponent(q)}`,
        cookies,
      })
      expect(res.statusCode).toBe(200)
      const corpo = res.json() as { produtos: Array<Record<string, unknown>> }
      expect(corpo.produtos.map((p) => p.descricao)).toContain('Cerveja Pilsen Lata 350ml')
    }
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

describe('GET /produtos/cadastro', () => {
  it('lista produtos sem exigir termo de busca, incluindo inativos', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)

    await app.inject({
      method: 'PUT',
      url: `/produtos/${SEED_IDS.produtos.agua}`,
      cookies,
      payload: { descricao: 'Agua Mineral 500ml', precoVenda: 300, ativo: false },
    })

    const res = await app.inject({ method: 'GET', url: '/produtos/cadastro', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produtos: Array<{ id: string; ativo: boolean }> }
    expect(corpo.produtos.length).toBeGreaterThanOrEqual(5)
    expect(corpo.produtos.some((p) => p.id === SEED_IDS.produtos.agua && p.ativo === false)).toBe(
      true,
    )
  })

  it('filtra por descricao quando "q" e informado', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({ method: 'GET', url: '/produtos/cadastro?q=cerveja', cookies })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produtos: Array<{ descricao: string }> }
    expect(corpo.produtos).toHaveLength(1)
    expect(corpo.produtos[0]?.descricao).toBe('Cerveja Pilsen Lata 350ml')
  })
})

describe('POST /produtos', () => {
  it('recusa sem autenticacao', async () => {
    const app = novoApp()
    const res = await app.inject({
      method: 'POST',
      url: '/produtos',
      payload: { descricao: 'Teste', precoVenda: 100 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('cria um produto novo com saldo de estoque zerado', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Cerveja Long Neck 355ml', ean: '7891000109999', precoVenda: 800 },
    })
    expect(res.statusCode).toBe(201)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(corpo.produto.descricao).toBe('Cerveja Long Neck 355ml')
    expect(Number(corpo.produto.estoqueAtual)).toBe(0)
  })

  it('cria com estoque inicial, registrando o movimento (nao um atalho de saldo)', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: {
        descricao: 'Whisky Nacional 1L',
        precoVenda: 4500,
        estoqueInicial: 6,
      },
    })
    expect(res.statusCode).toBe(201)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(Number(corpo.produto.estoqueAtual)).toBe(6)
  })

  it('aceita EAN repetido (mesmo codigo em mais de um produto)', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Duplicado', ean: '7891000100019', precoVenda: 100 },
    })
    expect(res.statusCode).toBe(201)
    const busca = await app.inject({ method: 'GET', url: '/produtos/ean/7891000100019', cookies })
    expect(busca.statusCode).toBe(200)
    expect(busca.json().produtos.length).toBe(2)
  })

  it('400 quando falta descricao ou o preco e invalido', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: '', precoVenda: -10 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /produtos/:id', () => {
  it('edita descricao e preco sem mexer no estoque', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'PUT',
      url: `/produtos/${SEED_IDS.produtos.cervejaLata}`,
      cookies,
      payload: { descricao: 'Cerveja Pilsen Lata 350ml (editado)', precoVenda: 600 },
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(corpo.produto.descricao).toBe('Cerveja Pilsen Lata 350ml (editado)')
    expect(corpo.produto.precoVenda).toBe(600)
    expect(Number(corpo.produto.estoqueAtual)).toBe(120) // inalterado
  })

  it('desativa e reativa um produto via campo ativo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    await app.inject({
      method: 'PUT',
      url: `/produtos/${SEED_IDS.produtos.agua}`,
      cookies,
      payload: { descricao: 'Agua Mineral 500ml', precoVenda: 300, ativo: false },
    })
    const buscaDesativado = await app.inject({
      method: 'GET',
      url: '/produtos/ean/7891000100033',
      cookies,
    })
    expect(buscaDesativado.statusCode).toBe(404) // desativado some da busca do PDV

    await app.inject({
      method: 'PUT',
      url: `/produtos/${SEED_IDS.produtos.agua}`,
      cookies,
      payload: { descricao: 'Agua Mineral 500ml', precoVenda: 300, ativo: true },
    })
    const buscaReativado = await app.inject({
      method: 'GET',
      url: '/produtos/ean/7891000100033',
      cookies,
    })
    expect(buscaReativado.statusCode).toBe(200)
  })

  it('404 para produto que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'PUT',
      url: '/produtos/00000000-0000-7000-8000-000000000000',
      cookies,
      payload: { descricao: 'X', precoVenda: 100 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /produtos/:id/estoque', () => {
  it('entrada soma ao saldo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: `/produtos/${SEED_IDS.produtos.cervejaLata}/estoque`,
      cookies,
      payload: { tipo: 'entrada', quantidade: 24, observacao: 'Compra do fornecedor' },
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(Number(corpo.produto.estoqueAtual)).toBe(144) // 120 + 24
  })

  it('perda sempre subtrai, mesmo se mandarem quantidade negativa por engano', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: `/produtos/${SEED_IDS.produtos.cervejaLata}/estoque`,
      cookies,
      payload: { tipo: 'perda', quantidade: 5 },
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(Number(corpo.produto.estoqueAtual)).toBe(115) // 120 - 5
  })

  it('ajuste aceita delta negativo pra corrigir contagem fisica pra baixo', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: `/produtos/${SEED_IDS.produtos.cervejaLata}/estoque`,
      cookies,
      payload: { tipo: 'ajuste', quantidade: -3 },
    })
    expect(res.statusCode).toBe(200)
    const corpo = res.json() as { produto: Record<string, unknown> }
    expect(Number(corpo.produto.estoqueAtual)).toBe(117) // 120 - 3
  })

  it('400 quando "entrada"/"perda" vem com quantidade negativa', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: `/produtos/${SEED_IDS.produtos.cervejaLata}/estoque`,
      cookies,
      payload: { tipo: 'entrada', quantidade: -5 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 para produto que nao existe', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: '/produtos/00000000-0000-7000-8000-000000000000/estoque',
      cookies,
      payload: { tipo: 'entrada', quantidade: 1 },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /produtos/ean/:ean -- variantes UPC-A / EAN-13', () => {
  it('acha produto cadastrado com UPC-A (12 digitos) quando a pistola le EAN-13 com zero na frente', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const criado = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Whisky Importado 1L', ean: '082184000328', precoVenda: 15990 },
    })
    expect(criado.statusCode).toBe(201)

    const res = await app.inject({ method: 'GET', url: '/produtos/ean/0082184000328', cookies })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { produto: { descricao: string } }).produto.descricao).toBe(
      'Whisky Importado 1L',
    )
  })
})

describe('GET /produtos/eans', () => {
  it('devolve so EANs de produtos ativos, sem nulos', async () => {
    await seedDados(ctx.db)
    const app = novoApp()
    const cookies = await cookieAdmin(app)
    const ativo = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Ativo com EAN', ean: '7891000999991', precoVenda: 100 },
    })
    await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Sem EAN (granel)', precoVenda: 100 },
    })
    const inativo = await app.inject({
      method: 'POST',
      url: '/produtos',
      cookies,
      payload: { descricao: 'Vai ser desativado', ean: '7891000999992', precoVenda: 100 },
    })
    const idInativo = (inativo.json() as { produto: { id: string } }).produto.id
    await app.inject({
      method: 'PUT',
      url: `/produtos/${idInativo}`,
      cookies,
      payload: { descricao: 'Vai ser desativado', precoVenda: 100, ativo: false },
    })
    expect(ativo.statusCode).toBe(201)

    const res = await app.inject({ method: 'GET', url: '/produtos/eans', cookies })
    expect(res.statusCode).toBe(200)
    const { eans } = res.json() as { eans: string[] }
    expect(eans).toContain('7891000999991')
    expect(eans).not.toContain('7891000999992')
    expect(eans.every((e) => typeof e === 'string' && e.length > 0)).toBe(true)
  })

  it('recusa sem autenticacao', async () => {
    const res = await novoApp().inject({ method: 'GET', url: '/produtos/eans' })
    expect(res.statusCode).toBe(401)
  })
})
