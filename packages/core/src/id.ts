/**
 * UUIDv7 -- identificador ordenavel por tempo.
 *
 * Por que v7 e nao v4: o `id` da venda nasce NO CLIENTE, offline, e sobe depois.
 * Sendo ordenavel por tempo, ele funciona como chave primaria sem fragmentar
 * indice e ainda carrega o instante de criacao, util em depuracao de sync.
 *
 * PostgreSQL 17 nao tem `uuidv7()` nativo (chegou no 18), entao a geracao e
 * responsabilidade da aplicacao -- o que e desejavel aqui de qualquer forma,
 * porque o cliente offline precisa gerar id sem falar com o banco.
 *
 * `uuidv7` e pura: recebe tempo e aleatoriedade. `uuidv7Agora` e o unico ponto
 * nao-deterministico de packages/core; nao importa nada, apenas le `Date.now()`
 * e o `crypto` global, disponiveis tanto em Node quanto no navegador.
 */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

export interface EntradaUuidV7 {
  /** Milissegundos desde a epoca Unix. */
  readonly agoraMs: number
  /** Exatamente 10 bytes de aleatoriedade (0-255). */
  readonly aleatorios: Uint8Array
}

export function uuidv7({ agoraMs, aleatorios }: EntradaUuidV7): string {
  if (!Number.isInteger(agoraMs) || agoraMs < 0) {
    throw new RangeError(`Timestamp invalido para uuidv7: ${agoraMs}`)
  }
  if (aleatorios.length !== 10) {
    throw new RangeError(`uuidv7 precisa de 10 bytes aleatorios, recebeu ${aleatorios.length}`)
  }

  const bytes = new Uint8Array(16)

  // 48 bits de timestamp em milissegundos, big-endian.
  let ts = agoraMs
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  for (let i = 0; i < 10; i++) {
    bytes[6 + i] = aleatorios[i] as number
  }

  // Versao 7 nos 4 bits altos do byte 6.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  // Variante RFC 4122 nos 2 bits altos do byte 8.
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const h = (i: number): string => HEX[bytes[i] as number] as string
  return (
    h(0) +
    h(1) +
    h(2) +
    h(3) +
    '-' +
    h(4) +
    h(5) +
    '-' +
    h(6) +
    h(7) +
    '-' +
    h(8) +
    h(9) +
    '-' +
    h(10) +
    h(11) +
    h(12) +
    h(13) +
    h(14) +
    h(15)
  )
}

export function uuidv7Agora(): string {
  const aleatorios = new Uint8Array(10)
  globalThis.crypto.getRandomValues(aleatorios)
  return uuidv7({ agoraMs: Date.now(), aleatorios })
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function ehUuidV7(valor: string): boolean {
  return RE_UUID.test(valor)
}
