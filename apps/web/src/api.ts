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
    /** Status HTTP -- permite distinguir "nao encontrado" (404) de sessao
     * expirada/erro de servidor sem depender do texto da mensagem. */
    readonly status?: number,
  ) {
    super(message)
  }
}

/**
 * Sem internet / servidor fora do ar (status 0). Herda de ErroRequisicao pra
 * todo `catch` existente continuar funcionando; o PDV usa `semConexao` pra
 * cair no modo offline (arquitetura §2) em vez de mostrar erro.
 */
export class ErroSemConexao extends ErroRequisicao {
  constructor() {
    super('Sem conexao com o servidor (internet fora do ar?).', 'SEM_CONEXAO', 0)
  }
}

export function semConexao(e: unknown): boolean {
  return e instanceof ErroSemConexao
}

async function requisitar<T>(
  caminho: string,
  opcoes?: RequestInit & { readonly timeoutMs?: number },
): Promise<T> {
  const controle = opcoes?.timeoutMs ? new AbortController() : null
  const temporizador = controle ? setTimeout(() => controle.abort(), opcoes!.timeoutMs) : null
  let res: Response
  try {
    res = await fetch(`/api${caminho}`, {
      ...opcoes,
      signal: controle?.signal ?? opcoes?.signal,
      headers: { 'Content-Type': 'application/json', ...opcoes?.headers },
    })
  } catch {
    // fetch so rejeita por rede (offline, DNS, timeout) -- nunca por HTTP 4xx/5xx.
    throw new ErroSemConexao()
  } finally {
    if (temporizador) clearTimeout(temporizador)
  }
  // Proxy do Railway respondendo sem a aplicacao por tras = servidor fora.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ErroSemConexao()
  }
  const corpo = (await res.json().catch(() => ({}))) as T | ErroApi
  if (!res.ok) {
    const erro = corpo as ErroApi
    throw new ErroRequisicao(erro.motivo ?? `Erro ${res.status}`, erro.codigo, res.status)
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
  return requisitar<{ sessao: SessaoCaixaApi | null; totalVendido: number | null }>('/caixa/atual')
}

export function abrirCaixa(fundoTroco: number) {
  return requisitar<{ sessao: SessaoCaixaApi }>('/caixa/abrir', {
    method: 'POST',
    body: JSON.stringify({ fundoTroco }),
  })
}

export function fecharCaixa(valorContado: number, filaPendente = 0) {
  return requisitar<{
    sessao: SessaoCaixaApi
    fechamento: { esperado: number; contado: number; diferenca: number }
  }>('/caixa/fechar', { method: 'POST', body: JSON.stringify({ valorContado, filaPendente }) })
}

/** Timeout curto no balcao: internet ruim nao pode travar a pistola. */
const TIMEOUT_BALCAO_MS = 6000

export function buscarProdutoPorEan(ean: string) {
  return requisitar<{ produto: ProdutoApi; produtos?: ProdutoApi[] }>(
    `/produtos/ean/${encodeURIComponent(ean)}`,
    { timeoutMs: TIMEOUT_BALCAO_MS },
  )
}

/** Catalogo inteiro do balcao, guardado no computador pro modo offline. */
export function buscarCatalogoPdv() {
  return requisitar<{ produtos: ProdutoApi[]; geradoEm: string }>('/produtos/catalogo-pdv', {
    timeoutMs: 30000,
  })
}

export function listarEansAtivos() {
  return requisitar<{ eans: string[] }>('/produtos/eans')
}

export function buscarProdutosPorDescricao(termo: string) {
  return requisitar<{ produtos: ProdutoApi[] }>(`/produtos?q=${encodeURIComponent(termo)}`, {
    timeoutMs: TIMEOUT_BALCAO_MS,
  })
}

export interface ItemVendaApi {
  readonly produtoId: string
  readonly quantidade: number
  readonly precoUnitario: number
}

