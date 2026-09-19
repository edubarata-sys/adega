// @vitest-environment jsdom
//
// Necessario mesmo com `test.environment: 'jsdom'` em apps/web/vitest.config.ts:
// ao agregar todos os sub-projetos num so processo (`pnpm test` na raiz via
// `test.projects`), o ambiente por projeto nao e aplicado de forma confiavel
// nesta versao do Vitest -- sem esta anotacao por arquivo, `render()` falha
// com "document is not defined" so quando rodado a partir da raiz (isolado,
// dentro de apps/web, o teste passa sem ela).
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

/**
 * Fumaca do fluxo raiz: sem sessao (GET /auth/eu 401), o app deve cair na
 * tela de login por PIN e listar os operadores. Nao testa a API de verdade
 * (isso e coberto pelos testes de integracao de apps/api) -- so garante que
 * o "cabeamento" front-end (fetch -> estado -> tela renderizada) funciona,
 * o que faltava por completo em apps/web ate agora.
 */
describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/auth/eu')) {
          return new Response(JSON.stringify({ status: 'erro', motivo: 'Sem sessao.' }), {
            status: 401,
          })
        }
        if (url.endsWith('/api/auth/operadores')) {
          return new Response(JSON.stringify({ operadores: [{ id: 'op-1', nome: 'Maria' }] }), {
            status: 200,
          })
        }
        throw new Error(`fetch nao mockado para ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sem sessao ativa, mostra a tela de login e lista os operadores para PIN', async () => {
    render(<App />)

    expect(await screen.findByText('Sistema da Adega')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('Maria')).toBeTruthy()
    })
  })
})
