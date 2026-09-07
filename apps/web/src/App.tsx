import { useEffect, useState } from 'react'

type EstadoSaude = { carregando: boolean; ok: boolean; detalhe: string }

/**
 * Tela minima do scaffold: confirma visualmente que web -> api -> banco
 * estao de pe. Sera substituida pelas telas reais da Fase 1 (produtos,
 * PDV, caixa). Nao e o PDV -- so a prova de que a esteira funciona.
 */
export function App() {
  const [saude, setSaude] = useState<EstadoSaude>({ carregando: true, ok: false, detalhe: '' })

  useEffect(() => {
    let cancelado = false

    async function verificar() {
      try {
        const res = await fetch('/api/health/ready')
        const corpo = (await res.json()) as { status: string; motivo?: string }
        if (cancelado) return
        setSaude({
          carregando: false,
          ok: res.ok,
          detalhe: res.ok ? 'API e banco respondendo' : (corpo.motivo ?? 'indisponivel'),
        })
      } catch {
        if (!cancelado) setSaude({ carregando: false, ok: false, detalhe: 'API inalcancavel' })
      }
    }

    void verificar()
    return () => {
      cancelado = true
    }
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>Sistema da Adega</h1>
      <p>
        Status:{' '}
        {saude.carregando ? (
          'verificando...'
        ) : (
          <strong style={{ color: saude.ok ? '#16a34a' : '#dc2626' }}>
            {saude.ok ? 'operacional' : `indisponivel (${saude.detalhe})`}
          </strong>
        )}
      </p>
    </main>
  )
}
