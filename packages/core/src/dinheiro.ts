/**
 * Dinheiro e SEMPRE inteiro em centavos. Nunca float.
 *
 * O tipo e "branded" para que um numero solto nao seja aceito por engano
 * onde se espera dinheiro: o compilador obriga a passar por `centavos()`,
 * que valida a faixa segura.
 *
 * No banco a coluna e bigint. Em TypeScript usamos `number` porque
 * Number.MAX_SAFE_INTEGER equivale a ~R$ 90 trilhoes em centavos,
 * varias ordens de grandeza acima de qualquer valor possivel aqui.
 * A guarda abaixo torna essa premissa verificavel em vez de implicita.
 */
declare const marcaCentavos: unique symbol

export type Centavos = number & { readonly [marcaCentavos]: true }

export const ZERO = 0 as Centavos
export const MAX_CENTAVOS = Number.MAX_SAFE_INTEGER

export function centavos(valor: number): Centavos {
  if (!Number.isInteger(valor)) {
    throw new TypeError(`Dinheiro precisa ser inteiro em centavos, recebido: ${valor}`)
  }
  if (!Number.isSafeInteger(valor)) {
    throw new RangeError(`Valor fora da faixa segura de centavos: ${valor}`)
  }
  return valor as Centavos
}

export function somar(...valores: readonly Centavos[]): Centavos {
  let total = 0
  for (const v of valores) total += v
  return centavos(total)
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b)
}

/**
 * Multiplica dinheiro por uma quantidade possivelmente fracionaria (granel, KG).
 *
 * A quantidade e convertida para milesimos inteiros antes da multiplicacao para
 * evitar deriva de ponto flutuante (0.1 + 0.2 !== 0.3). O arredondamento final e
 * MEIO PARA CIMA, aplicado uma unica vez, no total do item.
 */
export const CASAS_QUANTIDADE = 3
const ESCALA_QUANTIDADE = 10 ** CASAS_QUANTIDADE

export function multiplicarPorQuantidade(preco: Centavos, quantidade: number): Centavos {
  if (!Number.isFinite(quantidade)) {
    throw new TypeError(`Quantidade invalida: ${quantidade}`)
  }
  const milesimos = Math.round(quantidade * ESCALA_QUANTIDADE)
  const bruto = (preco * milesimos) / ESCALA_QUANTIDADE
  return centavos(arredondarMeioParaCima(bruto))
}

/** Math.round arredonda -0.5 para 0; aqui o criterio e sempre "meio para cima" no valor absoluto. */
export function arredondarMeioParaCima(valor: number): number {
  const sinal = valor < 0 ? -1 : 1
  return sinal * Math.round(Math.abs(valor))
}

/** Apresentacao. Pura, sem dependencia de ambiente. */
export function formatarBRL(valor: Centavos): string {
  const negativo = valor < 0
  const absoluto = Math.abs(valor)
  const inteiros = Math.trunc(absoluto / 100)
  const restante = absoluto % 100
  const milhar = inteiros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '-' : ''}R$ ${milhar},${restante.toString().padStart(2, '0')}`
}
