import type { Centavos } from './dinheiro'
import type { FormaPagamento } from './venda'

/**
 * Porta de integracao com uma adquirente/TEF (arquitetura §6). A Fase 1 so
 * tem UMA implementacao real desta porta: `ManualAdapter`, abaixo. Rede,
 * Itau e qualquer TEF de verdade estao explicitamente fora do escopo desta
 * missao -- nao pesquisar, nao implementar, nao tentar "preparar o terreno"
 * chutando um formato de payload que ninguem validou.
 *
 * A porta existe MESMO SO COM UMA IMPLEMENTACAO porque `routes/vendas.ts`
 * (o nucleo da venda) so deve conhecer esta interface, nunca o adapter
 * concreto -- e o que torna dia trocar `ManualAdapter` por um adapter real
 * de adquirente uma mudanca de UMA linha (qual adapter e injetado), sem
 * tocar a logica de venda.
 */
export interface ResultadoProcessamentoPagamento {
  readonly confirmado: boolean
  /** Nulo ate existir integracao real -- nunca inventar um valor aqui. */
  readonly adquirente: string | null
  readonly nsu: string | null
  readonly autorizacao: string | null
  readonly bandeira: string | null
  readonly parcelas: number | null
  readonly observacao: string
}

export interface EntradaProcessamentoPagamento {
  readonly forma: FormaPagamento
  readonly valor: Centavos
}

export interface AdaptadorPagamento {
  processar(entrada: EntradaProcessamentoPagamento): ResultadoProcessamentoPagamento
}

/**
 * Adapter oficial da Fase 1 (decisao congelada da Torre, secao 3 da ordem
 * da missao). NAO fala com nenhuma maquininha ou API de adquirente --
 * apenas registra que o OPERADOR confirmou visualmente que o pagamento
 * ocorreu (dinheiro contado, maquininha aprovou na tela dela, PIX caiu na
 * conta). Por isso `confirmado` e sempre `true`: recusar um pagamento e
 * decisao do operador, tomada ANTES de chamar isto (na tela do PDV).
 *
 * O que este adapter NUNCA faz: inventar `nsu`, `autorizacao` ou `bandeira`
 * para parecer que passou por uma adquirente de verdade. Esses campos
 * existem no schema (`pagamentos`) para quando uma integracao real chegar
 * (conciliacao automatica); ate la ficam nulos e a conciliacao e manual
 * (`conciliacaoStatus: 'pendente'`, ja o default do schema).
 */
export const ManualAdapter: AdaptadorPagamento = {
  processar(entrada: EntradaProcessamentoPagamento): ResultadoProcessamentoPagamento {
    return {
      confirmado: true,
      adquirente: null,
      nsu: null,
      autorizacao: null,
      bandeira: null,
      parcelas: null,
      observacao: `Pagamento em ${entrada.forma} confirmado manualmente pelo operador -- sem integracao com adquirente/TEF (fora de escopo da Fase 1).`,
    }
  },
}
