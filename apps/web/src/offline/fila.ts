import { useEffect, useState } from 'react'
import {
  ErroRequisicao,
  registrarVenda,
  semConexao,
  type ItemVendaApi,
  type PagamentoVendaApi,
} from '../api'
import { armazem } from './armazem'
import { avisarMudanca, useMudancasOffline } from './status'

/**
 * Fila de vendas do balcao (arquitetura §2): toda venda grava AQUI primeiro
 * e depois sobe. Sem internet ela espera; volta a internet, sobe sozinha. O
 * id e gerado no PDV, entao reenviar nunca duplica (POST /vendas idempotente).
 *
 * Venda que o servidor RECUSA (4xx: caixa fechado, dado invalido) nao some
 * em silencio: fica marcada com o erro e aparece pro operador/admin.
 */

const CHAVE = 'fila-vendas'
const INTERVALO_MS = 20 * 1000

export interface VendaNaFila {
  readonly id: string
  readonly itens: readonly ItemVendaApi[]
  readonly pagamentos: readonly PagamentoVendaApi[]
  readonly ocorridoEm: string
  readonly total: number
  readonly erro?: string
}

async function ler(): Promise<VendaNaFila[]> {
  return (await armazem().ler<VendaNaFila[]>(CHAVE)) ?? []
}

async function gravar(fila: VendaNaFila[]): Promise<void> {
  await armazem().gravar(CHAVE, fila)
  avisarMudanca()
}

// Serializa as escritas: duas abas/timers mexendo na fila ao mesmo tempo
// nao podem perder venda.
let corrente: Promise<unknown> = Promise.resolve()
function emSerie<T>(f: () => Promise<T>): Promise<T> {
  const p = corrente.then(f, f)
  corrente = p.catch(() => undefined)
  return p
}

export function listarFila(): Promise<VendaNaFila[]> {
  return ler()
}

export function guardarNaFila(venda: VendaNaFila): Promise<void> {
  return emSerie(async () => {
    const fila = await ler()
    if (!fila.some((v) => v.id === venda.id)) fila.push(venda)
    await gravar(fila)
  })
}

function tirarDaFila(id: string): Promise<void> {
  return emSerie(async () => gravar((await ler()).filter((v) => v.id !== id)))
}

function marcarErro(id: string, erro: string): Promise<void> {
  return emSerie(async () => gravar((await ler()).map((v) => (v.id === id ? { ...v, erro } : v))))
}

/** Admin descarta uma venda recusada (depois de lancar certo a mao). */
export function descartarDaFila(id: string): Promise<void> {
  return tirarDaFila(id)
}

export type ResultadoEnvio =
  | { readonly status: 'enviada'; readonly resposta: Awaited<ReturnType<typeof registrarVenda>> }
  | { readonly status: 'sem-conexao' }
  | { readonly status: 'recusada'; readonly motivo: string }

/** Tenta subir UMA venda da fila. */
export async function enviarVenda(venda: VendaNaFila): Promise<ResultadoEnvio> {
  try {
    const resposta = await registrarVenda(venda.id, venda.itens, venda.pagamentos, venda.ocorridoEm)
    await tirarDaFila(venda.id)
    return { status: 'enviada', resposta }
  } catch (e) {
    if (semConexao(e)) return { status: 'sem-conexao' }
    // Sessao expirada: nao e erro da venda, espera o login.
    if (e instanceof ErroRequisicao && e.status === 401) return { status: 'sem-conexao' }
    const motivo = e instanceof Error ? e.message : 'Erro desconhecido.'
    await marcarErro(venda.id, motivo)
    return { status: 'recusada', motivo }
  }
}

let sincronizando = false

/** Sobe a fila em ordem; para no primeiro sinal de falta de internet. */
export async function sincronizarFila(): Promise<number> {
  if (sincronizando) return 0
  sincronizando = true
  let enviadas = 0
  try {
    for (const venda of await ler()) {
      if (venda.erro) continue
      const r = await enviarVenda(venda)
      if (r.status === 'sem-conexao') break
      if (r.status === 'enviada') enviadas++
    }
  } finally {
    sincronizando = false
  }
  return enviadas
}

let iniciado = false

export function iniciarSincronizacaoDaFila(): void {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  void sincronizarFila()
  setInterval(() => void sincronizarFila(), INTERVALO_MS)
  window.addEventListener('online', () => void sincronizarFila())
}

export interface EstadoFila {
  readonly pendentes: number
  readonly comErro: number
  readonly online: boolean
}

/** Contagem pra mostrar no topo do PDV e travar o fechamento de caixa. */
export function useEstadoFila(): EstadoFila {
  const versao = useMudancasOffline()
  const [estado, setEstado] = useState<EstadoFila>({
    pendentes: 0,
    comErro: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  })
  useEffect(() => {
    let cancelado = false
    void ler().then((fila) => {
      if (cancelado) return
      setEstado({
        pendentes: fila.filter((v) => !v.erro).length,
        comErro: fila.filter((v) => v.erro).length,
        online: navigator.onLine,
      })
    })
    return () => {
      cancelado = true
    }
  }, [versao])
  return estado
}
