import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Hash de senha/PIN via scrypt (node:crypto nativo, sem dependencia externa
 * nem binario compilado).
 *
 * arquitetura.md menciona argon2id como escolha de referencia para
 * `senha_hash`/`pin_hash`. Optou-se por scrypt nesta missao por ser
 * memory-hard (mesma familia de garantia do argon2 contra ataque por GPU/ASIC),
 * builtin do Node (zero addon nativo pra compilar -- relevante numa maquina
 * Windows de 4GB de RAM que ja teve problema com Docker Desktop) e
 * recomendado pelo proprio OWASP como alternativa quando argon2 nao esta
 * disponivel. Nao e uma decisao de arquitetura travada: o formato do hash
 * abaixo (`scrypt:N:r:p:salt:hash`) e auto-descritivo, entao trocar para
 * argon2id depois e so trocar a implementacao de `hashSenha`/`verificarSenha`
 * -- nenhuma migration, a coluna e so `text()`.
 *
 * `scryptSync` (em vez da variante assíncrona) evita ambiguidade de overload
 * do `util.promisify` com a forma de 4 argumentos (com `options`) e é
 * aceitável aqui: login/PIN é uma operação pontual e de baixa frequência
 * (terminal único, Fase 1), não um caminho quente do sistema.
 */
const PARAMS = { N: 16384, r: 8, p: 1, tamanhoChave: 64 } as const

export async function hashSenha(senhaOuPin: string): Promise<string> {
  if (senhaOuPin.length === 0) {
    throw new RangeError('Senha/PIN vazio nao pode ser hasheado.')
  }
  const salt = randomBytes(16)
  const derivado = scryptSync(senhaOuPin, salt, PARAMS.tamanhoChave, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
  })
  return `scrypt:${PARAMS.N}:${PARAMS.r}:${PARAMS.p}:${salt.toString('hex')}:${derivado.toString('hex')}`
}

export async function verificarSenha(hash: string, tentativa: string): Promise<boolean> {
  const partes = hash.split(':')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false

  const [, nTexto, rTexto, pTexto, saltHex, hashHex] = partes
  const N = Number(nTexto)
  const r = Number(rTexto)
  const p = Number(pTexto)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  const salt = Buffer.from(saltHex as string, 'hex')
  const esperado = Buffer.from(hashHex as string, 'hex')
  const derivado = scryptSync(tentativa, salt, esperado.length, { N, r, p })

  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado)
}
