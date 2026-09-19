import type { FormaPagamento } from '@adega/core'

/**
 * Cliente HTTP minimo para a API. Sem biblioteca externa: e so `fetch`
 * contra `/api/*`, que o Vite (dev) e o servidor de producao expoem no
 * mesmo origin -- por isso o cookie de sessao (httpOnly) e enviado
 * automaticamente pelo navegador, sem `credentials` especial.
 */

export interface UsuarioSessao {
  readonly usuarioId?: string
  readonly id?: string
  readonly nome: string
  readonly perfil: 'admin' | 'caixa'
}

export interface ProdutoApi {
  readonly id: string
  readonly ean: string | null
  readonly descricao: string
  readonly precoVenda: number
  readonly estoqueAtual: number | string | null
}

export interface SessaoCaixaApi {
  readonly id: string
  readonly fundoTroco: number
  readonly abertoEm: string
  readonly fechadoEm: string | null
}

export interface ErroApi {
  readonly status: 'erro'
  readonly motivo: string
  readonly codigo?: string
  readonly sessaoId?: string
}

export class ErroRequisicao extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
  ) {
    super(message)
  }
}

async function requisitar<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  const res = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...opcoes?.headers },
  })
  const corpo = (await res.json().catch(() => ({}))) as T | ErroApi
  if (!res.ok) {
    const erro = corpo as ErroApi
    throw new ErroRequisicao(erro.motivo ?? `Erro ${res.status}`, erro.codigo)
  }
  return corpo as T
}

export function login(email: string, senha: string) {
  return requisitar<{ usuario: UsuarioSessao }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  })
}

export function loginComPin(usuarioId: string, pin: string) {
  return requisitar<{ usuario: UsuarioSessao }>('/auth/pin', {
    method: 'POST',
    body: JSON.stringify({ usuarioId, pin }),
  })
}

export function listarOperadores() {
  return requisitar<{ operadores: Array<{ id: string; nome: string }> }>('/auth/operadores')
}

export function logout() {
  return requisitar<{ status: string }>('/auth/logout', { method: 'POST' })
}

export function eu() {
  return requisitar<{ usuario: UsuarioSessao }>('/auth/eu')
}

export function caixaAtual() {
  return requisitar<{ sessao: SessaoCaixaApi | null }>('/caixa/atual')
}

export function abrirCaixa(fundoTroco: number) {
  return requisitar<{ sessao: SessaoCaixaApi }>('/caixa/abrir', {
    method: 'POST',
    body: JSON.stringify({ fundoTroco }),
  })
}

export function fecharCaixa(valorContado: number) {
  return requisitar<{
    sessao: SessaoCaixaApi
    fechamento: { esperado: number; contado: number; diferenca: number }
  }>('/caixa/fechar', { method: 'POST', body: JSON.stringify({ valorContado }) })
}

export function buscarProdutoPorEan(ean: string) {
  return requisitar<{ produto: ProdutoApi }>(`/produtos/ean/${encodeURIComponent(ean)}`)
}

export function buscarProdutosPorDescricao(termo: string) {
  return requisitar<{ produtos: ProdutoApi[] }>(`/produtos?q=${encodeURIComponent(termo)}`)
}

export interface ItemVendaApi {
  readonly produtoId: string
  readonly quantidade: number
  readonly precoUnitario: number
}

export interface PagamentoVendaApi {
  readonly forma: FormaPagamento
  readonly valor: number
}

export interface VendaConfirmadaApi {
  readonly venda: { readonly id: string; readonly total: number }
  readonly pagamentos: ReadonlyArray<{
    readonly forma: string
    readonly valor: number
    readonly troco: number
  }>
  readonly idempotente?: boolean
}

export function registrarVenda(
  id: string,
  itens: readonly ItemVendaApi[],
  pagamentos: readonly PagamentoVendaApi[],
) {
  return requisitar<VendaConfirmadaApi>('/vendas', {
    method: 'POST',
    body: JSON.stringify({ id, itens, pagamentos }),
  })
}

export interface ReciboApi {
  readonly linhas: readonly string[]
  readonly escPosBase64: string
}

export function buscarRecibo(vendaId: string) {
  return requisitar<ReciboApi>(`/vendas/${encodeURIComponent(vendaId)}/recibo`)
}

/**
 * O recibo fixo de diagnostico (pagina /diagnostico) NAO vem mais de uma
 * chamada de API -- a pagina gera ele localmente no navegador (ver
 * DiagnosticoTela.tsx), usando os mesmos geradores puros de
 * `@adega/core`. Isso e o que permite a pagina rodar sem backend nenhum
 * (build estatica, hospedagem sem Node/pnpm -- ex.: FTP num servidor
 * compartilhado), alem de continuar funcionando quando o ambiente roda
 * completo no PC da loja.
 */
