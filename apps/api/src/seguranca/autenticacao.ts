import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import { verificarSessao, type PayloadSessao } from './sessao'

export const NOME_COOKIE_SESSAO = 'adega_sessao'
const TRINTA_DIAS_SEGUNDOS = 30 * 24 * 60 * 60

declare module 'fastify' {
  interface FastifyRequest {
    usuarioAutenticado?: PayloadSessao
  }
}

/**
 * Preenche `request.usuarioAutenticado` OU responde 401/403 e interrompe a
 * cadeia -- Fastify considera a requisicao respondida quando o preHandler
 * chama `reply.send`/`reply.code().send()`, entao o handler da rota nunca
 * roda nesse caso.
 */
export function criarRequireAuth(
  sessionSecret: string,
  opcoes?: { readonly perfil?: 'admin' | 'caixa' },
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[NOME_COOKIE_SESSAO]
    const payload = token ? verificarSessao(token, sessionSecret) : null
    if (!payload) {
      await reply.code(401).send({ status: 'erro', motivo: 'Nao autenticado.' })
      return
    }
    if (opcoes?.perfil && payload.perfil !== opcoes.perfil) {
      await reply
        .code(403)
        .send({ status: 'erro', motivo: 'Permissao insuficiente para este perfil.' })
      return
    }
    request.usuarioAutenticado = payload
  }
}

export function definirCookieSessao(reply: FastifyReply, token: string): void {
  reply.setCookie(NOME_COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TRINTA_DIAS_SEGUNDOS,
  })
}

export function limparCookieSessao(reply: FastifyReply): void {
  reply.clearCookie(NOME_COOKIE_SESSAO, { path: '/' })
}
