import { buscarEanNoCatalogo, buscarNomeNoCatalogo } from '@adega/core'
import {
  buscarCatalogoPdv,
  buscarProdutoPorEan,
  buscarProdutosPorDescricao,
  ErroRequisicao,
  semConexao,
  type ProdutoApi,
} from '../api'
import { armazem } from './armazem'
import { avisarMudanca } from './status'

/**
 * Catalogo do balcao guardado no computador (arquitetura §2). Online, o PDV
 * continua perguntando ao servidor (preco sempre atual); sem internet, a
 * pistola e a busca por nome usam a copia local, atualizada a cada 10 min.
 */

const CHAVE = 'catalogo'
const INTERVALO_MS = 10 * 60 * 1000

export interface CatalogoGuardado {
  readonly produtos: readonly ProdutoApi[]
  readonly atualizadoEm: string
}

export async function catalogoLocal(): Promise<CatalogoGuardado | undefined> {
  return armazem().ler<CatalogoGuardado>(CHAVE)
}

export async function atualizarCatalogo(): Promise<boolean> {
  try {
    const { produtos } = await buscarCatalogoPdv()
    await armazem().gravar<CatalogoGuardado>(CHAVE, {
      produtos,
      atualizadoEm: new Date().toISOString(),
    })
    avisarMudanca()
    return true
  } catch {
    // Sem internet ou sessao expirada: fica a copia anterior.
    return false
  }
}

let iniciado = false

export function iniciarAtualizacaoDoCatalogo(): void {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  void atualizarCatalogo()
  setInterval(() => void atualizarCatalogo(), INTERVALO_MS)
  window.addEventListener('online', () => void atualizarCatalogo())
}

async function produtosLocais(): Promise<readonly ProdutoApi[]> {
  const guardado = await catalogoLocal()
  if (!guardado) {
    throw new ErroRequisicao(
      'Sem internet e o catalogo ainda nao foi guardado neste computador.',
      'SEM_CATALOGO',
      0,
    )
  }
  return guardado.produtos
}

/** Mesma resposta de GET /produtos/ean/:ean, vinda do servidor ou da copia local. */
export async function buscarEanComOffline(
  ean: string,
): Promise<{ produto: ProdutoApi; produtos?: ProdutoApi[]; offline?: boolean }> {
  try {
    return await buscarProdutoPorEan(ean)
  } catch (e) {
    if (!semConexao(e)) throw e
    const achados = buscarEanNoCatalogo(await produtosLocais(), ean) as ProdutoApi[]
    if (achados.length === 0) {
      throw new ErroRequisicao('Produto nao encontrado para este EAN.', undefined, 404)
    }
    return { produto: achados[0]!, produtos: achados, offline: true }
  }
}

export async function buscarNomeComOffline(
  termo: string,
): Promise<{ produtos: ProdutoApi[]; offline?: boolean }> {
  try {
    return await buscarProdutosPorDescricao(termo)
  } catch (e) {
    if (!semConexao(e)) throw e
    return {
      produtos: buscarNomeNoCatalogo(await produtosLocais(), termo) as ProdutoApi[],
      offline: true,
    }
  }
}
