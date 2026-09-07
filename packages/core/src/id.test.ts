import { describe, expect, it } from 'vitest'
import { ehUuidV7, uuidv7, uuidv7Agora } from './id'

const dez = (preenchimento: number): Uint8Array => new Uint8Array(10).fill(preenchimento)

describe('uuidv7', () => {
  it('marca versao 7 e variante RFC 4122', () => {
    const id = uuidv7({ agoraMs: 1_700_000_000_000, aleatorios: dez(0xff) })
    expect(id[14]).toBe('7')
    expect('89ab').toContain(id[19])
    expect(ehUuidV7(id)).toBe(true)
  })

  it('codifica o timestamp nos 48 bits iniciais', () => {
    const id = uuidv7({ agoraMs: 0x0102_0304_0506, aleatorios: dez(0) })
    // Timestamp ocupa os 48 bits iniciais, mas o formato UUID intercala um
    // hifen na posicao 8 (grupo 8-4-4-4-12): remove-lo antes de comparar.
    expect(id.replaceAll('-', '').slice(0, 12)).toBe('010203040506')
  })

  it('e ordenavel por tempo, que e a razao de usar v7 e nao v4', () => {
    const antes = uuidv7({ agoraMs: 1_700_000_000_000, aleatorios: dez(0) })
    const depois = uuidv7({ agoraMs: 1_700_000_000_001, aleatorios: dez(0) })
    expect(antes < depois).toBe(true)
  })

  it('recusa quantidade errada de bytes aleatorios', () => {
    expect(() => uuidv7({ agoraMs: 1, aleatorios: new Uint8Array(9) })).toThrow(RangeError)
  })

  it('recusa timestamp invalido', () => {
    expect(() => uuidv7({ agoraMs: -1, aleatorios: dez(0) })).toThrow(RangeError)
  })
})

describe('uuidv7Agora', () => {
  it('gera identificadores validos e distintos', () => {
    const a = uuidv7Agora()
    const b = uuidv7Agora()
    expect(ehUuidV7(a)).toBe(true)
    expect(ehUuidV7(b)).toBe(true)
    expect(a).not.toBe(b)
  })
})
