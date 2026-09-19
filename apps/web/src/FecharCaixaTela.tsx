import { formatarBRL, centavos as paraCentavos } from '@adega/core'
import { useState } from 'react'
import { ErroRequisicao, fecharCaixa } from './api'

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
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 420 }}>
        <h1>Caixa fechado</h1>
        <p>Esperado: {formatarBRL(paraCentavos(resultado.esperado))}</p>
        <p>Contado: {formatarBRL(paraCentavos(resultado.contado))}</p>
        <p>
          Diferenca:{' '}
          <strong style={{ color: resultado.diferenca === 0 ? '#16a34a' : '#dc2626' }}>
            {formatarBRL(paraCentavos(Math.abs(resultado.diferenca)))} ({diferencaLabel})
          </strong>
        </p>
        <button type="button" onClick={aoFechar}>
          Abrir novo caixa
        </button>
      </main>
    )
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 420 }}>
      <h1>Fechar caixa</h1>
      <p>
        Conte o dinheiro da gaveta e digite o valor ANTES de confirmar -- o sistema so mostra o
        valor esperado depois que voce confirmar o que contou.
      </p>
      <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 8 }}>
        <label>
          Valor contado (R$)
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            required
            value={valorContadoTexto}
            onChange={(e) => setValorContadoTexto(e.target.value)}
            style={{ display: 'block', width: '100%', fontSize: '1.1rem' }}
          />
        </label>
        <button type="submit" disabled={enviando}>
          {enviando ? 'Fechando...' : 'Confirmar e fechar caixa'}
        </button>
        {erro && <p style={{ color: '#dc2626' }}>{erro}</p>}
      </form>
    </main>
  )
}
