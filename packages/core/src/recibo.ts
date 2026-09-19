import type { Centavos } from './dinheiro'
import { formatarBRL } from './dinheiro'

/**
 * Geracao de recibo/comprovante -- PURA (zero I/O, testavel sem impressora
 * nenhuma). Decisao congelada da Torre (secao 6 da ordem da missao):
 * window.print() NUNCA pode ser a UNICA arquitetura de impressao -- este
 * modulo e o que da uma alternativa real: texto formatado para bobina de
 * 58mm + um encoder de comandos ESC/POS, ambos determinísticos e
 * independentes de qualquer hardware.
 *
 * 58mm com fonte padrao de impressoras termicas de balcao (Epson TM-T20 e
 * equivalentes) cabe tipicamente 32 colunas monoespacadas -- e a largura
 * usada aqui.
 */
export const LARGURA_RECIBO_58MM = 32

/** Texto obrigatorio (decisao congelada da Torre): este sistema nao emite
 * documento fiscal na Fase 1 -- nenhum recibo pode sair sem isto. */
export const AVISO_SEM_VALOR_FISCAL = 'DEMONSTRAÇÃO — SEM VALOR FISCAL'

export interface ItemRecibo {
  readonly descricao: string
  readonly quantidade: number
  readonly precoUnitario: Centavos
  readonly total: Centavos
}

export interface PagamentoRecibo {
  readonly forma: string
  readonly valor: Centavos
  readonly troco: Centavos
}

export interface DadosRecibo {
  readonly vendaId: string
  readonly numero: number | null
  readonly itens: readonly ItemRecibo[]
  readonly subtotal: Centavos
  readonly desconto: Centavos
  readonly total: Centavos
  readonly pagamentos: readonly PagamentoRecibo[]
  readonly operadorNome: string
  /** Injetado, nunca `new Date()` interno -- e o que torna a geracao
   * determinística e testavel sem congelar o relogio do processo. */
  readonly ocorridoEm: Date
}

function centralizar(texto: string, largura = LARGURA_RECIBO_58MM): string {
  const cortado = texto.slice(0, largura)
  const espacoTotal = largura - cortado.length
  const esquerda = Math.floor(espacoTotal / 2)
  const direita = espacoTotal - esquerda
  return ' '.repeat(esquerda) + cortado + ' '.repeat(direita)
}

function linhaSeparadora(largura = LARGURA_RECIBO_58MM): string {
  return '-'.repeat(largura)
}

/** Rotulo a esquerda, valor a direita, com o meio preenchido de espaco.
 * Se nao couber, o rotulo e cortado (nunca o valor -- dinheiro nunca e
 * truncado num recibo). */
function linhaComValorNaDireita(
  rotulo: string,
  valor: string,
  largura = LARGURA_RECIBO_58MM,
): string {
  const espacoDisponivel = Math.max(0, largura - valor.length - 1)
  const rotuloCortado = rotulo.slice(0, espacoDisponivel)
  const preenchimento = largura - rotuloCortado.length - valor.length
  return rotuloCortado + ' '.repeat(Math.max(1, preenchimento)) + valor
}

function quebrarTexto(texto: string, largura = LARGURA_RECIBO_58MM): string[] {
  if (texto.length <= largura) return [texto]
  const palavras = texto.split(' ')
  const linhas: string[] = []
  let atual = ''
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra
    if (tentativa.length > largura) {
      if (atual) linhas.push(atual)
      atual = palavra.slice(0, largura)
    } else {
      atual = tentativa
    }
  }
  if (atual) linhas.push(atual)
  return linhas
}

/**
 * Gera o recibo como linhas de texto puro, prontas para uma bobina de 58mm
 * (fonte monoespacada, `LARGURA_RECIBO_58MM` colunas). Deterministico: a
 * mesma entrada sempre produz a mesma saida, o que e o que permite testar
 * isto sem impressora nenhuma.
 */
export function gerarLinhasRecibo(dados: DadosRecibo): string[] {
  const linhas: string[] = []
  const largura = LARGURA_RECIBO_58MM

  linhas.push(centralizar('SISTEMA DA ADEGA', largura))
  linhas.push(centralizar(AVISO_SEM_VALOR_FISCAL, largura))
  linhas.push(linhaSeparadora(largura))
  linhas.push(`Venda: ${dados.numero ?? dados.vendaId.slice(0, 8)}`)
  linhas.push(`Data: ${dados.ocorridoEm.toISOString().replace('T', ' ').slice(0, 19)}`)
  linhas.push(`Operador: ${dados.operadorNome}`)
  linhas.push(linhaSeparadora(largura))

  for (const item of dados.itens) {
    for (const linhaDescricao of quebrarTexto(item.descricao, largura)) {
      linhas.push(linhaDescricao)
    }
    linhas.push(
      linhaComValorNaDireita(
        `  ${item.quantidade} x ${formatarBRL(item.precoUnitario)}`,
        formatarBRL(item.total),
        largura,
      ),
    )
  }

  linhas.push(linhaSeparadora(largura))
  linhas.push(linhaComValorNaDireita('Subtotal', formatarBRL(dados.subtotal), largura))
  if (dados.desconto > 0) {
    linhas.push(linhaComValorNaDireita('Desconto', `-${formatarBRL(dados.desconto)}`, largura))
  }
  linhas.push(linhaComValorNaDireita('TOTAL', formatarBRL(dados.total), largura))
  linhas.push(linhaSeparadora(largura))

  for (const pagamento of dados.pagamentos) {
    linhas.push(linhaComValorNaDireita(pagamento.forma, formatarBRL(pagamento.valor), largura))
    if (pagamento.troco > 0) {
      linhas.push(linhaComValorNaDireita('Troco', formatarBRL(pagamento.troco), largura))
    }
  }

  linhas.push(linhaSeparadora(largura))
  linhas.push(centralizar(AVISO_SEM_VALOR_FISCAL, largura))
  linhas.push(centralizar('Obrigado pela preferencia!', largura))

  return linhas
}

const ESC = 0x1b
const GS = 0x1d

/**
 * Contrato PRONTO PARA ESC/POS (decisao congelada da Torre): codifica as
 * linhas em bytes de comando reais (inicializar -> texto -> alimentar ->
 * cortar papel) que uma impressora termica ESC/POS entende. Isto NUNCA foi
 * validado contra uma impressora fisica -- e um contrato correto e
 * determinístico, nao uma alegacao de compatibilidade com hardware real.
 * Antes de ligar numa impressora de verdade, a pagina de codigo (aqui os
 * bytes de texto sao UTF-8) precisa ser conferida contra o manual do
 * modelo especifico -- fora do escopo desta missao.
 */
export function gerarComandosEscPos(linhas: readonly string[]): Uint8Array {
  const partes: number[] = []

  // ESC @ -- inicializa a impressora (reseta estado de formatacao).
  partes.push(ESC, 0x40)

  const codificador = new TextEncoder()
  for (const linha of linhas) {
    partes.push(...codificador.encode(linha))
    partes.push(0x0a) // LF
  }

  // Alimenta um pouco de papel antes de cortar, para o corte nao pegar texto.
  partes.push(ESC, 0x64, 0x03) // ESC d 3 -- feed 3 linhas

  // GS V 1 -- corte parcial de papel.
  partes.push(GS, 0x56, 0x01)

  return new Uint8Array(partes)
}
