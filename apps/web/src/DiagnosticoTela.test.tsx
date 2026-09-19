// @vitest-environment jsdom
//
// Ver App.test.tsx: necessario mesmo com `environment: 'jsdom'` no
// vitest.config.ts de apps/web, porque `pnpm test` na raiz agrega todos os
// sub-projetos num so processo e o ambiente por projeto nao e aplicado de
// forma confiavel nesta versao do Vitest.
//
// O recibo de teste nao vem mais de fetch nenhum -- e gerado direto no
// componente com os geradores puros de @adega/core (ver DiagnosticoTela.tsx
// e packages/core/src/recibo-diagnostico.ts), entao os testes abaixo usam o
// CONTEUDO REAL gerado, sem mock de recibo. O unico fetch que sobra e o
// health-check do bridge (Teste B da impressora), disparado so por clique
// do usuario -- nao acontece sozinho ao montar a pagina.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticoTela } from './DiagnosticoTela'

describe('DiagnosticoTela', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('localhost:9100/health')) {
          return new Response(JSON.stringify({ status: 'ok', versao: '0.0.1-spike' }), {
            status: 200,
          })
        }
        throw new Error(`fetch nao mockado para ${url}`)
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renderiza as tres secoes de diagnostico', () => {
    render(<DiagnosticoTela />)
    expect(screen.getByRole('heading', { name: /Leitor de código de barras/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Impressora térmica/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Maquininha Itaú/ })).toBeTruthy()
    expect(screen.getByText(/Item de teste \(impressora\)/)).toBeTruthy()
  })

  it('registra uma leitura terminada por Enter, sem assumir isso de antemao', () => {
    render(<DiagnosticoTela />)
    const campo = screen.getByPlaceholderText('Aguardando leitura...')

    fireEvent.change(campo, { target: { value: '789' } })
    fireEvent.keyDown(campo, { key: '9' })
    fireEvent.keyDown(campo, { key: 'Enter' })

    expect(screen.getByText('789')).toBeTruthy()
    expect(screen.getByText('Enter')).toBeTruthy()
  })

  it('registra uma leitura terminada por Tab', () => {
    render(<DiagnosticoTela />)
    const campo = screen.getByPlaceholderText('Aguardando leitura...')

    fireEvent.change(campo, { target: { value: '123456' } })
    fireEvent.keyDown(campo, { key: '6' })
    fireEvent.keyDown(campo, { key: 'Tab' })

    expect(screen.getByText('123456')).toBeTruthy()
    expect(screen.getByText('Tab')).toBeTruthy()
  })

  it('mostra o recibo de teste com o aviso obrigatorio e a linha de caracteres', () => {
    render(<DiagnosticoTela />)
    expect(screen.getAllByText(/DEMONSTRAÇÃO — SEM VALOR FISCAL/).length).toBeGreaterThan(0)
    expect(screen.getByText(/áéíóú/)).toBeTruthy()
  })

  it('confirma a maquininha so depois que todos os passos do checklist forem marcados', () => {
    render(<DiagnosticoTela />)
    const caixas = screen.getAllByRole('checkbox')
    expect(screen.queryByText(/confirmada funcionando de forma autônoma/)).toBeNull()

    caixas.forEach((caixa) => fireEvent.click(caixa))

    // Depois de tudo marcado, a confirmacao aparece na secao 3 E dentro do
    // resumo final (secao 4) -- as duas juntas sao esperadas.
    expect(screen.getAllByText(/confirmada funcionando de forma autônoma/).length).toBeGreaterThan(
      0,
    )
  })

  it('monta um resumo final copiavel com o status das tres secoes', () => {
    render(<DiagnosticoTela />)
    expect(screen.getByRole('heading', { name: /Resumo final/ })).toBeTruthy()
    expect(screen.getByText(/RESUMO — Diagnóstico de Hardware/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copiar resumo/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Enviar por WhatsApp/ })).toBeTruthy()

    const linkEmail = screen.getByRole('link', { name: /Enviar por e-mail/ })
    expect(linkEmail.getAttribute('href')).toContain('mailto:eduardo@impsys.com.br')
  })
})
