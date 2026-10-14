import { describe, expect, it } from 'vitest'
import type { ProdutoCatalogo } from './offline'
import { interpretarPedido } from './pedido-voz'

const p = (id: string, descricao: string, precoVenda = 1000): ProdutoCatalogo => ({
  id,
  ean: null,
  descricao,
  precoVenda,
  estoqueAtual: 0,
})

const CATALOGO = [
  p('c1', 'CHOPP BRAHMA 400 ML', 1500),
  p('c3', 'CHOPP BRAHMA 3 POR 40,00', 4000),
  p('cl', 'BRAHMA CHOPP LATA VERMELHA 350', 450),
  p('cv', 'CHOPP DE VINHO STEMPEL 600 ML', 1799),
  p('ef', 'ESPETINHO DE FRANGO', 900),
  p('ec', 'ESPETINHO CARNE ALCATRA', 1000),
  p('ek', 'ESPETINHO KAFTA C/QUEIJO', 1000),
  p('sk', 'CERVEJA SKOL LATA 350 ML', 450),
  p('cc', 'COCA COLA 2 LITROS', 1300),
  p('cz', 'COCA COLA ZERO 2 LITROS', 1350),
]

describe('interpretarPedido', () => {
  it('pedido falado com dois itens e numeros por extenso ou digitos', () => {
    const linhas = interpretarPedido('3 espetinhos de frango e dois chopps', CATALOGO)
    expect(linhas).toHaveLength(2)
    expect(linhas[0]!.quantidade).toBe(3)
    expect(linhas[0]!.candidatos[0]!.id).toBe('ef')
    expect(linhas[1]!.quantidade).toBe(2)
    // Comeca com CHOPP e o mais curto primeiro: o copo avulso.
    expect(linhas[1]!.candidatos[0]!.id).toBe('c1')
    expect(linhas[1]!.candidatos.map((c) => c.id)).toContain('c3')
  })

  it('sem quantidade vale 1; virgula e "mais" separam itens', () => {
    const linhas = interpretarPedido('espetinho de carne, uma skol mais coca zero', CATALOGO)
    expect(linhas.map((l) => [l.quantidade, l.candidatos[0]?.id])).toEqual([
      [1, 'ec'],
      [1, 'sk'],
      [1, 'cz'],
    ])
  })

  it('sem acento e maiuscula nao atrapalham', () => {
    const [linha] = interpretarPedido('Espetinho KAFTA', CATALOGO)
    expect(linha!.candidatos[0]!.id).toBe('ek')
  })

  it('nome que nao existe volta sem candidatos (a tela pede pra escolher)', () => {
    const [linha] = interpretarPedido('2 pasteis', CATALOGO)
    expect(linha!.quantidade).toBe(2)
    expect(linha!.candidatos).toEqual([])
  })

  it('texto vazio nao gera linha', () => {
    expect(interpretarPedido('   ', CATALOGO)).toEqual([])
  })
})
