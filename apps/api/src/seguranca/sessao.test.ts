import { describe, expect, it } from 'vitest'
import { assinarSessao, verificarSessao } from './sessao'

const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'

describe('assinarSessao / verificarSessao', () => {
  it('aceita um token recem assinado', () => {
    const token = assinarSessao({ usuarioId: 'u1', perfil: 'admin', nome: 'Admin' }, SEGREDO)
    const payload = verificarSessao(token, SEGREDO)
    expect(payload).not.toBeNull()
    expect(payload?.usuarioId).toBe('u1')
    expect(payload?.perfil).toBe('admin')
  })

  it('recusa token assinado com segredo diferente', () => {
    const token = assinarSessao({ usuarioId: 'u1', perfil: 'admin', nome: 'Admin' }, SEGREDO)
    expect(verificarSessao(token, 'outro-segredo')).toBeNull()
  })

  it('recusa token adulterado (payload alterado sem re-assinar)', () => {
    const token = assinarSessao({ usuarioId: 'u1', perfil: 'caixa', nome: 'Operador' }, SEGREDO)
    const [payloadCodificado, assinatura] = token.split('.')
    const payloadAdulterado = Buffer.from(
      JSON.stringify({
        usuarioId: 'u1',
        perfil: 'admin', // tentando virar admin sem re-assinar
        nome: 'Operador',
        exp: 9999999999,
      }),
    ).toString('base64url')
    expect(verificarSessao(`${payloadAdulterado}.${assinatura}`, SEGREDO)).toBeNull()
    void payloadCodificado
  })

  it('recusa token expirado', () => {
    const agora = 1_000_000
    const token = assinarSessao({ usuarioId: 'u1', perfil: 'admin', nome: 'Admin' }, SEGREDO, agora)
    const depoisDeTrinta1Dias = agora + 31 * 24 * 60 * 60
    expect(verificarSessao(token, SEGREDO, depoisDeTrinta1Dias)).toBeNull()
  })

  it('aceita pouco antes da expiracao de 30 dias', () => {
    const agora = 1_000_000
    const token = assinarSessao({ usuarioId: 'u1', perfil: 'admin', nome: 'Admin' }, SEGREDO, agora)
    const quaseNoLimite = agora + 30 * 24 * 60 * 60 - 1
    expect(verificarSessao(token, SEGREDO, quaseNoLimite)).not.toBeNull()
  })

  it('recusa lixo/formato invalido sem lancar excecao', () => {
    expect(verificarSessao('nao-e-um-token', SEGREDO)).toBeNull()
    expect(verificarSessao('a.b.c', SEGREDO)).toBeNull()
    expect(verificarSessao('', SEGREDO)).toBeNull()
  })
})
