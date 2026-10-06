// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConteudoFinanceiro } from './FinanceiroTela'

const resumo = {
  mes: '2026-10',
  hoje: '2026-10-06',
  totais: {
    entradaAdega: 116200,
    entradaOutros: 0,
    saidaAdega: 30000,
    saidaCasa: 8000,
    entradas: 116200,
    saidas: 38000,
    saldo: 78200,
  },
  lancamentos: [
    {
      id: 'l1',
      tipo: 'entrada',
      grupo: 'adega',
      valor: 116200,
      descricao: 'Caixa da adega 05/10',
      data: '2026-10-05',
      origem: 'caixa',
    },
  ],
  contasPendentes: [
    {
      contaId: 'c1',
      tipo: 'fixo',
      grupo: 'casa',
      descricao: 'Aluguel',
      valor: 120000,
      vencimento: '2026-10-10',
      competencia: '2026-10',
      situacao: 'a-vencer',
    },
  ],
  contas: [],
}

describe('ConteudoFinanceiro', () => {
  let chamadas: Array<{ url: string; corpo?: unknown }>

  beforeEach(() => {
    chamadas = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined })
        if (url.includes('/api/financeiro/resumo')) {
          return new Response(JSON.stringify(resumo), { status: 200 })
        }
        if (url.endsWith('/api/financeiro/lancamentos')) {
          return new Response(JSON.stringify({ lancamento: { id: 'novo' } }), { status: 201 })
        }
        throw new Error(`fetch nao mockado para ${url}`)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('mostra saldo e conta a pagar', async () => {
    render(<ConteudoFinanceiro />)
    expect(await screen.findByText('R$ 782,00')).toBeTruthy()
    expect(screen.getByText('Aluguel')).toBeTruthy()
  })

  it('lanca gasto de casa', async () => {
    render(<ConteudoFinanceiro />)
    await screen.findByText('R$ 782,00')
    fireEvent.click(screen.getByRole('button', { name: 'Lancar' }))
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '80' } })
    fireEvent.change(screen.getByPlaceholderText('Ex.: mercado'), {
      target: { value: 'Mercado' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(chamadas.some((c) => c.url.endsWith('/api/financeiro/lancamentos'))).toBe(true),
    )
    const post = chamadas.find((c) => c.url.endsWith('/api/financeiro/lancamentos'))
    expect(post?.corpo).toMatchObject({ tipo: 'saida', grupo: 'casa', valor: 8000 })
  })
})
