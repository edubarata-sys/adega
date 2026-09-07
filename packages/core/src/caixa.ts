import type { Centavos } from './dinheiro'
import { ZERO, centavos } from './dinheiro'
import type { Resultado } from './resultado'
import { falha, ok } from './resultado'

export const TIPOS_MOVIMENTO_CAIXA = ['sangria', 'suprimento', 'despesa', 'entrada_avulsa'] as const
export type TipoMovimentoCaixa = (typeof TIPOS_MOVIMENTO_CAIXA)[number]

export interface MovimentoCaixa {
  readonly tipo: TipoMovimentoCaixa
  readonly valor: Centavos
}

export interface EntradaFechamento {
  readonly fundoTroco: Centavos
  /** Somente a parcela em DINHEIRO das vendas. Cartao e pix nao passam pela gaveta. */
  readonly vendasEmDinheiro: Centavos
  readonly movimentos: readonly MovimentoCaixa[]
  readonly valorContado: Centavos
}

export interface Fechamento {
  readonly esperado: Centavos
  readonly contado: Centavos
  /** Negativo = falta dinheiro na gaveta. Positivo = sobra. */
  readonly diferenca: Centavos
}

/**
 * Fechamento cego: quem opera digita `valorContado` ANTES de ver `esperado`.
 * Esta funcao so calcula; e a UI que garante a ordem. Mostrar o esperado antes
 * transforma a conferencia em teatro e nao detecta desvio nenhum.
 */
export function calcularFechamento(entrada: EntradaFechamento): Fechamento {
  let esperado = entrada.fundoTroco + entrada.vendasEmDinheiro

  for (const m of entrada.movimentos) {
    if (m.valor < 0) {
      throw new RangeError(`Movimento de caixa com valor negativo: ${m.tipo}`)
    }
    switch (m.tipo) {
      case 'suprimento':
      case 'entrada_avulsa':
        esperado += m.valor
        break
      case 'sangria':
      case 'despesa':
        esperado -= m.valor
        break
    }
  }

  const esperadoFinal = centavos(esperado)
  return {
    esperado: esperadoFinal,
    contado: entrada.valorContado,
    diferenca: centavos(entrada.valorContado - esperadoFinal),
  }
}

export type StatusSessaoCaixa = 'aberta' | 'fechada'

export interface EstadoSessaoCaixa {
  readonly status: StatusSessaoCaixa
}

export interface EstadoDispositivo {
  /** Vendas gravadas no dispositivo que ainda nao subiram para o servidor. */
  readonly vendasPendentesNaFila: number
}

/**
 * TRAVA DE FECHAMENTO (arquitetura §2.1).
 *
 * Fechar com fila pendente calcularia `esperado` sem vendas que existem:
 * produz diferenca fantasma e mascara divergencia real.
 *
 * PREMISSA DA FASE 1: UM UNICO TERMINAL DE PDV. Com dois ou mais PDVs a fila
 * local deixa de ser informacao suficiente -- nenhum terminal sabe se os outros
 * tem venda pendente -- e a trava vira consenso distribuido. Fora de escopo.
 */
export function podeFecharCaixa(
  sessao: EstadoSessaoCaixa,
  dispositivo: EstadoDispositivo,
): Resultado<null> {
  if (!Number.isInteger(dispositivo.vendasPendentesNaFila) || dispositivo.vendasPendentesNaFila < 0) {
    throw new RangeError(
      `Contagem de fila invalida: ${dispositivo.vendasPendentesNaFila}`,
    )
  }
  if (sessao.status === 'fechada') {
    return falha('CAIXA_JA_FECHADO', 'Esta sessao de caixa ja foi fechada.')
  }
  if (dispositivo.vendasPendentesNaFila > 0) {
    return falha(
      'CAIXA_COM_FILA_PENDENTE',
      `Existem ${dispositivo.vendasPendentesNaFila} venda(s) aguardando sincronizacao. ` +
        'Aguarde a internet voltar ou cancele as vendas pendentes antes de fechar.',
    )
  }
  return ok(null)
}

export const FUNDO_TROCO_ZERO = ZERO
