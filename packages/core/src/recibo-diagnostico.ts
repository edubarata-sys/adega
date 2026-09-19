import { centavos } from './dinheiro'
import type { DadosRecibo } from './recibo'

/**
 * Dados fixos do recibo de teste usado na pagina de diagnostico de
 * hardware (`/diagnostico`). Vive aqui, em `@adega/core` (zero I/O), para
 * que a API local (`apps/api/src/routes/diagnostico.ts`, usada quando o
 * ambiente roda no PC da loja) e a build estatica standalone da pagina
 * (usada quando a pagina e hospedada sem backend nenhum, ex.: FTP num
 * servidor compartilhado) gerem exatamente o mesmo recibo -- uma unica
 * fonte da verdade, sem risco de as duas vias divergirem.
 *
 * O segundo e terceiro item existem so para o teste de caracteres pedido
 * pela Torre (resposta de especificacoes de hardware, secao 2C): ASCII,
 * acentos minusculos e maiusculos, cedilha e R$ -- tudo passando pelo
 * MESMO encoder UTF-8 que `gerarComandosEscPos` usa, sem nenhuma tentativa
 * de escolher uma codepage especifica (isso a Torre marcou explicitamente
 * como DESCOBRIR_NO_TESTE, nao para o software decidir sozinho).
 */
export const DADOS_RECIBO_DIAGNOSTICO: DadosRecibo = {
  vendaId: '00000000-0000-0000-0000-000000000000',
  numero: null,
  ocorridoEm: new Date('2026-01-01T12:00:00.000Z'),
  operadorNome: 'Diagnostico de Hardware',
  itens: [
    {
      descricao: 'Item de teste (impressora)',
      quantidade: 1,
      precoUnitario: centavos(1000),
      total: centavos(1000),
    },
    {
      descricao: 'Caracteres: aeiou AEIOU ao AO c C R$',
      quantidade: 1,
      precoUnitario: centavos(0),
      total: centavos(0),
    },
    {
      descricao: 'áéíóú ÁÉÍÓÚ ãõ ÃÕ ç Ç R$ 0123456789',
      quantidade: 1,
      precoUnitario: centavos(0),
      total: centavos(0),
    },
  ],
  subtotal: centavos(1000),
  desconto: centavos(0),
  total: centavos(1000),
  pagamentos: [{ forma: 'dinheiro', valor: centavos(1000), troco: centavos(0) }],
}
