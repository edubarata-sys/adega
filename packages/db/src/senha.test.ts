import { describe, expect, it } from 'vitest'
import { hashSenha, verificarSenha } from './senha'

describe('hashSenha / verificarSenha', () => {
  it('verifica corretamente uma senha certa', async () => {
    const hash = await hashSenha('minha-senha-123')
    expect(await verificarSenha(hash, 'minha-senha-123')).toBe(true)
  })

  it('recusa senha errada', async () => {
    const hash = await hashSenha('minha-senha-123')
    expect(await verificarSenha(hash, 'outra-senha')).toBe(false)
  })

  it('nunca guarda a senha em texto puro no hash', async () => {
    const hash = await hashSenha('segredo-visivel')
    expect(hash).not.toContain('segredo-visivel')
  })

  it('gera hashes diferentes para a mesma senha (salt aleatorio)', async () => {
    const a = await hashSenha('repetida')
    const b = await hashSenha('repetida')
    expect(a).not.toBe(b)
    expect(await verificarSenha(a, 'repetida')).toBe(true)
    expect(await verificarSenha(b, 'repetida')).toBe(true)
  })

  it('funciona igualmente para PIN numerico curto', async () => {
    const hash = await hashSenha('135790')
    expect(await verificarSenha(hash, '135790')).toBe(true)
    expect(await verificarSenha(hash, '000000')).toBe(false)
  })

  it('recusa hash malformado sem lancar excecao', async () => {
    expect(await verificarSenha('formato-invalido', 'qualquer')).toBe(false)
    expect(await verificarSenha('scrypt:x:y:z:aa:bb', 'qualquer')).toBe(false)
  })

  it('recusa hashear valor vazio', async () => {
    await expect(hashSenha('')).rejects.toThrow(RangeError)
  })
})
