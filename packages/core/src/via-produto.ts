import type { Centavos } from './dinheiro'

/**
 * VIAS do caixa (pedido do dono, 02/10/2026): o balcao continua vendendo
 * tudo junto, num caixa so -- a divisao existe SO nos relatorios.
 *
 *  - adega:     cerveja, cigarro e bebidas em geral (inclui doses e drinks)
 *  - outros:    mercearia e afins (petisco, doce, gelo, tabacaria...)
 *  - espetinho: so os espetinhos
 *
 * Cada produto guarda a sua via no cadastro (coluna `produtos.via`). Esta
 * classificacao por nome so e usada como SUGESTAO: na migracao dos produtos
 * que ja existiam e no cadastro de produto novo quando a via nao vem
 * informada. O dono pode trocar a via de qualquer produto no cadastro.
 */
export const VIAS = ['adega', 'outros', 'espetinho'] as const
export type ViaProduto = (typeof VIAS)[number]

export const ROTULO_VIA: Readonly<Record<ViaProduto, string>> = {
  adega: 'Adega',
  outros: 'Outros',
  espetinho: 'Espetinho',
}

export function ehViaProduto(valor: unknown): valor is ViaProduto {
  return typeof valor === 'string' && (VIAS as readonly string[]).includes(valor)
}

const ESPETINHO = /\b(ESPETINHO|ESPETO)\b/
/** "ESPETO FINI" e bala em espeto, nao churrasco. */
const NAO_E_ESPETINHO = /\bFINI\b/

const CIGARRO =
  /\b(CIGARR\w*|MARLBORO|ROTHMANS|DUNHILL|WINSTON|CAMEL|LUCKY STRIKE|CHESTERFIELD|NEW YORK|PANDHORA|EIGHT|GIFT|DJARUM|EGIPT|LM|JC|PAIEIRO|PALHEIRO|GUDAN|CHANCELER|CAVALO DE PALHA|FUMO|AMSTERDAN|ACRENA)\b/

/** Mesmas familias da loja online (apps/api/src/routes/loja.ts) -- tudo o
 * que e bebida, pronta ou servida. */
