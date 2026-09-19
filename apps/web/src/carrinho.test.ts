import { centavos } from '@adega/core'
import { describe, expect, it } from 'vitest'
import {
  adicionarAoCarrinho,
  atualizarQuantidade,
  removerDoCarrinho,
  totalCarrinho,
  totalItem,
  totalPagamentos,
  type ItemCarrinho,
} from './carrinho'

function item(parcial: Partial<ItemCarrinho> = {}): ItemCarrinho {
  return {
    produtoId: 'p1',
    ean: '7891000100019',
    descricao: 'Cerveja Pilsen Lata 350ml',
    precoUnitario: centavos(550),
    quantidade: 1,
    ...parcial,
  }
}

describe('totalItem / totalCarrinho', () => {
  it('multiplica preco unitario pela quantidade', () => {
    expect(totalItem(item({ quantidade: 3 }))).toBe(1650)
  })

  it('soma o carrinho vazio como zero', () => {
    expect(totalCarrinho([])).toBe(0)
  })

  it('soma varios itens diferentes', () => {
    const itens = [
      item({ produtoId: 'p1', precoUnitario: centavos(550), quantidade: 2 }),
      item({ produtoId: 'p2', precoUnitario: centavos(300), quantidade: 1 }),
    ]
    expect(totalCarrinho(itens)).toBe(550 * 2 + 300)
  })
})

describe('adicionarAoCarrinho', () => {
  it('adiciona um produto novo como linha separada', () => {
    const itens = adicionarAoCarrinho([], item({ produtoId: 'p1' }))
    expect(itens).toHaveLength(1)
  })

  it('soma a quantidade em vez de duplicar linha quando o produto ja esta no carrinho', () => {
    const itens = adicionarAoCarrinho(
      [item({ produtoId: 'p1', quantidade: 1 })],
      item({ produtoId: 'p1', quantidade: 2 }),
    )
    expect(itens).toHaveLength(1)
    expect(itens[0]?.quantidade).toBe(3)
  })
})

describe('removerDoCarrinho / atualizarQuantidade', () => {
  it('remove pelo produtoId', () => {
    const itens = removerDoCarrinho([item({ produtoId: 'p1' }), item({ produtoId: 'p2' })], 'p1')
    expect(itens.map((i) => i.produtoId)).toEqual(['p2'])
  })

  it('atualiza a quantidade de uma linha existente', () => {
    const itens = atualizarQuantidade([item({ produtoId: 'p1', quantidade: 1 })], 'p1', 5)
    expect(itens[0]?.quantidade).toBe(5)
  })
})

describe('totalPagamentos', () => {
  it('soma multiplos pagamentos (split)', () => {
    const total = totalPagamentos([
      { forma: 'credito', valor: centavos(3000) },
      { forma: 'dinheiro', valor: centavos(1200) },
    ])
    expect(total).toBe(4200)
  })
})
