// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armazemEmMemoria, definirArmazem } from './armazem'
import { atualizarCatalogo, buscarEanComOffline, buscarNomeComOffline } from './catalogo'
import { enviarVenda, guardarNaFila, listarFila, sincronizarFila, type VendaNaFila } from './fila'

const PRODUTOS = [
  { id: 'p1', ean: '7891000100103', descricao: 'CERVEJA LATA', precoVenda: 550, estoqueAtual: 10 },
  { id: 'p2', ean: '7891000100110', descricao: 'ÁGUA MINERAL', precoVenda: 300, estoqueAtual: 5 },
]

function venda(id: string): VendaNaFila {
  return {
    id,
    itens: [{ produtoId: 'p1', quantidade: 1, precoUnitario: 550 }],
    pagamentos: [{ forma: 'pix', valor: 550 }],
    ocorridoEm: '2026-10-08T21:00:00.000Z',
    total: 550,
  }
}

let internet = true
let respostaVenda: { status: number; corpo: unknown } = { status: 201, corpo: {} }
const enviadas: unknown[] = []

beforeEach(() => {
  definirArmazem(armazemEmMemoria())
  internet = true
  respostaVenda = { status: 201, corpo: { venda: { id: 'x', total: 550 }, pagamentos: [] } }
  enviadas.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!internet) throw new TypeError('Failed to fetch')
      const url = String(input)
      if (url.endsWith('/api/produtos/catalogo-pdv')) {
        return new Response(JSON.stringify({ produtos: PRODUTOS, geradoEm: 'x' }), { status: 200 })
      }
      if (url.endsWith('/api/vendas')) {
        enviadas.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify(respostaVenda.corpo), { status: respostaVenda.status })
      }
      if (url.includes('/api/produtos/ean/')) {
        return new Response(JSON.stringify({ produto: PRODUTOS[0], produtos: [PRODUTOS[0]] }), {
          status: 200,
        })
      }
      throw new Error(`fetch nao mockado: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  definirArmazem(null)
})

describe('catalogo local', () => {
  it('sem internet, a pistola e a busca usam a copia guardada', async () => {
    expect(await atualizarCatalogo()).toBe(true)
    internet = false
    const porEan = await buscarEanComOffline('7891000100103')
    expect(porEan).toMatchObject({ offline: true, produto: { id: 'p1' } })
    const porNome = await buscarNomeComOffline('agua')
    expect(porNome.produtos.map((p) => p.id)).toEqual(['p2'])
    await expect(buscarEanComOffline('000')).rejects.toMatchObject({ status: 404 })
  })

  it('sem internet e sem copia guardada, avisa claramente', async () => {
    internet = false
    await expect(buscarEanComOffline('7891000100103')).rejects.toMatchObject({
      codigo: 'SEM_CATALOGO',
    })
  })
})

describe('fila de vendas', () => {
  it('sem internet a venda fica guardada; volta a internet, sobe com a hora original', async () => {
    internet = false
    await guardarNaFila(venda('v1'))
    expect((await enviarVenda(venda('v1'))).status).toBe('sem-conexao')
    expect(await listarFila()).toHaveLength(1)

    internet = true
    expect(await sincronizarFila()).toBe(1)
    expect(await listarFila()).toHaveLength(0)
    expect(enviadas[0]).toMatchObject({ id: 'v1', ocorridoEm: '2026-10-08T21:00:00.000Z' })
  })

  it('guardar duas vezes a mesma venda nao duplica', async () => {
    await guardarNaFila(venda('v1'))
    await guardarNaFila(venda('v1'))
    expect(await listarFila()).toHaveLength(1)
  })

  it('venda recusada pelo servidor fica marcada com o erro, nao some', async () => {
    internet = false
    await guardarNaFila(venda('v1'))
    await guardarNaFila(venda('v2'))
    internet = true
    respostaVenda = {
      status: 409,
      corpo: { status: 'erro', motivo: 'Nenhuma sessao de caixa aberta' },
    }
    await sincronizarFila()
    const fila = await listarFila()
    expect(fila).toHaveLength(2)
    expect(fila.every((v) => v.erro?.includes('caixa'))).toBe(true)
  })

  it('servidor fora do ar (502) conta como sem internet', async () => {
    await guardarNaFila(venda('v1'))
    respostaVenda = { status: 502, corpo: {} }
    expect(await sincronizarFila()).toBe(0)
    const fila = await listarFila()
    expect(fila[0]?.erro).toBeUndefined()
  })
})
