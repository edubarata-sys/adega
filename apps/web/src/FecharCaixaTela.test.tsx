// @vitest-environment jsdom
//
// Ver App.test.tsx: necessario mesmo com `environment: 'jsdom'` no
// vitest.config.ts de apps/web, porque `pnpm test` na raiz agrega todos os
// sub-projetos num so processo e o ambiente por projeto nao e aplicado de
// forma confiavel nesta versao do Vitest.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FecharCaixaTela } from './FecharCaixaTela'

/**
 * PASSO 10: a UI de fechamento nao pode revelar `esperado` antes do
 * operador confirmar `valorContado` (fechamento cego, packages/core/caixa.ts).
 * Este teste garante que a tela: (1) nao mostra nenhum valor esperado antes
 * do envio, e (2) so mostra o resultado (esperado/contado/diferenca) DEPOIS
 * que o POST /caixa/fechar responde.
 */
describe('FecharCaixaTela', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/caixa/fechar')) {
          return new Response(
            JSON.stringify({
              sessao: { id: 's1' },
              fechamento: { esperado: 1000, contado: 900, diferenca: -100 },
            }),
            { status: 200 },
          )
        }
        throw new Error(`fetch nao mockado para ${url}`)
      }),
    )
  })

  afterEach(() => {
    // Sem `test.globals: true`, o auto-cleanup do @testing-library/react
    // nao se registra sozinho -- sem isto, cada `render()` deste describe
    // deixaria o DOM da renderizacao anterior no ar, e consultas por texto
    // (ex: "Confirmar e fechar caixa") passam a bater em mais de um
    // elemento.
    cleanup()
    vi.unstubAllGlobals()
  })

  it('nao mostra o valor esperado antes do operador confirmar o valor contado', () => {
    render(<FecharCaixaTela aoFechar={() => {}} />)
    expect(screen.queryByText(/Esperado/)).toBeNull()
  })

  it('so revela esperado/contado/diferenca depois de enviar o valor contado', async () => {
    render(<FecharCaixaTela aoFechar={() => {}} />)

    const campo = screen.getByLabelText(/Valor contado/)
    fireEvent.change(campo, { target: { value: '9,00' } })
    fireEvent.click(screen.getByText('Confirmar e fechar caixa'))

    await waitFor(() => {
      expect(screen.getByText('Caixa fechado')).toBeTruthy()
    })
    expect(screen.getByText(/Esperado/).textContent).toContain('R$ 10,00')
    expect(screen.getByText(/Contado/).textContent).toContain('R$ 9,00')
    expect(screen.getByText(/falta/).textContent).toContain('R$ 1,00')
  })

  it('chama aoFechar ao clicar em "Abrir novo caixa" apos o fechamento', async () => {
    const aoFechar = vi.fn()
    render(<FecharCaixaTela aoFechar={aoFechar} />)

    fireEvent.change(screen.getByLabelText(/Valor contado/), { target: { value: '9,00' } })
    fireEvent.click(screen.getByText('Confirmar e fechar caixa'))

    await waitFor(() => screen.getByText('Abrir novo caixa'))
    fireEvent.click(screen.getByText('Abrir novo caixa'))
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })
})
