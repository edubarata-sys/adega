import type { Centavos } from './dinheiro'
import { ZERO, formatarBRL, multiplicarPorQuantidade, somar, subtrair } from './dinheiro'
import type { Resultado } from './resultado'
import { falha, ok } from './resultado'

export const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'debito', 'credito', 'voucher'] as const
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]

/** Apenas dinheiro devolve troco. Cartao/pix/voucher nao podem exceder o total. */
export function geraTroco(forma: FormaPagamento): boolean {
  return forma === 'dinheiro'
}

export interface ItemVenda {
  readonly quantidade: number
  readonly precoUnitario: Centavos
  readonly descontoItem?: Centavos
}

export interface ItemCalculado {
  readonly quantidade: number
  readonly precoUnitario: Centavos
  readonly bruto: Centavos
  readonly desconto: Centavos
  readonly total: Centavos
}

export interface VendaCalculada {
  readonly itens: readonly ItemCalculado[]
  readonly subtotal: Centavos
  readonly desconto: Centavos
  readonly total: Centavos
}

export interface Pagamento {
  readonly forma: FormaPagamento
  readonly valor: Centavos
}

export interface ResumoPagamento {
  readonly totalPago: Centavos
  readonly troco: Centavos
}

export function calcularItem(item: ItemVenda): Resultado<ItemCalculado> {
  if (item.quantidade <= 0) {
    return falha('ITEM_QUANTIDADE_INVALIDA', 'Quantidade deve ser maior que zero.')
  }
  if (item.precoUnitario < 0) {
    return falha('ITEM_PRECO_NEGATIVO', 'Preco unitario nao pode ser negativo.')
  }

  const desconto = item.descontoItem ?? ZERO
  if (desconto < 0) {
    return falha('ITEM_DESCONTO_NEGATIVO', 'Desconto nao pode ser negativo.')
  }

  const bruto = multiplicarPorQuantidade(item.precoUnitario, item.quantidade)
  if (desconto > bruto) {
    return falha('ITEM_DESCONTO_MAIOR_QUE_ITEM', 'Desconto do item nao pode exceder o valor do item.')
  }

  return ok({
    quantidade: item.quantidade,
    precoUnitario: item.precoUnitario,
    bruto,
    desconto,
    total: subtrair(bruto, desconto),
  })
}

export function calcularVenda(
  itens: readonly ItemVenda[],
  descontoGeral: Centavos = ZERO,
): Resultado<VendaCalculada> {
  if (itens.length === 0) {
    return falha('VENDA_SEM_ITENS', 'Venda precisa de ao menos um item.')
  }
  if (descontoGeral < 0) {
    return falha('VENDA_DESCONTO_NEGATIVO', 'Desconto nao pode ser negativo.')
  }

  const calculados: ItemCalculado[] = []
  for (const item of itens) {
    const r = calcularItem(item)
    if (!r.ok) return r
    calculados.push(r.valor)
  }

  const subtotal = somar(...calculados.map((i) => i.total))
  if (descontoGeral > subtotal) {
    return falha('VENDA_DESCONTO_MAIOR_QUE_TOTAL', 'Desconto nao pode exceder o subtotal da venda.')
  }

  return ok({
    itens: calculados,
    subtotal,
    desconto: descontoGeral,
    total: subtrair(subtotal, descontoGeral),
  })
}

/**
 * Confere os pagamentos de uma venda.
 *
 * Regra central: venda dividida e normal em adega, mas so dinheiro devolve troco.
 * Se cartao/pix somarem mais que o total, e erro de digitacao do operador --
 * aceitar isso silenciosamente criaria "troco" que a maquininha nunca devolveu.
 */
export function conferirPagamentos(
  total: Centavos,
  pagamentos: readonly Pagamento[],
): Resultado<ResumoPagamento> {
  if (pagamentos.length === 0) {
    return falha('PAGAMENTO_AUSENTE', 'Venda precisa de ao menos um pagamento.')
  }
  for (const p of pagamentos) {
    if (p.valor <= 0) {
      return falha('PAGAMENTO_VALOR_INVALIDO', 'Valor do pagamento deve ser maior que zero.')
    }
  }

  const naoDinheiro = pagamentos.filter((p) => !geraTroco(p.forma))
  const somaNaoDinheiro = naoDinheiro.length > 0 ? somar(...naoDinheiro.map((p) => p.valor)) : ZERO

  if (somaNaoDinheiro > total) {
    return falha(
      'PAGAMENTO_SEM_TROCO_EXCEDE',
      'Pagamentos que nao devolvem troco nao podem exceder o total da venda.',
    )
  }

  const totalPago = somar(...pagamentos.map((p) => p.valor))
  if (totalPago < total) {
    return falha(
      'PAGAMENTO_INSUFICIENTE',
      `Faltam ${formatarBRL(subtrair(total, totalPago))} para fechar a venda.`,
    )
  }

  return ok({ totalPago, troco: subtrair(totalPago, total) })
}
