import { centavos, multiplicarPorQuantidade, somar, type Centavos } from '@adega/core'

/**
 * Carrinho do PDV -- estado puro, sem I/O. Reaproveita a matematica de
 * dinheiro de @adega/core (mesma biblioteca usada pela API) para que o
 * total mostrado na tela nunca divirja do total que o servidor vai
 * calcular de novo em POST /vendas.
 */
export interface ItemCarrinho {
  readonly produtoId: string
  readonly ean: string | null
  readonly descricao: string
  readonly precoUnitario: Centavos
  readonly quantidade: number
}

export function totalItem(item: ItemCarrinho): Centavos {
  return multiplicarPorQuantidade(item.precoUnitario, item.quantidade)
}

export function totalCarrinho(itens: readonly ItemCarrinho[]): Centavos {
  if (itens.length === 0) return centavos(0)
  return somar(...itens.map(totalItem))
}

/** Produto ja no carrinho: soma quantidade em vez de duplicar a linha. */
export function adicionarAoCarrinho(
  itens: readonly ItemCarrinho[],
  novo: ItemCarrinho,
): ItemCarrinho[] {
  const indice = itens.findIndex((i) => i.produtoId === novo.produtoId)
  if (indice === -1) return [...itens, novo]
  const atual = itens[indice]!
  const atualizado = [...itens]
  atualizado[indice] = { ...atual, quantidade: atual.quantidade + novo.quantidade }
  return atualizado
}

export function removerDoCarrinho(
  itens: readonly ItemCarrinho[],
  produtoId: string,
): ItemCarrinho[] {
  return itens.filter((i) => i.produtoId !== produtoId)
}

export function atualizarQuantidade(
  itens: readonly ItemCarrinho[],
  produtoId: string,
  quantidade: number,
): ItemCarrinho[] {
  return itens.map((i) => (i.produtoId === produtoId ? { ...i, quantidade } : i))
}

export interface PagamentoInformado {
  readonly forma: 'dinheiro' | 'pix' | 'debito' | 'credito' | 'voucher'
  readonly valor: Centavos
  /** Qual maquininha fisica recebeu (a loja tem duas) -- so faz sentido
   * pra debito/credito. Usado depois pra separar o relatorio por maquininha. */
  readonly terminalApelido?: string
}

export function totalPagamentos(pagamentos: readonly PagamentoInformado[]): Centavos {
  if (pagamentos.length === 0) return centavos(0)
  return somar(...pagamentos.map((p) => p.valor))
}
