/**
 * Horario da LOJA (Taubate-SP), nao do servidor. O Railway roda em UTC, e o
 * `new Date().toISOString()` que o sistema usava pra "hoje"/"horario" esta 3h
 * a frente de Brasilia -- depois das 21h o sistema ja achava que era o dia
 * seguinte (relatorio da contadora jogava as vendas da noite pro outro dia,
 * recibo imprimia 01:40 numa venda das 22:40).
 *
 * O Brasil nao tem horario de verao desde 2019, entao o deslocamento e fixo
 * em -03:00. Se algum dia voltar, e so trocar a conversao de intervalo
 * abaixo por uma que consulte o fuso (as formatacoes ja usam o fuso IANA).
 */

export const FUSO_LOJA = 'America/Sao_Paulo'
const DESLOCAMENTO_LOJA = '-03:00'
const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Data (AAAA-MM-DD) no calendario da loja. */
export function dataLojaIso(instante: Date = new Date()): string {
  // en-CA formata exatamente como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_LOJA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
}

/** "2026-09-24T22:40:05-03:00": instante ISO 8601 no horario da loja (com o
 * deslocamento explicito -- quem le sabe que e Brasilia, nao UTC). */
export function formatarIsoLoja(instante: Date): string {
  const local = new Date(instante.getTime() - 3 * 60 * 60 * 1000)
  return `${local.toISOString().slice(0, 19)}${DESLOCAMENTO_LOJA}`
}

/** "24/09/2026 22:40" no horario da loja. */
export function formatarDataHoraLoja(instante: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_LOJA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instante)
  const p = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === tipo)?.value ?? ''
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`
}

function validarDataIso(dataIso: string): void {
  if (!RE_DATA_ISO.test(dataIso)) throw new RangeError(`Data invalida: ${dataIso}`)
}

/** Primeiro instante do dia `dataIso` no horario da loja (00:00 em Brasilia). */
export function inicioDoDiaLoja(dataIso: string): Date {
  validarDataIso(dataIso)
  return new Date(`${dataIso}T00:00:00.000${DESLOCAMENTO_LOJA}`)
}

/** Ultimo instante do dia `dataIso` no horario da loja (23:59:59.999 em Brasilia). */
export function fimDoDiaLoja(dataIso: string): Date {
  validarDataIso(dataIso)
  return new Date(`${dataIso}T23:59:59.999${DESLOCAMENTO_LOJA}`)
}
