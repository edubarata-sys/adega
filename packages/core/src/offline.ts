/**
 * Regras puras do modo offline do PDV (arquitetura §2): busca no catalogo
 * guardado no navegador e calculo da venda sem servidor. Ficam no core para
 * o PDV offline e a API darem EXATAMENTE o mesmo resultado (mesmo calculo de
 * total/troco, mesma busca por palavra sem acento, mesmos candidatos de EAN).
 */

import { centavos, type Centavos } from './dinheiro'
import { calcularVenda, conferirPagamentos, type FormaPagamento } from './venda'

/** Variantes do mesmo codigo de barras (EAN-13 com zero na frente = UPC-A). */
export function candidatosEan(eanBruto: string): string[] {
  const digitos = eanBruto.trim()
  const candidatos = new Set<string>([digitos])
  if (digitos.length === 13 && digitos.startsWith('0')) {
    candidatos.add(digitos.slice(1))
  }
  if (digitos.length === 12) {
    candidatos.add(`0${digitos}`)
  }
  return [...candidatos]
}

export function palavrasDeBusca(texto: string): string[] {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean)
}

export interface ProdutoCatalogo {
  readonly id: string
  readonly ean: string | null
  readonly descricao: string
  readonly precoVenda: number
  readonly estoqueAtual: number | string | null
}

function porDescricao(a: ProdutoCatalogo, b: ProdutoCatalogo): number {
  return a.descricao.localeCompare(b.descricao, 'pt-BR')
}

/** Mesmo criterio de GET /produtos/ean/:ean: todos os produtos com o codigo. */
export function buscarEanNoCatalogo(
  catalogo: readonly ProdutoCatalogo[],
  ean: string,
): ProdutoCatalogo[] {
  const candidatos = new Set(candidatosEan(ean))
  return catalogo.filter((p) => p.ean !== null && candidatos.has(p.ean)).sort(porDescricao)
}

/** Mesmo criterio de GET /produtos?q=: cada palavra no nome, sem acento. */
export function buscarNomeNoCatalogo(
  catalogo: readonly ProdutoCatalogo[],
  termo: string,
  limite = 20,
): ProdutoCatalogo[] {
  const palavras = palavrasDeBusca(termo)
  if (palavras.length === 0) return []
  return catalogo
    .filter((p) => {
      const nome = palavrasDeBusca(p.descricao).join(' ')
      return palavras.every((palavra) => nome.includes(palavra))
    })
    .sort(porDescricao)
    .slice(0, limite)
}

export interface ItemVendaOffline {
  readonly produtoId: string
  readonly descricao: string
  readonly quantidade: number
  readonly precoUnitario: number
}

export interface PagamentoVendaOffline {
  readonly forma: FormaPagamento
  readonly valor: number
  readonly terminalApelido?: string
}

export interface VendaOfflineCalculada {
  readonly subtotal: Centavos
  readonly desconto: Centavos
  readonly total: Centavos
  readonly pagamentos: ReadonlyArray<{ forma: FormaPagamento; valor: Centavos; troco: Centavos }>
  readonly itens: ReadonlyArray<{
    descricao: string
    quantidade: number
    precoUnitario: Centavos
    total: Centavos
  }>
}

/**
 * Calcula a venda do jeito que POST /vendas calcularia (mesmas funcoes do
 * core), para o PDV mostrar total/troco e o recibo mesmo sem internet. Erro
 * aqui = a venda tambem seria recusada no servidor: nao vai pra fila.
 */
export function calcularVendaOffline(
  itens: readonly ItemVendaOffline[],
  pagamentos: readonly PagamentoVendaOffline[],
): { ok: true; valor: VendaOfflineCalculada } | { ok: false; motivo: string } {
  const venda = calcularVenda(
    itens.map((i) => ({ quantidade: i.quantidade, precoUnitario: centavos(i.precoUnitario) })),
  )
  if (!venda.ok) return { ok: false, motivo: venda.erro.mensagem }
  if (pagamentos.filter((p) => p.forma === 'dinheiro').length > 1) {
    return {
      ok: false,
      motivo:
        'Apenas um pagamento em dinheiro e suportado por venda (para trocar sem ambiguidade).',
    }
  }
  const normalizados = pagamentos.map((p) => ({ forma: p.forma, valor: centavos(p.valor) }))
  const resumo = conferirPagamentos(venda.valor.total, normalizados)
  if (!resumo.ok) return { ok: false, motivo: resumo.erro.mensagem }
  return {
    ok: true,
    valor: {
      subtotal: venda.valor.subtotal,
      desconto: venda.valor.desconto,
      total: venda.valor.total,
      pagamentos: normalizados.map((p) => ({
        ...p,
        troco: p.forma === 'dinheiro' ? resumo.valor.troco : centavos(0),
      })),
      itens: venda.valor.itens.map((calc, i) => ({
        descricao: itens[i]!.descricao,
        quantidade: calc.quantidade,
        precoUnitario: calc.precoUnitario,
        total: calc.total,
      })),
    },
  }
}
