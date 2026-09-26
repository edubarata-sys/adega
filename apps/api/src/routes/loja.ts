import { schema } from '@adega/db'
import { and, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'

/**
 * Loja online (vitrine) da Adega -- PUBLICA, sem login (pedido do cliente
 * 25/09). So leitura: produtos ativos com preco > 0, sem custo, sem dados
 * internos. O pedido NAO passa pelo sistema: o site monta a mensagem e o
 * cliente envia pelo WhatsApp da loja.
 *
 * Fica fora do site: doses e itens soltos/de balcao, tabacaria (venda de
 * cigarro/tabaco pela internet e restrita), variantes de preco por forma de
 * pagamento ("NO CREDITO", "PIX OU DINHEIRO") e itens internos.
 */

const FORA_DO_SITE =
  /\b(DOSE|SOLTO|SOLTA|CIGARR|MARLBORO|ROTHMANS|DUNHILL|WINSTON|CAMEL|LUCKY STRIKE|CHESTERFIELD|NEW YORK|PANDHORA|EIGHT|GIFT|DJARUM|EGIPT|LM |JC |PAIEIRO|PALHEIRO|FUMO|GUDAN|ZOMO|NARG|ESS[EÊ]NCIA|CARV[AÃ]O|PAPELITO|SEDA|BEM BOLADO|CUIA|DESCHAVADOR|ALUMINIO NARGUINE|PRODUTO DIVERSOS|CHIP |TA[CÇ]A DE VINHO|NO CR[EÉ]DITO|PIX OU DINHEIRO|PIX D[EÉ]BITO|3 POR 10|CAVALO DE PALHA|CHANCELER)\b/
const SO_NUMERO = /^\d+$/

const CATEGORIAS: readonly [string, RegExp][] = [
  ['Espetinhos', /\b(ESPETINHO|ESPETO)\b/],
  [
    'Drinks e ices',
    /\b(ICE|COP[AÃ]O|COMBO|DRINK|NUSAKINHO|MANS[AÃ]O|MASCATE|XEQUE|BEATS|CABAR[EÉ]|ROSKOFF|CAIPIRINHA|MIXED|SPRITE ABSOLUT|ABSOLUT LATA|COROTE)\b/,
  ],
  ['Gelo', /\bGELO\b/],
  ['Energéticos', /\b(RED BULL|MONSTER|BALY|ENERG|TNT|BALLENA|HITS POWER|CABRON)\b/],
  [
    'Cervejas',
    /\b(CERVEJA|HEINEKEN|BRAHMA|SKOL|BUDWEISER|CORONA|STELLA|AMSTEL|ITAIPAVA|ORIGINAL|SPATEN|MICHELOB|EISENBAHN?|IMPERIO|PRAYA|THEREZ|COLORADO|BADEN|IPA|PETRA|LOKAL|PILSEN|CARACU|MALZBIER|BLACK PRINCESS|ESTRELLA|ECOBIER|FARDO)\b/,
  ],
  [
    'Vinhos e espumantes',
    /\b(VINHO|ESPUMANTE|LAMBRUSCO|RESERVADO|CASILLERO|TONATTO|PASKUA|P[EÉ]RGOLA|SAKE)\b/,
  ],
  [
    'Destilados',
    /\b(VODKA|WHISK|GIN|GIM|CACHA|PINGA|51|VELHO BARREIRO|SMIRNOFF|ABSOLUT|JACK|RED LABEL|WHITE HORSE|JOHNNIE|CHIVAS|BUCHANAN|PASSAPORT|BALLANTINE|JIM BEAM|LICOR|CONHAQUE|DREHER|ASKOV|SKY|MASTER GOLD|CAMPARI|TANQUERAY|ETERNITY|OPERA|INVICTUS|ROCK'S|CANELINHA|JURUPINGA|CONTINI|GABRIELA|BELL'S|GRANT'S|APERITIVO|CANARINHO|PARATUDO|CUNHA|DI MINAS)\b/,
  ],
  [
    'Refrigerantes, água e sucos',
    /\b(COCA|FANTA|SPRITE|GUARAN|PEPSI|SUCO|DEL VALLE|AGUA|H2O|T[OÔ]NICA|SCHWEPPES|GATORADE|POWER ADE|TROPICAL|FYS|JOANINHA|REFRIGERANTE|TODDYNHO|CA[CÇ]ULINHA|IT GUARANA|XEQUE)\b/,
  ],
]

function categoria(descricao: string): string {
  for (const [nome, rx] of CATEGORIAS) if (rx.test(descricao)) return nome
  return 'Petiscos, doces e outros'
}

export function registrarRotasLoja(app: FastifyInstance, deps: DependenciasApp): void {
  app.get('/loja/produtos', async (_request, reply) => {
    const linhas = await deps.db
      .select({
        id: schema.produtos.id,
        ean: schema.produtos.ean,
        descricao: schema.produtos.descricao,
        preco: schema.produtos.precoVenda,
        estoque: schema.estoqueSaldos.quantidade,
      })
      .from(schema.produtos)
      .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
      .where(and(eq(schema.produtos.ativo, true), gt(schema.produtos.precoVenda, 0)))
      .orderBy(schema.produtos.descricao)

    const produtos = linhas
      .filter((p) => !FORA_DO_SITE.test(` ${p.descricao} `) && !SO_NUMERO.test(p.descricao))
      .map((p) => ({
        id: p.id,
        ean: p.ean,
        nome: p.descricao,
        preco: p.preco,
        categoria: categoria(p.descricao),
        // Estoque ainda em recontagem (09/2026): o site NAO esconde nada por
        // estoque por enquanto -- so informa. Ligar depois da recontagem.
        emEstoque: Number(p.estoque ?? 0) > 0,
      }))

    return reply.header('cache-control', 'public, max-age=60').send({ produtos })
  })
}
