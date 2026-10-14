/**
 * Pedido falado no celular (14/10/2026, espaco do espetinho/chopp):
 * "3 espetinhos de frango e 2 chopps" vira linhas com quantidade e os
 * produtos do catalogo que batem com o nome. PURO -- nunca decide sozinho:
 * a tela mostra os candidatos e o operador confirma antes de vender.
 */

import { palavrasDeBusca, type ProdutoCatalogo } from './offline'

const NUMEROS: Readonly<Record<string, number>> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  meia: 6, // "meia duzia"
}

/** Palavras que nao ajudam a achar o produto. */
const IGNORADAS = new Set([
  'de',
  'do',
  'da',
  'dos',
  'das',
  'com',
  'o',
  'a',
  'os',
  'as',
  'pra',
  'para',
  'por',
  'favor',
  'me',
  've',
  'manda',
  'quero',
  'duzia',
  'unidade',
  'unidades',
])

/** Separadores entre itens: virgula, "e", "mais", "+". */
const SEPARADOR = /\s*(?:,|;|\+|\be\b|\bmais\b)\s*/

export interface LinhaPedido {
  /** Trecho falado que gerou a linha (pra mostrar na tela). */
  readonly trecho: string
  readonly quantidade: number
  /** Palavras usadas na busca. */
  readonly termo: string
  /** Produtos que batem, melhor primeiro (pode ser vazio). */
  readonly candidatos: readonly ProdutoCatalogo[]
}

/** "chopps" -> ["chopps","chopp"]; "espetinhos" -> [..., "espetinho"]; "paes" -> [..., "pae","pa"]. */
function formas(palavra: string): string[] {
  const f = new Set([palavra])
  if (palavra.length > 3 && palavra.endsWith('s')) f.add(palavra.slice(0, -1))
  if (palavra.length > 4 && palavra.endsWith('es')) f.add(palavra.slice(0, -2))
  if (palavra.length > 4 && palavra.endsWith('oes')) f.add(`${palavra.slice(0, -3)}ao`)
  return [...f]
}

function pontuar(produto: ProdutoCatalogo, termos: readonly string[]): number | null {
  const nome = palavrasDeBusca(produto.descricao)
  let pontos = 0
  for (const [i, termo] of termos.entries()) {
    const variantes = formas(termo)
    const pos = nome.findIndex((p) => variantes.some((v) => p.startsWith(v)))
    if (pos < 0) return null
    if (variantes.includes(nome[pos]!)) pontos += 2 // palavra inteira
    if (i === 0 && pos === 0) pontos += 3 // nome comeca pelo que foi dito
  }
  // Nome curto = mais especifico (ex.: "CHOPP BRAHMA 400 ML" antes de combos longos).
  return pontos * 100 - nome.length
}

export function buscarNoCatalogoPorFala(
  catalogo: readonly ProdutoCatalogo[],
  termos: readonly string[],
  limite = 8,
): ProdutoCatalogo[] {
  if (termos.length === 0) return []
  return catalogo
    .map((p) => ({ p, pontos: pontuar(p, termos) }))
    .filter((x): x is { p: ProdutoCatalogo; pontos: number } => x.pontos !== null)
    .sort((a, b) => b.pontos - a.pontos || a.p.descricao.localeCompare(b.p.descricao, 'pt-BR'))
    .slice(0, limite)
    .map((x) => x.p)
}

export function interpretarPedido(
  texto: string,
  catalogo: readonly ProdutoCatalogo[],
): LinhaPedido[] {
  const limpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.!?]/g, ' ')
    .trim()
  if (!limpo) return []
  const linhas: LinhaPedido[] = []
  for (const trecho of limpo.split(SEPARADOR)) {
    const palavras = trecho.split(/\s+/).filter(Boolean)
    if (palavras.length === 0) continue
    let quantidade: number | null = null
    const termos: string[] = []
    for (const palavra of palavras) {
      if (quantidade === null && /^\d+$/.test(palavra)) {
        quantidade = Number(palavra)
        continue
      }
      if (quantidade === null && palavra in NUMEROS) {
        quantidade = NUMEROS[palavra]!
        continue
      }
      // "2x" / "x2"
      const xis = /^(?:(\d+)x|x(\d+))$/.exec(palavra)
      if (quantidade === null && xis) {
        quantidade = Number(xis[1] ?? xis[2])
        continue
      }
      if (!IGNORADAS.has(palavra)) termos.push(palavra)
    }
    if (termos.length === 0) continue
    linhas.push({
      trecho: trecho.trim(),
      quantidade: quantidade && quantidade > 0 ? quantidade : 1,
      termo: termos.join(' '),
      candidatos: buscarNoCatalogoPorFala(catalogo, termos),
    })
  }
  return linhas
}
