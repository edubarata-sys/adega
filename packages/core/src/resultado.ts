/**
 * Resultado explicito para regras de negocio.
 *
 * Regra de uso:
 * - violacao de REGRA DE NEGOCIO retorna `Resultado` com ok: false;
 * - violacao de INVARIANTE (erro de programacao) lanca excecao.
 *
 * Isso mantem o fluxo de erro previsivel na API sem transformar
 * bug de codigo em resposta 4xx silenciosa.
 */
export interface ErroDominio {
  readonly codigo: string
  readonly mensagem: string
}

export type Resultado<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly erro: ErroDominio }

export function ok<T>(valor: T): Resultado<T> {
  return { ok: true, valor }
}

export function falha<T>(codigo: string, mensagem: string): Resultado<T> {
  return { ok: false, erro: { codigo, mensagem } }
}
