import type { Centavos } from './dinheiro'
import { ZERO, formatarBRL, somar } from './dinheiro'
import type { FormaPagamento } from './venda'

/**
 * Relatorio de vendas em XML -- PURO (zero I/O, testavel sem banco nenhum).
 *
 * Decisao registrada na conversa com o dono da loja: a contadora NAO precisa
 * de XML fiscal (isso e resolvido pelo PDV da adquirente/Itau, fora deste
 * sistema) -- ela so pediu "um XML" com o extrato de vendas do periodo, sem
 * layout especifico exigido. Este modulo gera exatamente isso: um extrato
 * plano, legivel por humano e por qualquer ferramenta que leia XML (Excel
 * inclusive), com os totais quebrados por forma de pagamento e por
 * maquininha (a loja tem duas), alem do total combinado -- "separado por
 * maquininha e junto" foi o pedido exato.
 *
 * So pagamentos em debito/credito tem maquininha (dinheiro e pix nao
 * passam por nenhuma das duas). Um pagamento de cartao sem
 * `terminalApelido` (operador nao selecionou, ou venda antiga de antes
 * deste campo existir) cai no grupo "nao identificada" -- nunca e
 * descartado do total.
 */

export interface PagamentoRelatorio {
  readonly forma: FormaPagamento
  readonly valor: Centavos
  /** Apelido da maquininha (ex.: "Maquininha 1"), so relevante pra
   * debito/credito. Nulo = nao informado ou nao se aplica. */
  readonly terminalApelido: string | null
}

export interface VendaRelatorio {
  readonly vendaId: string
  readonly numero: number | null
  readonly ocorridoEm: Date
  readonly total: Centavos
  readonly pagamentos: readonly PagamentoRelatorio[]
}

export interface DadosRelatorioVendas {
  readonly periodoInicio: Date
  readonly periodoFim: Date
  readonly vendas: readonly VendaRelatorio[]
}

interface GrupoAgregado {
  readonly chave: string
  readonly total: Centavos
  readonly quantidade: number
}

const FORMAS_DE_MAQUININHA: readonly FormaPagamento[] = ['debito', 'credito']
const MAQUININHA_NAO_IDENTIFICADA = 'Nao identificada'

