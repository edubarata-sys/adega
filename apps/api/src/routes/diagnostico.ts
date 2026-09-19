import { DADOS_RECIBO_DIAGNOSTICO, gerarComandosEscPos, gerarLinhasRecibo } from '@adega/core'
import type { FastifyInstance } from 'fastify'

/**
 * Ambiente de teste de hardware (fora dos 10 PASSOs da missao ponta-a-ponta,
 * pedido depois pelo cliente): pagina publica, SEM autenticacao, pra o
 * cliente testar pistola de codigo de barras e impressora ANTES de logar ou
 * de qualquer venda real existir. Por isso este recibo nao vem do banco --
 * usa dados fixos (DADOS_RECIBO_DIAGNOSTICO, em @adega/core), so pra
 * exercitar o mesmo contrato de texto + ESC/POS que a venda real usa
 * (packages/core/recibo.ts).
 *
 * Esta rota so existe pra quando o ambiente roda no PC da loja (API local
 * de verdade rodando). Quando a pagina e hospedada sem backend nenhum
 * (build estatica, ex.: FTP num servidor compartilhado), a propria pagina
 * gera o mesmo recibo localmente no navegador, chamando os mesmos
 * geradores puros direto -- ver apps/web/src/DiagnosticoTela.tsx.
 */
export function registrarRotasDiagnostico(app: FastifyInstance): void {
  app.get('/diagnostico/recibo-teste', async () => {
    const linhas = gerarLinhasRecibo(DADOS_RECIBO_DIAGNOSTICO)
    const bytes = gerarComandosEscPos(linhas)
    return { linhas, escPosBase64: Buffer.from(bytes).toString('base64') }
  })
}
