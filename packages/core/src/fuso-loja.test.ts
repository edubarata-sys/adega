import { describe, expect, it } from 'vitest'
import { dataLojaIso, fimDoDiaLoja, formatarDataHoraLoja, inicioDoDiaLoja } from './fuso-loja'

describe('fuso da loja (America/Sao_Paulo)', () => {
  it('22:40 em Brasilia ainda e o mesmo dia, mesmo ja sendo o dia seguinte em UTC', () => {
    const instante = new Date('2026-09-25T01:40:00.000Z') // 24/09 22:40 em Brasilia
    expect(dataLojaIso(instante)).toBe('2026-09-24')
    expect(formatarDataHoraLoja(instante)).toBe('24/09/2026 22:40')
  })

  it('dia da loja vai de 00:00 a 23:59:59.999 em Brasilia (03:00Z a 02:59Z)', () => {
    expect(inicioDoDiaLoja('2026-09-24').toISOString()).toBe('2026-09-24T03:00:00.000Z')
    expect(fimDoDiaLoja('2026-09-24').toISOString()).toBe('2026-09-25T02:59:59.999Z')
  })

  it('venda das 23h cai no proprio dia, e a da meia-noite e uma no dia seguinte', () => {
    const vendaNoite = new Date('2026-09-25T02:00:00.000Z') // 24/09 23:00
    const vendaMadrugada = new Date('2026-09-25T03:30:00.000Z') // 25/09 00:30
    expect(
      vendaNoite >= inicioDoDiaLoja('2026-09-24') && vendaNoite <= fimDoDiaLoja('2026-09-24'),
    ).toBe(true)
    expect(vendaMadrugada <= fimDoDiaLoja('2026-09-24')).toBe(false)
    expect(dataLojaIso(vendaMadrugada)).toBe('2026-09-25')
  })

  it('recusa data fora do formato AAAA-MM-DD', () => {
    expect(() => inicioDoDiaLoja('24/09/2026')).toThrow(RangeError)
  })
})
