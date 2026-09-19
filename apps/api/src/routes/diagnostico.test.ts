import { AVISO_SEM_VALOR_FISCAL } from '@adega/core'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { bancoDeTeste } from '@adega/db/teste'

describe('GET /diagnostico/recibo-teste', () => {
  it('responde sem exigir autenticacao (pagina de diagnostico e publica)', async () => {
    const ctx = await bancoDeTeste()
    try {
      const app = buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-diagnostico' })
      const res = await app.inject({ method: 'GET', url: '/diagnostico/recibo-teste' })
      expect(res.statusCode).toBe(200)
    } finally {
      await ctx.client.close()
    }
  })

  it('inclui o aviso obrigatorio e a linha de teste de caracteres', async () => {
    const ctx = await bancoDeTeste()
    try {
      const app = buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-diagnostico' })
      const res = await app.inject({ method: 'GET', url: '/diagnostico/recibo-teste' })
      const corpo = res.json() as { linhas: string[]; escPosBase64: string }

      expect(corpo.linhas.filter((l) => l.includes(AVISO_SEM_VALOR_FISCAL))).toHaveLength(2)
      expect(corpo.linhas.some((l) => l.includes('áéíóú'))).toBe(true)
      expect(corpo.linhas.some((l) => l.includes('ç'))).toBe(true)
      expect(corpo.linhas.some((l) => l.includes('R$'))).toBe(true)
    } finally {
      await ctx.client.close()
    }
  })

  it('gera bytes ESC/POS validos (ESC @ de inicializacao)', async () => {
    const ctx = await bancoDeTeste()
    try {
      const app = buildApp({ db: ctx.db, versao: 'teste', sessionSecret: 'segredo-diagnostico' })
      const res = await app.inject({ method: 'GET', url: '/diagnostico/recibo-teste' })
      const corpo = res.json() as { escPosBase64: string }
      const bytes = Buffer.from(corpo.escPosBase64, 'base64')

      expect(bytes[0]).toBe(0x1b)
      expect(bytes[1]).toBe(0x40)
      // corte de papel no final: GS V 1 (0x1d, 0x56, 0x01)
      expect(bytes[bytes.length - 3]).toBe(0x1d)
      expect(bytes[bytes.length - 2]).toBe(0x56)
      expect(bytes[bytes.length - 1]).toBe(0x01)
    } finally {
      await ctx.client.close()
    }
  })
})
