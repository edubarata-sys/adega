import { describe, expect, it } from 'vitest'
import { centavos } from './dinheiro'
import { classificarVia, dividirVendaPorVia, ratear } from './via-produto'

describe('classificarVia', () => {
  it.each([
    ['CERVEJA SKOL LATA 350 ML', 'adega'],
    ['HEINEKEN LATA 350 ML', 'adega'],
    ['COCA COLA 2 LITROS', 'adega'],
    ['ENERGÉTICO MONSTER MELANCIA', 'adega'],
    ['MARLBORO MELANCIA', 'adega'],
    ['DOSE PINGA C/MEL', 'adega'],
    ['COPÃO WHITE HORSE COM BALY', 'adega'],
    ['VINHO CABERNET SUAVE', 'adega'],
    ['ESPETINHO CARNE ALCATRA', 'espetinho'],
    ['ESPETINHO KAFTA C/QUEIJO', 'espetinho'],
    ['ESPETO FINI', 'outros'],
    ['SALGADINHO TORCIDA 60G', 'outros'],
    ['GELO SABORIZADO', 'outros'],
    ['CARVÃO NÁRGUILE SOLTO ZOMO', 'outros'],
    ['KITKAT SABORES', 'outros'],
    ['DEL VALE UVA 1 LITRO', 'adega'],
    ['PASSAPORTE SELECTION', 'adega'],
    ['FUMO DE ROLO AMSTERDAN', 'adega'],
    ['AÇAI ENERGY 70 ML', 'outros'],
  ])('%s -> %s', (descricao, via) => {
    expect(classificarVia(descricao)).toBe(via)
  })
})

describe('ratear', () => {
  it('soma exatamente o valor, sobra vai pra maior fracao', () => {
    expect(ratear(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(ratear(5000, [3000, 2000])).toEqual([3000, 2000])
  })
  it('pesos zerados: tudo na primeira parte', () => {
    expect(ratear(700, [0, 0])).toEqual([700, 0])
  })
})

describe('dividirVendaPorVia', () => {
  it('venda misturada: total e pagamento rateados pelos itens', () => {
    const partes = dividirVendaPorVia(
      centavos(5000),
      [
        { via: 'adega', totalItem: centavos(3000) },
        { via: 'espetinho', totalItem: centavos(2000) },
      ],
      [{ pagamento: 'debito', valorLiquido: centavos(5000) }],
    )
    expect(partes).toEqual([
      { via: 'adega', total: 3000, pagamentos: [{ pagamento: 'debito', valor: 3000 }] },
      { via: 'espetinho', total: 2000, pagamentos: [{ pagamento: 'debito', valor: 2000 }] },
    ])
  })

  it('desconto na venda e dividido na mesma proporcao, sem perder centavo', () => {
    const partes = dividirVendaPorVia(
      centavos(999),
      [
        { via: 'adega', totalItem: centavos(700) },
        { via: 'outros', totalItem: centavos(350) },
      ],
      [
        { pagamento: 'pix', valorLiquido: centavos(500) },
        { pagamento: 'dinheiro', valorLiquido: centavos(499) },
      ],
    )
    expect(partes.reduce((s, p) => s + p.total, 0)).toBe(999)
    const somaPag = partes.flatMap((p) => p.pagamentos).reduce((s, p) => s + p.valor, 0)
    expect(somaPag).toBe(999)
  })

  it('venda de uma via so fica inteira nela', () => {
    const partes = dividirVendaPorVia(
      centavos(1200),
      [{ via: 'outros', totalItem: centavos(1200) }],
      [{ pagamento: 'credito', valorLiquido: centavos(1200) }],
    )
    expect(partes).toHaveLength(1)
    expect(partes[0]!.via).toBe('outros')
  })
})
