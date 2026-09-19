import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Sessao minima e sem estado (nenhuma tabela nova no banco): um payload
 * assinado por HMAC-SHA256, guardado num cookie httpOnly. Formato
 * `base64url(payload-json).base64url(assinatura)` -- e a mesma ideia de um
 * JWT compacto, escrito a mao pra nao trazer uma biblioteca de JWT inteira
 * (com todas as opcoes de algoritmo que este sistema nunca vai usar) so
 * pra assinar um objeto pequeno.
 *
 * arquitetura.md §4 pede cookie httpOnly SameSite=Lax de 30 dias pro admin e
 * PIN sobre "dispositivo ja autorizado" pro operador. O registro formal de
 * dispositivo (token de longa duracao emitido pelo admin) fica fora desta
 * missao -- aqui login e PIN emitem o MESMO formato de sessao, o suficiente
 * pra identificar o operador em cada venda/movimento, que e o requisito
 * concreto desta missao (secao 5 da ordem: "operador da venda e do caixa
 * deve ficar rastreavel"). Registrar dispositivo fisico e granularidade
 * extra que a Torre nao pediu agora.
 */
export interface PayloadSessao {
  readonly usuarioId: string
  readonly perfil: 'admin' | 'caixa'
  readonly nome: string
  /** epoch seconds */
  readonly exp: number
}

const TRINTA_DIAS_SEGUNDOS = 30 * 24 * 60 * 60

function base64UrlCodificar(dados: Buffer): string {
  return dados.toString('base64url')
}

function assinar(payloadCodificado: string, segredo: string): string {
  return createHmac('sha256', segredo).update(payloadCodificado).digest('base64url')
}

export function assinarSessao(
  dados: Omit<PayloadSessao, 'exp'>,
  segredo: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): string {
  const payload: PayloadSessao = { ...dados, exp: agoraSegundos + TRINTA_DIAS_SEGUNDOS }
  const payloadCodificado = base64UrlCodificar(Buffer.from(JSON.stringify(payload), 'utf8'))
  const assinatura = assinar(payloadCodificado, segredo)
  return `${payloadCodificado}.${assinatura}`
}

/**
 * Retorna o payload se o token for valido (assinatura bate E nao expirou),
 * ou `null` caso contrario. Nunca lanca excecao -- token de cookie e input
 * nao confiavel, invalido e um resultado esperado, nao um bug.
 */
export function verificarSessao(
  token: string,
  segredo: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): PayloadSessao | null {
  const partes = token.split('.')
  if (partes.length !== 2) return null
  const [payloadCodificado, assinaturaRecebida] = partes as [string, string]

  const assinaturaEsperada = assinar(payloadCodificado, segredo)
  const bufRecebido = Buffer.from(assinaturaRecebida)
  const bufEsperado = Buffer.from(assinaturaEsperada)
  if (bufRecebido.length !== bufEsperado.length || !timingSafeEqual(bufRecebido, bufEsperado)) {
    return null
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadCodificado, 'base64url').toString('utf8'),
    ) as PayloadSessao
    if (
      typeof payload.usuarioId !== 'string' ||
      typeof payload.nome !== 'string' ||
      (payload.perfil !== 'admin' && payload.perfil !== 'caixa') ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }
    if (payload.exp < agoraSegundos) return null
    return payload
  } catch {
    return null
  }
}
