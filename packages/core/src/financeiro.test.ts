import { describe, expect, it } from 'vitest'
import {
  competenciaDe,
  interpretarComandoFinanceiro,
  interpretarValorEmCentavos,
  situacaoConta,
  vencimentoFixoNoMes,
} from './financeiro'

describe('interpretarValorEmCentavos', () => {
  it.each([
    ['80', 8000],
    ['12,50', 1250],
    ['12,5', 1250],
    ['1.234,56', 123456],
    ['12.50', 1250],
    ['1.200', 120000],
    ['R$300', 30000],
  ])('%s -> %i', (texto, esperado) => {
    expect(interpretarValorEmCentavos(texto)).toBe(esperado)
  })
  it('rejeita texto e zero', () => {
    expect(interpretarValorEmCentavos('mercado')).toBeNull()
    expect(interpretarValorEmCentavos('0')).toBeNull()
  })
})

describe('interpretarComandoFinanceiro', () => {
  it('casa, valor, descricao', () => {
    expect(interpretarComandoFinanceiro('Casa, 80, mercado')).toEqual({
      grupo: 'casa',
      valor: 8000,
      descricao: 'Mercado',
    })
  })
  it('adega com reais e descricao composta', () => {
    expect(interpretarComandoFinanceiro('adega 300 reais gelo do fornecedor')).toEqual({
      grupo: 'adega',
      valor: 30000,
      descricao: 'Gelo do fornecedor',
    })
  })
  it('centavos falados', () => {
    expect(interpretarComandoFinanceiro('casa 12 reais e 50 centavos pão').valor).toBe(1250)
  })
  it('R$ com virgula', () => {
    const r = interpretarComandoFinanceiro('casa R$ 45,90 farmácia')
    expect(r.valor).toBe(4590)
    expect(r.descricao).toBe('Farmácia')
  })
  it('sem grupo fica nulo pro dono escolher', () => {
    expect(interpretarComandoFinanceiro('50 gasolina')).toEqual({
      grupo: null,
      valor: 5000,
      descricao: 'Gasolina',
    })
  })
  it('pessoal vira casa, loja vira adega', () => {
    expect(interpretarComandoFinanceiro('pessoal 10 lanche').grupo).toBe('casa')
    expect(interpretarComandoFinanceiro('loja 10 sacola').grupo).toBe('adega')
  })
})

describe('datas de contas', () => {
  it('competencia', () => {
    expect(competenciaDe('2026-10-06')).toBe('2026-10')
  })
  it('fixo dia 31 em fevereiro e em setembro', () => {
    expect(vencimentoFixoNoMes(31, '2027-02')).toBe('2027-02-28')
    expect(vencimentoFixoNoMes(31, '2026-09')).toBe('2026-09-30')
    expect(vencimentoFixoNoMes(5, '2026-10')).toBe('2026-10-05')
  })
  it('situacao', () => {
    expect(situacaoConta('2026-10-05', '2026-10-06')).toBe('vencida')
    expect(situacaoConta('2026-10-06', '2026-10-06')).toBe('vence-hoje')
    expect(situacaoConta('2026-10-07', '2026-10-06')).toBe('a-vencer')
  })
})
