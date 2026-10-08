/**
 * Guarda do PDV no proprio computador (IndexedDB): catalogo de produtos e
 * fila de vendas feitas sem internet (arquitetura §2). Chave-valor simples:
 * o volume e pequeno (~1 mil produtos, poucas dezenas de vendas na fila).
 *
 * Sem IndexedDB (teste em jsdom, navegador antigo) cai para memoria -- o PDV
 * continua funcionando online, so nao sobrevive a recarregar a pagina.
 */

const NOME_BANCO = 'adega-pdv'
const LOJA = 'kv'

export interface Armazem {
  ler<T>(chave: string): Promise<T | undefined>
  gravar<T>(chave: string, valor: T): Promise<void>
}

export function armazemEmMemoria(): Armazem {
  const mapa = new Map<string, unknown>()
  return {
    async ler<T>(chave: string) {
      return mapa.get(chave) as T | undefined
    },
    async gravar<T>(chave: string, valor: T) {
      mapa.set(chave, structuredClone(valor))
    },
  }
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rejeitar) => {
    const req = indexedDB.open(NOME_BANCO, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LOJA)) req.result.createObjectStore(LOJA)
    }
    req.onsuccess = () => resolver(req.result)
    req.onerror = () => rejeitar(req.error)
  })
}

function armazemIndexedDb(): Armazem {
  let banco: Promise<IDBDatabase> | null = null
  const conexao = () => (banco ??= abrir())
  return {
    async ler<T>(chave: string) {
      const db = await conexao()
      return new Promise<T | undefined>((resolver, rejeitar) => {
        const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave)
        req.onsuccess = () => resolver(req.result as T | undefined)
        req.onerror = () => rejeitar(req.error)
      })
    },
    async gravar<T>(chave: string, valor: T) {
      const db = await conexao()
      return new Promise<void>((resolver, rejeitar) => {
        const tx = db.transaction(LOJA, 'readwrite')
        tx.objectStore(LOJA).put(valor, chave)
        tx.oncomplete = () => resolver()
        tx.onerror = () => rejeitar(tx.error)
      })
    },
  }
}

let atual: Armazem | null = null

export function armazem(): Armazem {
  if (!atual) {
    atual = typeof indexedDB === 'undefined' ? armazemEmMemoria() : armazemIndexedDb()
  }
  return atual
}

/** Testes trocam pelo armazem em memoria. */
export function definirArmazem(a: Armazem | null): void {
  atual = a
}
