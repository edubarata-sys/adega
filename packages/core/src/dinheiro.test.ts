import { describe, expect, it } from 'vitest'
import {
  arredondarMeioParaCima,
  centavos,
  formatarBRL,
  multiplicarPorQuantidade,
  somar,
} from './dinheiro'

describe('centavos', () => {
  it('aceita inteiro', () => {
    expect(centavos(1990)).toBe(1990)
  })

  it('recusa float, que e a origem classica de erro de dinheiro', () => {
    expect(() => centavos(19.9)).toThrow(TypeError)
    expect(() => centavos(0.1 + 0.2)).toThrow(TypeError)
  })

  it('recusa valor fora da faixa segura', () => {
    expect(() => centavos(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })
})

describe('multiplicarPorQuantidade', () => {
  it('multiplica quantidade inteira', () => {
    expect(multiplicarPorQuantidade(centavos(350), 3)).toBe(1050)
  })

  it('nao acumula deriva de ponto flutuante', () => {
    // 0.1 + 0.2 !== 0.3 em float; o calculo passa por milesimos inteiros.
    expect(multiplicarPorQuantidade(centavos(1000), 0.1 + 0.2)).toBe(300)
  })

  it('arredonda meio para cima no total do item', () => {
    // 0.555 kg a R$ 1,00/kg = 55,5 centavos -> 56
    expect(multiplicarPorQuantidade(centavos(100), 0.555)).toBe(56)
    // 0.554 kg -> 55,4 centavos -> 55
    expect(multiplicarPorQuantidade(centavos(100), 0.554)).toBe(55)
  })

  it('trata granel com preco por quilo', () => {
    // 1,235 kg a R$ 42,90/kg
    expect(multiplicarPorQuantidade(centavos(4290), 1.235)).toBe(5298)
  })
})

describe('arredondarMeioParaCima', () => {
  it('arredonda 0.5 para cima em ambos os sinais', () => {
    expect(arredondarMeioParaCima(0.5)).toBe(1)
    expect(arredondarMeioParaCima(-0.5)).toBe(-1)
  })
})

describe('somar', () => {
  it('soma vazia e zero', () => {
    expect(somar()).toBe(0)
  })

  it('soma lista', () => {
    expect(somar(centavos(100), centavos(250), centavos(1))).toBe(351)
  })
})

describe('formatarBRL', () => {
  it('formata com separador de milhar', () => {
    expect(formatarBRL(centavos(1234567))).toBe('R$ 12.345,67')
    expect(formatarBRL(centavos(5))).toBe('R$ 0,05')
    expect(formatarBRL(centavos(-250))).toBe('-R$ 2,50')
  })
})
