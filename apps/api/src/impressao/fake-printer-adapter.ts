import { gerarComandosEscPos, gerarLinhasRecibo, type DadosRecibo } from '@adega/core'

/**
 * Porta de impressao (arquitetura -- decisao congelada da Torre, secao 6):
 * `window.print()` NUNCA pode ser a UNICA arquitetura de impressao. Esta
 * interface e o que torna trocar `FakePrinterAdapter` por uma impressora
 * real (USB/serial/rede) uma mudanca de UM adapter, sem tocar quem chama.
 */
export interface ResultadoImpressao {
  readonly impresso: boolean
  readonly linhas: readonly string[]
  readonly comandosEscPos: Uint8Array
}

export interface AdaptadorImpressora {
  imprimir(dados: DadosRecibo): Promise<ResultadoImpressao> | ResultadoImpressao
}

/**
 * Impressora oficial da Fase 1 (nao existe impressora fisica conectada
 * nesta missao -- decisao congelada da Torre). NAO fala com nenhum
 * hardware: gera o recibo (texto formatado para 58mm + bytes ESC/POS)
 * pela mesma logica pura de packages/core que os testes exercitam sem
 * impressora nenhuma, e apenas devolve o resultado -- e o suficiente para
 * provar que o restante do sistema (venda -> recibo -> "impressao") esta
 * de pe de ponta a ponta. NUNCA afirmar que uma impressora real vai
 * funcionar so porque isto funciona.
 */
export const FakePrinterAdapter: AdaptadorImpressora = {
  imprimir(dados: DadosRecibo): ResultadoImpressao {
    const linhas = gerarLinhasRecibo(dados)
    const comandosEscPos = gerarComandosEscPos(linhas)
    return { impresso: true, linhas, comandosEscPos }
  },
}
