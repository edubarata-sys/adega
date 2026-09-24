/**
 * Fotos de produto pelo codigo de barras, via Open Food Facts (base publica
 * e aberta; imagens sob CC-BY-SA -- por isso a tela mostra o credito).
 *
 * O "banco de imagens" fica no proprio navegador do PC da loja
 * (localStorage): so o endereco da foto de cada EAN, nunca a imagem em si.
 * Achou -> guarda pra sempre. Nao achou -> guarda a falta por 7 dias e tenta
 * de novo depois (a base publica cresce). Erro de rede nao e guardado.
 *
 * Nada aqui pode travar a venda: toda busca tem timeout curto, e qualquer
 * falha vira "sem foto" (a tela mostra o desenho da garrafa).
 */

const CHAVE_CACHE = 'adega-fotos-produto-v1'
const VALIDADE_FALTA_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 5000
/** ~85 consultas/min -- abaixo do limite da Open Food Facts (100/min). */
const INTERVALO_AQUECIMENTO_MS = 700

interface EntradaCache {
  readonly url: string | null
  readonly em: number
}

function lerCache(): Record<string, EntradaCache> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CACHE) ?? '{}') as Record<string, EntradaCache>
  } catch {
    return {}
  }
}

function gravarCache(ean: string, entrada: EntradaCache): void {
  try {
    const cache = lerCache()
    cache[ean] = entrada
    localStorage.setItem(CHAVE_CACHE, JSON.stringify(cache))
  } catch {
    // Sem localStorage (modo privado, cota cheia): segue sem cache.
  }
}

/** Codigo interno "777..." do sistema antigo nao existe em base nenhuma. */
export function eanPodeTerFoto(ean: string | null | undefined): ean is string {
  return Boolean(ean) && /^\d{8,14}$/.test(ean!) && !ean!.startsWith('777')
}

function cacheValido(entrada: EntradaCache | undefined): entrada is EntradaCache {
  if (!entrada) return false
  return entrada.url !== null || Date.now() - entrada.em < VALIDADE_FALTA_MS
}

async function consultarOpenFoodFacts(ean: string): Promise<string | null> {
  const controle = new AbortController()
  const timer = window.setTimeout(() => controle.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=image_front_url,image_url`,
      { signal: controle.signal },
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const corpo = (await res.json()) as {
      status?: number
      product?: { image_front_url?: string; image_url?: string }
    }
    if (corpo.status !== 1) return null
    return corpo.product?.image_front_url ?? corpo.product?.image_url ?? null
  } finally {
    window.clearTimeout(timer)
  }
}

const emAndamento = new Map<string, Promise<string | null>>()

/**
 * Endereco da foto do produto, ou null. Tenta o EAN como veio e, se for
 * UPC-A (12 digitos), tambem com o zero na frente (mesma ambiguidade da
 * busca por EAN no backend).
 */
export function buscarFotoProduto(ean: string | null | undefined): Promise<string | null> {
  if (!eanPodeTerFoto(ean)) return Promise.resolve(null)
  const emCache = lerCache()[ean]
  if (cacheValido(emCache)) return Promise.resolve(emCache.url)

  const existente = emAndamento.get(ean)
  if (existente) return existente

  const promessa = (async () => {
    try {
      const candidatos = ean.length === 12 ? [ean, `0${ean}`] : [ean]
      let url: string | null = null
      for (const candidato of candidatos) {
        url = await consultarOpenFoodFacts(candidato)
        if (url) break
      }
      gravarCache(ean, { url, em: Date.now() })
      return url
    } catch {
      return null // rede/timeout: nao guarda, tenta de novo numa proxima vez
    } finally {
      emAndamento.delete(ean)
    }
  })()
  emAndamento.set(ean, promessa)
  return promessa
}

/**
 * Monta o banco de fotos em segundo plano: passa pelos EANs que ainda nao
 * estao no cache, um de cada vez, com intervalo. Devolve uma funcao que
 * interrompe (chamada quando a tela de venda fecha).
 */
export function aquecerCacheDeFotos(eans: readonly string[]): () => void {
  let parado = false
  const pendentes = eans.filter((e) => eanPodeTerFoto(e) && !cacheValido(lerCache()[e]))
  void (async () => {
    for (const ean of pendentes) {
      if (parado) return
      await buscarFotoProduto(ean)
      await new Promise((ok) => window.setTimeout(ok, INTERVALO_AQUECIMENTO_MS))
    }
  })()
  return () => {
    parado = true
  }
}
