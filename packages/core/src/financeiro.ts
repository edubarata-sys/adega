/**
 * Financeiro pessoal do dono: regras puras (sem banco).
 *
 * Voz: o dono fala SEMPRE "grupo, valor, descricao" -- "casa, 80, mercado",
 * "adega 300 reais gelo". A interpretacao so preenche o formulario; quem
 * grava e o dono depois de conferir (mesmo principio do estoque por voz).
 */

export const GRUPOS_GASTO = ['casa', 'adega'] as const
export type GrupoGasto = (typeof GRUPOS_GASTO)[number]

const SINONIMOS_GRUPO: Record<string, GrupoGasto> = {
  casa: 'casa',
  pessoal: 'casa',
  adega: 'adega',
  loja: 'adega',
}

const PALAVRAS_MOEDA = new Set(['r$', 'rs', 'reais', 'real', 'conto', 'contos', 'pila'])
const PALAVRAS_LIGACAO = new Set(['e', 'de', 'do', 'da', 'no', 'na', 'com', 'em'])

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** "80" -> 8000; "12,50" -> 1250; "1.234,56" -> 123456; "12.5" -> 1250; "1.200" -> 120000. */
export function interpretarValorEmCentavos(bruto: string): number | null {
  let texto = bruto.trim().replace(/^r\$/i, '')
  if (!/^\d[\d.,]*$/.test(texto)) return null
  if (texto.includes(',')) {
    texto = texto.replace(/\./g, '').replace(',', '.')
  } else if (/\.\d{3}(\.|$)/.test(texto)) {
    texto = texto.replace(/\./g, '')
  }
  const numero = Number(texto)
  if (!Number.isFinite(numero) || numero <= 0) return null
  return Math.round(numero * 100)
}

export interface ComandoFinanceiro {
  readonly grupo: GrupoGasto | null
  readonly valor: number | null
  readonly descricao: string
}

export function interpretarComandoFinanceiro(textoOriginal: string): ComandoFinanceiro {
  const palavras = semAcento(textoOriginal.toLowerCase())
    .replace(/[;:!?]/g, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/^[,.]+|[,.]+$/g, ''))
    .filter(Boolean)
  const originais = textoOriginal
    .replace(/[;:!?]/g, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/^[,.]+|[,.]+$/g, ''))
    .filter(Boolean)

  let grupo: GrupoGasto | null = null
  let valor: number | null = null
  const resto: string[] = []

  for (let i = 0; i < palavras.length; i++) {
    const p = palavras[i]!
    if (grupo === null && p in SINONIMOS_GRUPO) {
      grupo = SINONIMOS_GRUPO[p]!
      continue
    }
    if (valor === null) {
      const v = interpretarValorEmCentavos(p)
      if (v !== null) {
        valor = v
        // "80 reais e 50 centavos"
        let j = i + 1
        if (PALAVRAS_MOEDA.has(palavras[j] ?? '')) j++
        if (palavras[j] === 'e' && palavras[j + 2]?.startsWith('centavo')) {
          const c = Number(palavras[j + 1])
          if (Number.isInteger(c) && c >= 0 && c < 100) {
            valor += c
            j += 3
          }
        }
        i = j - 1
        continue
      }
    }
    if (PALAVRAS_MOEDA.has(p)) continue
    resto.push(originais[i] ?? p)
  }

  while (resto.length > 0 && PALAVRAS_LIGACAO.has(semAcento(resto[0]!.toLowerCase()))) resto.shift()
  const descricao = resto.join(' ').trim()
  return {
    grupo,
    valor,
    descricao: descricao ? descricao.charAt(0).toUpperCase() + descricao.slice(1) : '',
  }
}

/** "2026-10-06" -> "2026-10". */
export function competenciaDe(dataIso: string): string {
  return dataIso.slice(0, 7)
}

/** Vencimento de um gasto fixo no mes: dia 31 em fevereiro cai no ultimo dia. */
export function vencimentoFixoNoMes(diaVencimento: number, competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number) as [number, number]
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const dia = Math.min(Math.max(1, Math.trunc(diaVencimento)), ultimoDia)
  return `${competencia}-${String(dia).padStart(2, '0')}`
}

export type SituacaoConta = 'vencida' | 'vence-hoje' | 'a-vencer'

export function situacaoConta(vencimentoIso: string, hojeIso: string): SituacaoConta {
  if (vencimentoIso < hojeIso) return 'vencida'
  if (vencimentoIso === hojeIso) return 'vence-hoje'
  return 'a-vencer'
}