const BEBIDA = [
  /\b(DOSE|ICE|COP[AÃ]O|COMBO|DRINK|NUSAKINHO|MANS[AÃ]O|MASCATE|XEQUE|BEATS|CABAR[EÉ]|ROSKOFF|CAIPIRINHA|MIXED|COROTE)\b/,
  /\b(RED BULL|MONSTER|BALY|ENERG[EÉ]TICO|ENERG|TNT|BALLENA|HITS POWER|CABRON)\b/,
  /\b(CERVEJA|HEINEKEN|BRAHMA|SKOL|BUDWEISER|CORONA|STELLA|AMSTEL|ITAIPAVA|ORIGINAL|SPATEN|MICHELOB|EISENBAHN?|IMPERIO|PRAYA|THEREZ|COLORADO|BADEN|IPA|PETRA|LOKAL|PILSEN|CARACU|MALZBIER|BLACK PRINCESS|ESTRELLA|ECOBIER|CHOPP?)\b/,
  /\b(VINHO|ESPUMANTE|LAMBRUSCO|RESERVADO|CASILLERO|TONATTO|PASKUA|P[EÉ]RGOLA|SAKE|MARTINI)\b/,
  /\b(VODKA|WHISK\w*|GIN|GIM|CACHA\w*|PINGA|51|VELHO BARREIRO|SMIRNOFF|ABSOLUT|JACK|RED LABEL|WHITE HORSE|JOHNNIE|CHIVAS|BUCHANAN\w*|PASSAPORTE?|BALLANTINE\w*|JIM BEAM|LICOR|CONHAQUE|DREHER|ASKOV|SKY|MASTER GOLD|CAMPARI|TANQUERAY|ETERNITY|OPERA|INVICTUS|ROCK'S|CANELINHA|JURUPINGA|CONTINI|GABRIELA|BELL'S|GRANT'S|APERITIVO|CANARINHO|PARATUDO|CUNHA|DI MINAS|TEQUILA|RUM)\b/,
  /\b(COCA|FANTA|SPRITE|GUARAN\w*|PEPSI|SUCO|DEL VALL?E|TODDYNHO|AGUA|ÁGUA|H2O|T[OÔ]NICA|SCHWEPPES|GATORADE|POWER ADE|POWERADE|TROPICAL|FYS|JOANINHA|REFRIGERANTE|REFRI|CA[CÇ]ULINHA|KUAT|SUKITA|SODA|CITRUS)\b/,
]

/** Sugestao de via pelo nome do produto (ver comentario do modulo). */
export function classificarVia(descricao: string): ViaProduto {
  const d = descricao.toUpperCase()
  if (ESPETINHO.test(d) && !NAO_E_ESPETINHO.test(d)) return 'espetinho'
  if (CIGARRO.test(d)) return 'adega'
  if (BEBIDA.some((rx) => rx.test(d))) return 'adega'
  return 'outros'
}

/**
 * Divide `valor` em partes inteiras proporcionais a `pesos`, somando
 * EXATAMENTE `valor` (sobra de arredondamento vai pras maiores fracoes).
 * Pesos todos zero: tudo na primeira posicao.
 */
export function ratear(valor: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return []
  const somaPesos = pesos.reduce((s, p) => s + p, 0)
  if (somaPesos <= 0) return pesos.map((_, i) => (i === 0 ? valor : 0))
  const brutos = pesos.map((p) => (valor * p) / somaPesos)
  const partes = brutos.map((b) => Math.floor(b))
  let sobra = valor - partes.reduce((s, p) => s + p, 0)
  const ordem = brutos
    .map((b, i) => ({ i, fracao: b - Math.floor(b) }))
    .sort((a, b) => b.fracao - a.fracao || a.i - b.i)
  for (let k = 0; sobra > 0; k = (k + 1) % ordem.length, sobra--) partes[ordem[k]!.i]! += 1
  return partes
}

export interface ItemParaVia {
  readonly via: ViaProduto
  readonly totalItem: Centavos
}

export interface PagamentoParaVia<P> {
  readonly pagamento: P
  /** Valor que de fato ficou na loja (pago menos troco). */
  readonly valorLiquido: Centavos
}

export interface ParteDaVenda<P> {
  readonly via: ViaProduto
  readonly total: Centavos
  readonly pagamentos: readonly { readonly pagamento: P; readonly valor: Centavos }[]
}

/**
 * Parte uma venda nas vias dos itens dela. O total da venda (que ja tem o
 * desconto aplicado) e cada pagamento sao rateados na proporcao do valor
 * dos itens de cada via -- ex.: R$ 50 no debito, sendo R$ 30 de cerveja e
 * R$ 20 de espetinho, vira R$ 30 de debito na Adega e R$ 20 na Espetinho.
 * A soma das partes e sempre igual a venda inteira (centavo por centavo).
 * Venda sem itens fica inteira na Adega.
 */
export function dividirVendaPorVia<P>(
  total: Centavos,
  itens: readonly ItemParaVia[],
  pagamentos: readonly PagamentoParaVia<P>[],
): ParteDaVenda<P>[] {
  const porVia = new Map<ViaProduto, number>()
  for (const item of itens) porVia.set(item.via, (porVia.get(item.via) ?? 0) + item.totalItem)
  const vias = VIAS.filter((v) => porVia.has(v))
  if (vias.length === 0) vias.push('adega')
  const pesos = vias.map((v) => porVia.get(v) ?? 0)
  const totais = ratear(total, pesos)
  const rateioPagamentos = pagamentos.map((p) => ratear(p.valorLiquido, pesos))
  return vias.map((via, i) => ({
    via,
    total: totais[i]! as Centavos,
    pagamentos: pagamentos
      .map((p, j) => ({ pagamento: p.pagamento, valor: rateioPagamentos[j]![i]! as Centavos }))
      .filter((p) => p.valor !== 0),
  }))
}
