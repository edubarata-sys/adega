import { describe, expect, it } from 'vitest'
import {
  buscarEanNoCatalogo,
  buscarNomeNoCatalogo,
  calcularVendaOffline,
  candidatosEan,
  type ProdutoCatalogo,
} from './offline'

const CAT: ProdutoCatalogo[] = [
  { id: 'a', ean: '7894900011517', descricao: 'COCA-COLA 2L', precoVenda: 1200, estoqueAtual: 10 },
  {
    id: 'b',
    ean: '7894900011517',
    descricao: 'COCA-COLA ZERO 2L',
    precoVenda: 1200,
    estoqueAtual: 3,
  },
  {
    id: 'c',
    ean: '012345678905',
    descricao: 'ENERGÉTICO MONSTER MANGO LOKO',
    precoVenda: 1100,
    estoqueAtual: 5,
  },
  { id: 'd', ean: null, descricao: 'GELO SABORIZADO', precoVenda: 400, estoqueAtual: 0 },
]

describe('busca no catalogo local', () => {
  it('EAN repetido devolve todos, em ordem', () => {
    expect(buscarEanNoCatalogo(CAT, '7894900011517').map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('UPC-A com e sem zero na frente', () => {
    expect(candidatosEan('0012345678905')).toContain('012345678905')
    expect(buscarEanNoCatalogo(CAT, '0012345678905').map((p) => p.id)).toEqual(['c'])
  })
  it('nome palavra por palavra, sem acento e fora de ordem', () => {
    expect(buscarNomeNoCatalogo(CAT, 'monster manga').map((p) => p.id)).toEqual([])
    expect(buscarNomeNoCatalogo(CAT, 'mango energetico').map((p) => p.id)).toEqual(['c'])
    expect(buscarNomeNoCatalogo(CAT, 'coca 2l').map((p) => p.id)).toEqual(['a', 'b'])
    expect(buscarNomeNoCatalogo(CAT, '  ')).toEqual([])
  })
})

describe('calcularVendaOffline', () => {
  const itens = [
    { produtoId: 'a', descricao: 'COCA-COLA 2L', quantidade: 2, precoUnitario: 1200 },
    { produtoId: 'd', descricao: 'GELO SABORIZADO', quantidade: 1, precoUnitario: 400 },
  ]
  it('total e troco iguais ao servidor', () => {
    const r = calcularVendaOffline(itens, [{ forma: 'dinheiro', valor: 3000 }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.total).toBe(2800)
    expect(r.valor.pagamentos[0]).toEqual({ forma: 'dinheiro', valor: 3000, troco: 200 })
  })
  it('recusa o mesmo que o servidor recusaria', () => {
    expect(calcularVendaOffline(itens, [{ forma: 'pix', valor: 9999 }]).ok).toBe(false)
    expect(calcularVendaOffline([], [{ forma: 'pix', valor: 100 }]).ok).toBe(false)
    expect(
      calcularVendaOffline(itens, [
        { forma: 'dinheiro', valor: 1000 },
        { forma: 'dinheiro', valor: 2000 },
      ]).ok,
    ).toBe(false)
  })
})