function agrupar<T>(
  itens: readonly T[],
  chaveDe: (item: T) => string,
  valorDe: (item: T) => Centavos,
): GrupoAgregado[] {
  const porChave = new Map<string, { total: Centavos; quantidade: number }>()
  for (const item of itens) {
    const chave = chaveDe(item)
    const atual = porChave.get(chave) ?? { total: ZERO, quantidade: 0 }
    porChave.set(chave, {
      total: somar(atual.total, valorDe(item)),
      quantidade: atual.quantidade + 1,
    })
  }
  return [...porChave.entries()]
    .map(([chave, v]) => ({ chave, total: v.total, quantidade: v.quantidade }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

function todosPagamentos(
  vendas: readonly VendaRelatorio[],
): readonly { venda: VendaRelatorio; pagamento: PagamentoRelatorio }[] {
  return vendas.flatMap((venda) => venda.pagamentos.map((pagamento) => ({ venda, pagamento })))
}

/** Soma bruta de tudo que entrou no periodo, uma so vez por venda (nao por
 * pagamento) -- o que a contadora chama de "faturamento". */
export function calcularTotalPeriodo(dados: DadosRelatorioVendas): Centavos {
  if (dados.vendas.length === 0) return ZERO
  return somar(...dados.vendas.map((v) => v.total))
}

/** Quebra por forma de pagamento (dinheiro/pix/debito/credito/voucher). */
export function agruparPorFormaPagamento(dados: DadosRelatorioVendas): GrupoAgregado[] {
  const pares = todosPagamentos(dados.vendas)
  return agrupar(
    pares,
    (p) => p.pagamento.forma,
    (p) => p.pagamento.valor,
  )
}

/** Quebra so os pagamentos de cartao (debito/credito) por maquininha --
 * "separado por maquininha" do pedido original. */
export function agruparPorMaquininha(dados: DadosRelatorioVendas): GrupoAgregado[] {
  const pares = todosPagamentos(dados.vendas).filter((p) =>
    FORMAS_DE_MAQUININHA.includes(p.pagamento.forma),
  )
  return agrupar(
    pares,
    (p) => p.pagamento.terminalApelido ?? MAQUININHA_NAO_IDENTIFICADA,
    (p) => p.pagamento.valor,
  )
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatarData(data: Date): string {
  return data.toISOString().slice(0, 10)
}

function formatarDataHora(data: Date): string {
  return data.toISOString()
}

/** Centavos crus (sem "R$") -- mais facil de importar numa planilha do que
 * o formato de exibicao; `formatarBRL` fica so no atributo `formatado`. */
function valorEmReais(valor: Centavos): string {
  return (valor / 100).toFixed(2)
}

/**
 * Gera o XML do extrato de vendas do periodo. Deterministico: a mesma
 * entrada sempre produz a mesma saida (mesma ordem de agrupamento e de
 * vendas), o que e o que permite testar isto sem banco nenhum.
 */
export function gerarXmlRelatorioVendas(dados: DadosRelatorioVendas): string {
  const total = calcularTotalPeriodo(dados)
  const porForma = agruparPorFormaPagamento(dados)
  const porMaquininha = agruparPorMaquininha(dados)

  const linhas: string[] = []
  linhas.push('<?xml version="1.0" encoding="UTF-8"?>')
  linhas.push('<RelatorioVendas>')
  linhas.push(
    `  <Periodo inicio="${formatarData(dados.periodoInicio)}" fim="${formatarData(dados.periodoFim)}" />`,
  )
  linhas.push('  <Resumo>')
  linhas.push(`    <QuantidadeVendas>${dados.vendas.length}</QuantidadeVendas>`)
  linhas.push(
    `    <Total valor="${valorEmReais(total)}" formatado="${escaparXml(formatarBRL(total))}" />`,
  )
  linhas.push('  </Resumo>')

  linhas.push('  <PorFormaPagamento>')
  for (const grupo of porForma) {
    linhas.push(
      `    <Forma nome="${escaparXml(grupo.chave)}" quantidade="${grupo.quantidade}" valor="${valorEmReais(grupo.total)}" formatado="${escaparXml(formatarBRL(grupo.total))}" />`,
    )
  }
  linhas.push('  </PorFormaPagamento>')

  linhas.push('  <PorMaquininha>')
  for (const grupo of porMaquininha) {
    linhas.push(
      `    <Maquininha apelido="${escaparXml(grupo.chave)}" quantidade="${grupo.quantidade}" valor="${valorEmReais(grupo.total)}" formatado="${escaparXml(formatarBRL(grupo.total))}" />`,
    )
  }
  linhas.push('  </PorMaquininha>')

  linhas.push('  <Vendas>')
  for (const venda of dados.vendas) {
    linhas.push(
      `    <Venda id="${escaparXml(venda.vendaId)}" numero="${venda.numero ?? ''}" data="${formatarDataHora(venda.ocorridoEm)}" total="${valorEmReais(venda.total)}">`,
    )
    for (const pagamento of venda.pagamentos) {
      const maquininha = pagamento.terminalApelido
        ? ` maquininha="${escaparXml(pagamento.terminalApelido)}"`
        : ''
      linhas.push(
        `      <Pagamento forma="${escaparXml(pagamento.forma)}" valor="${valorEmReais(pagamento.valor)}"${maquininha} />`,
      )
    }
    linhas.push('    </Venda>')
  }
  linhas.push('  </Vendas>')

  linhas.push('</RelatorioVendas>')
  return linhas.join('\n')
}