export interface PagamentoVendaApi {
  readonly forma: FormaPagamento
  readonly valor: number
  readonly terminalApelido?: string
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
  /** So venda feita offline (fila): quando aconteceu no balcao. */
  ocorridoEm?: string,
) {
  return requisitar<VendaConfirmadaApi>('/vendas', {
    method: 'POST',
    body: JSON.stringify({ id, itens, pagamentos, ...(ocorridoEm ? { ocorridoEm } : {}) }),
    timeoutMs: 15000,
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

/**
 * PASSO 10: cadastro/estoque de produtos. `ProdutoCadastroApi` e o formato
 * COMPLETO de produto (todos os campos editaveis) -- diferente de
 * `ProdutoApi` acima, que e so o subconjunto usado na busca do balcao.
 */
export interface ProdutoCadastroApi {
  readonly id: string
  readonly ean: string | null
  readonly descricao: string
  readonly descricaoPdv: string | null
  readonly unidade: 'UN' | 'KG' | 'L'
  readonly categoriaId: string | null
  readonly precoVenda: number
  readonly custoMedio: number
  readonly estoqueMinimo: number | string | null
  readonly ativo: boolean
  /** Via do caixa nos relatorios (02/10/2026). */
  readonly via?: ViaProduto
  readonly estoqueAtual: number | string | null
}

/** Vias do caixa: o balcao vende tudo junto, so os relatorios dividem. */
export type ViaProduto = 'adega' | 'outros' | 'espetinho'
export type FiltroVia = 'geral' | ViaProduto
export const OPCOES_VIA: readonly { valor: FiltroVia; rotulo: string }[] = [
  { valor: 'geral', rotulo: 'Geral' },
  { valor: 'adega', rotulo: 'Adega' },
  { valor: 'outros', rotulo: 'Outros' },
  { valor: 'espetinho', rotulo: 'Espetinho' },
]

export interface CategoriaApi {
  readonly id: string
  readonly nome: string
}

export function listarCategorias() {
  return requisitar<{ categorias: CategoriaApi[] }>('/categorias')
}

export function criarCategoria(nome: string) {
  return requisitar<{ categoria: CategoriaApi }>('/categorias', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  })
}

export function listarProdutosCadastro(q?: string) {
  const query = q && q.trim().length > 0 ? `?q=${encodeURIComponent(q.trim())}` : ''
  return requisitar<{ produtos: ProdutoCadastroApi[] }>(`/produtos/cadastro${query}`)
}

export interface DadosProdutoForm {
  readonly descricao: string
  readonly ean?: string
  readonly descricaoPdv?: string
  readonly unidade?: 'UN' | 'KG' | 'L'
  readonly categoriaId?: string
  readonly precoVenda: number
  readonly custoMedio?: number
  readonly estoqueMinimo?: number
  readonly estoqueInicial?: number
  readonly ativo?: boolean
  readonly via?: ViaProduto
}

export function criarProduto(dados: DadosProdutoForm) {
  return requisitar<{ produto: ProdutoCadastroApi }>('/produtos', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

/** Grava o codigo de barras num produto que ainda nao tem (direto do caixa). */
export function gravarCodigoDeBarras(produtoId: string, ean: string) {
  return requisitar<{ produto: ProdutoApi }>(`/produtos/${encodeURIComponent(produtoId)}/ean`, {
    method: 'PATCH',
    body: JSON.stringify({ ean }),
  })
}

export function atualizarProduto(id: string, dados: DadosProdutoForm) {
  return requisitar<{ produto: ProdutoCadastroApi }>(`/produtos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function ajustarEstoque(
  produtoId: string,
  tipo: 'entrada' | 'perda' | 'ajuste',
  quantidade: number,
  observacao?: string,
) {
  return requisitar<{ produto: ProdutoCadastroApi }>(
    `/produtos/${encodeURIComponent(produtoId)}/estoque`,
    { method: 'POST', body: JSON.stringify({ tipo, quantidade, observacao }) },
  )
}

/**
 * PASSO 12 (painel mobile): baixa o extrato de vendas em XML do periodo.
 * Usa fetch (nao um <a href> direto) pra poder mostrar um erro amigavel na
 * tela em vez do navegador abrir um JSON cru numa aba nova se as datas
 * forem invalidas.
 */
export async function baixarRelatorioXml(
  inicio: string,
  fim: string,
  via: FiltroVia = 'geral',
): Promise<void> {
  const res = await fetch(
    `/api/relatorios/vendas.xml?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}&via=${via}`,
  )
  if (!res.ok) {
    const corpo = (await res.json().catch(() => ({}))) as ErroApi
    throw new ErroRequisicao(corpo.motivo ?? `Erro ${res.status}`, corpo.codigo)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-vendas${via === 'geral' ? '' : `-${via}`}-${inicio}-a-${fim}.xml`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface RelatorioResumoApi {
  readonly inicio: string
  readonly fim: string
  readonly cadastro: { readonly produtosAtivos: number; readonly produtosAtivosSemCusto: number }
  readonly resumo: {
    readonly totalVendido: number
    readonly quantidadeVendas: number
    readonly ticketMedio: number
    readonly faturamentoComCusto: number
    readonly custoTotal: number
    readonly lucro: number
    readonly margem: number | null
    readonly faturamentoSemCusto: number
    readonly produtosSemCusto: number
  }
  readonly porDia: readonly {
    readonly data: string
    readonly vendas: number
    readonly total: number
  }[]
  readonly porPagamento: readonly {
    readonly forma: string
    readonly maquininha: string | null
    readonly valor: number
    readonly quantidade: number
  }[]
  readonly produtos: readonly {
    readonly produtoId: string
    readonly descricao: string
    readonly quantidade: number
    readonly faturamento: number
    readonly custo: number | null
    readonly lucro: number | null
    readonly margem: number | null
  }[]
}

export function buscarRelatorioResumo(inicio: string, fim: string, via: FiltroVia = 'geral') {
  return requisitar<RelatorioResumoApi>(
    `/relatorios/resumo?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}&via=${via}`,
  )
}

export interface ProdutoResumoNota {
  readonly id: string
  readonly descricao: string
  readonly ean: string | null
  readonly estoqueAtual: number | string | null
}

export interface ItemNotaLidoApi {
  readonly indice: number
  readonly descricaoLida: string
  readonly ean: string | null
  readonly quantidade: number
  readonly unidade: string | null
  /** Centavos. */
  readonly custoUnitario: number | null
  readonly valorTotal: number | null
  readonly produto: ProdutoResumoNota | null
  readonly ligadoPor: 'codigo' | 'nome' | null
  readonly sugestoes: readonly (ProdutoResumoNota & { readonly pontuacao: number })[]
}

export interface NotaLidaApi {
  readonly fornecedor: string | null
  readonly numero: string | null
  readonly data: string | null
  readonly modelo: string
  readonly itens: readonly ItemNotaLidoApi[]
}

export function lerNotaPorFoto(imagemBase64: string, mime: string) {
  return requisitar<NotaLidaApi>('/estoque/nota/ler', {
    method: 'POST',
    body: JSON.stringify({ imagemBase64, mime }),
  })
}

export function confirmarEntradaNota(dados: {
  readonly fornecedor?: string
  readonly numero?: string
  readonly itens: readonly {
    readonly produtoId: string
    readonly quantidade: number
    readonly custoUnitario?: number
  }[]
}) {
  return requisitar<{ status: 'ok'; itensLancados: number }>('/estoque/nota/confirmar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type TipoMovimentoCaixaApi = 'sangria' | 'suprimento' | 'despesa' | 'entrada_avulsa'

/** Sangria (retirada), suprimento (reforco de troco) ou despesa paga com o dinheiro do caixa. */
export function registrarMovimentoCaixa(dados: {
  readonly tipo: TipoMovimentoCaixaApi
  /** Centavos. */
  readonly valor: number
  readonly descricao: string
}) {
  return requisitar<{ movimento: unknown }>('/caixa/movimentos', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---- Financeiro pessoal do dono (so admin) ----

export type GrupoFinanceiro = 'adega' | 'casa' | 'outros'
export type SituacaoContaApi = 'vencida' | 'vence-hoje' | 'a-vencer'

export interface LancamentoFinanceiroApi {
  readonly id: string
  readonly tipo: 'entrada' | 'saida'
  readonly grupo: GrupoFinanceiro
  readonly valor: number
  readonly descricao: string
  readonly data: string
  readonly origem: 'manual' | 'voz' | 'caixa' | 'conta'
}

export interface ContaFinanceiraApi {
  readonly id: string
  readonly tipo: 'boleto' | 'fixo'
  readonly grupo: GrupoFinanceiro
  readonly descricao: string
  readonly valor: number
  readonly vencimento: string | null
  readonly diaVencimento: number | null
  readonly codigoBarras: string | null
}

export interface ContaPendenteApi {
  readonly contaId: string
  readonly tipo: 'boleto' | 'fixo'
  readonly grupo: GrupoFinanceiro
  readonly descricao: string
  readonly valor: number
  readonly vencimento: string
  readonly competencia: string
  readonly situacao: SituacaoContaApi
}

export interface ResumoFinanceiroApi {
  readonly mes: string
  readonly hoje: string
  readonly totais: {
    readonly entradaAdega: number
    readonly entradaOutros: number
    readonly saidaAdega: number
    readonly saidaCasa: number
    readonly entradas: number
    readonly saidas: number
    readonly saldo: number
  }
  readonly lancamentos: readonly LancamentoFinanceiroApi[]
  readonly contasPendentes: readonly ContaPendenteApi[]
  readonly contas: readonly ContaFinanceiraApi[]
}

export function buscarResumoFinanceiro(mes: string) {
  return requisitar<ResumoFinanceiroApi>(`/financeiro/resumo?mes=${encodeURIComponent(mes)}`)
}

export function lancarFinanceiro(dados: {
  readonly tipo: 'entrada' | 'saida'
  readonly grupo: GrupoFinanceiro
  /** Centavos. */
  readonly valor: number
  readonly descricao: string
  readonly data: string
  readonly origem: 'manual' | 'voz'
}) {
  return requisitar<{ lancamento: LancamentoFinanceiroApi }>('/financeiro/lancamentos', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function apagarLancamentoFinanceiro(id: string) {
  return requisitar<{ status: 'ok' }>(`/financeiro/lancamentos/${id}`, { method: 'DELETE' })
}

export function criarContaFinanceira(dados: {
  readonly tipo: 'boleto' | 'fixo'
  readonly grupo: 'adega' | 'casa'
  readonly descricao: string
  readonly valor: number
  readonly vencimento?: string
  readonly diaVencimento?: number
  readonly codigoBarras?: string
}) {
  return requisitar<{ conta: ContaFinanceiraApi }>('/financeiro/contas', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function removerContaFinanceira(id: string) {
  return requisitar<{ status: 'ok' }>(`/financeiro/contas/${id}`, { method: 'DELETE' })
}

export function pagarContaFinanceira(
  id: string,
  dados: { readonly competencia: string; readonly valor: number; readonly data: string },
) {
  return requisitar<{ lancamento: LancamentoFinanceiroApi }>(`/financeiro/contas/${id}/pagar`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}
