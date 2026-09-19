import { and, eq } from 'drizzle-orm'
import { schema, verificarSenha } from '@adega/db'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'
import {
  criarRequireAuth,
  definirCookieSessao,
  limparCookieSessao,
} from '../seguranca/autenticacao'
import { assinarSessao } from '../seguranca/sessao'

/**
 * Hash "de nada" usado quando o e-mail/usuario informado nao existe --
 * roda `verificarSenha` do mesmo jeito antes de responder 401, pra a
 * resposta de "usuario nao existe" nao ser visivelmente mais rapida que
 * "senha errada" (mitigacao simples de timing, nao critica pro escopo desta
 * missao mas barata de fazer certo desde o inicio).
 */
const HASH_FANTASMA = 'scrypt:16384:8:1:00000000000000000000000000000000:00'.padEnd(139, '0')

export function registrarRotasAuth(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  app.post<{ Body: { email?: unknown; senha?: unknown } }>(
    '/auth/login',
    async (request, reply) => {
      const email =
        typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
      const senha = typeof request.body?.senha === 'string' ? request.body.senha : ''
      if (!email || !senha) {
        return reply.code(400).send({ status: 'erro', motivo: 'email e senha sao obrigatorios.' })
      }

      const [usuario] = await deps.db
        .select()
        .from(schema.usuarios)
        .where(and(eq(schema.usuarios.email, email), eq(schema.usuarios.perfil, 'admin')))

      const hashParaVerificar = usuario?.senhaHash ?? HASH_FANTASMA
      const senhaOk = await verificarSenha(hashParaVerificar, senha)

      if (!usuario || !usuario.ativo || !usuario.senhaHash || !senhaOk) {
        return reply.code(401).send({ status: 'erro', motivo: 'Credenciais invalidas.' })
      }

      const token = assinarSessao(
        { usuarioId: usuario.id, perfil: 'admin', nome: usuario.nome },
        deps.sessionSecret,
      )
      definirCookieSessao(reply, token)
      return { status: 'ok', usuario: { id: usuario.id, nome: usuario.nome, perfil: 'admin' } }
    },
  )

  /**
   * Lista de operadores ativos pra tela de PIN mostrar "quem e voce?" antes
   * de digitar o PIN -- so id/nome, nunca hash. Nao exige autenticacao
   * porque e o passo QUE VEM ANTES do login do operador (arquitetura §4:
   * troca de turno rapida no balcao).
   */
  app.get('/auth/operadores', async () => {
    const operadores = await deps.db
      .select({ id: schema.usuarios.id, nome: schema.usuarios.nome })
      .from(schema.usuarios)
      .where(and(eq(schema.usuarios.perfil, 'caixa'), eq(schema.usuarios.ativo, true)))
    return { operadores }
  })

  app.post<{ Body: { usuarioId?: unknown; pin?: unknown } }>(
    '/auth/pin',
    async (request, reply) => {
      const usuarioId = typeof request.body?.usuarioId === 'string' ? request.body.usuarioId : ''
      const pin = typeof request.body?.pin === 'string' ? request.body.pin : ''
      if (!usuarioId || !pin) {
        return reply.code(400).send({ status: 'erro', motivo: 'usuarioId e pin sao obrigatorios.' })
      }

      const [usuario] = await deps.db
        .select()
        .from(schema.usuarios)
        .where(and(eq(schema.usuarios.id, usuarioId), eq(schema.usuarios.perfil, 'caixa')))

      const hashParaVerificar = usuario?.pinHash ?? HASH_FANTASMA
      const pinOk = await verificarSenha(hashParaVerificar, pin)

      if (!usuario || !usuario.ativo || !usuario.pinHash || !pinOk) {
        return reply.code(401).send({ status: 'erro', motivo: 'PIN invalido.' })
      }

      const token = assinarSessao(
        { usuarioId: usuario.id, perfil: 'caixa', nome: usuario.nome },
        deps.sessionSecret,
      )
      definirCookieSessao(reply, token)
      return { status: 'ok', usuario: { id: usuario.id, nome: usuario.nome, perfil: 'caixa' } }
    },
  )

  app.post('/auth/logout', async (_request, reply) => {
    limparCookieSessao(reply)
    return { status: 'ok' }
  })

  app.get('/auth/eu', { preHandler: requireAuth }, async (request) => {
    return { usuario: request.usuarioAutenticado }
  })
}
