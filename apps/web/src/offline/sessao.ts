import type { SessaoCaixaApi, UsuarioSessao } from '../api'

/**
 * Lembra quem estava no caixa e qual sessao estava aberta, so pra o PDV
 * conseguir abrir SEM internet (o cookie de login continua valendo 30 dias;
 * o que falta offline e o servidor confirmar). Conveniencia local: se o
 * navegador apagar, o PDV so volta pro login como antes.
 */
const CHAVE = 'adega-pdv-sessao'

interface Guardado {
  readonly usuario: UsuarioSessao
  readonly sessaoCaixa: SessaoCaixaApi
}

function ler(): Guardado | null {
  try {
    const texto = localStorage.getItem(CHAVE)
    return texto ? (JSON.parse(texto) as Guardado) : null
  } catch {
    return null
  }
}

export function lembrarSessao(usuario: UsuarioSessao, sessaoCaixa: SessaoCaixaApi): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ usuario, sessaoCaixa }))
  } catch {
    // Sem localStorage: segue so online.
  }
}

export function esquecerSessao(): void {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // idem
  }
}

export function usuarioGuardado(): UsuarioSessao | null {
  return ler()?.usuario ?? null
}

export function sessaoGuardada(): SessaoCaixaApi | null {
  return ler()?.sessaoCaixa ?? null
}
