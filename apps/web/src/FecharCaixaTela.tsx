import { formatarBRL, centavos as paraCentavos } from '@adega/core'
import { useState } from 'react'
import { ErroRequisicao, fecharCaixa } from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly aoFechar: () => void
}

interface ResultadoFechamento {
  readonly esperado: number
  readonly contado: number
  readonly diferenca: number
}

/**
 * Fechamento CEGO (PASSO 10 -- decisao ja implementada em packages/core e
 * na rota, aqui e so a tela): o operador digita `valorContado` ANTES de
 * ver `esperado`. Se a UI mostrasse o esperado antes, a conferencia
 * viraria teatro -- por isso `resultado` (que contem `esperado`) so existe
 * DEPOIS que o POST /caixa/fechar responde, nunca antes.
 */
export function FecharCaixaTela({ aoFechar }: Props) {
  const [valorContadoTexto, setValorContadoTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoFechamento | null>(null)

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setErro(null)
    const centavos = Math.round(Number(valorContadoTexto.replace(',', '.')) * 100)
    if (!Number.isFinite(centavos) || centavos < 0) {
      setErro('Valor contado invalido.')
      return
    }
    setEnviando(true)
    try {
      const { fechamento } = await fecharCaixa(centavos)
      setResultado(fechamento)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao fechar o caixa.')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    const diferencaLabel =
      resultado.diferenca === 0 ? 'sem diferenca' : resultado.diferenca > 0 ? 'sobra' : 'falta'
    const corDiferenca = resultado.diferenca === 0 ? 'var(--green)' : 'var(--red)'
    return (
      <div className="app">
        <TopoApp titulo="Fechar caixa" />
        <main className="app-shell" style={{ maxWidth: 420 }}>
          <div className="app-card">
            <div className="app-resultado-icone ok">✓</div>
            <h2 style={{ margin: '0 0 14px' }}>Caixa fechado</h2>
            <p>Esperado: {formatarBRL(paraCentavos(resultado.esperado))}</p>
            <p>Contado: {formatarBRL(paraCentavos(resultado.contado))}</p>
            <p>
              Diferenca:{' '}
              <strong style={{ color: corDiferenca }}>
                {formatarBRL(paraCentavos(Math.abs(resultado.diferenca)))} ({diferencaLabel})
              </strong>
            </p>
            <button type="button" onClick={aoFechar} className="app-btn app-btn-grande">
              Abrir novo caixa
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <TopoApp titulo="Fechar caixa" />
      <main className="app-shell" style={{ maxWidth: 420 }}>
        <div className="app-card">
          <p className="app-aviso" style={{ marginTop: 0 }}>
            Conte o dinheiro da gaveta e digite o valor ANTES de confirmar -- o sistema so mostra o
            valor esperado depois que voce confirmar o que contou.
          </p>
          <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 14 }}>
            <label>
              <span className="app-label">Valor contado (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                required
                value={valorContadoTexto}
                onChange={(e) => setValorContadoTexto(e.target.value)}
                className="app-input app-input-lg"
              />
            </label>
            <button type="submit" disabled={enviando} className="app-btn app-btn-grande">
              {enviando ? 'Fechando...' : 'Confirmar e fechar caixa'}
            </button>
            {erro && <p className="app-msg-erro">{erro}</p>}
          </form>
        </div>
      </main>
    </div>
  )
}
