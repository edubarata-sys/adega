import { useState } from 'react'
import { abrirCaixa, ErroRequisicao, type SessaoCaixaApi, type UsuarioSessao } from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly usuario: UsuarioSessao
  readonly aoAbrir: (sessao: SessaoCaixaApi) => void
}

/**
 * Portao de entrada do PDV: sem caixa aberto nao ha venda (arquitetura §2.1,
 * terminal unico). Fundo de troco digitado em reais e convertido para
 * centavos antes de enviar -- a API so aceita inteiro em centavos.
 */
export function AbrirCaixaTela({ usuario, aoAbrir }: Props) {
  const [fundoTrocoTexto, setFundoTrocoTexto] = useState('0,00')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setErro(null)
    const centavos = Math.round(Number(fundoTrocoTexto.replace(',', '.')) * 100)
    if (!Number.isFinite(centavos) || centavos < 0) {
      setErro('Fundo de troco invalido.')
      return
    }
    setEnviando(true)
    try {
      const { sessao } = await abrirCaixa(centavos)
      aoAbrir(sessao)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao abrir o caixa.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="app">
      <TopoApp titulo="Abrir caixa">
        <span>{usuario.nome}</span>
      </TopoApp>
      <main className="app-shell" style={{ maxWidth: 420 }}>
        <div className="app-card">
          <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
            Operador: <strong style={{ color: 'var(--text)' }}>{usuario.nome}</strong>
          </p>
          <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 14 }}>
            <label>
              <span className="app-label">Fundo de troco (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={fundoTrocoTexto}
                onChange={(e) => setFundoTrocoTexto(e.target.value)}
                className="app-input app-input-lg"
              />
            </label>
            <button type="submit" disabled={enviando} className="app-btn app-btn-grande">
              {enviando ? 'Abrindo...' : 'Abrir caixa'}
            </button>
            {erro && <p className="app-msg-erro">{erro}</p>}
          </form>
        </div>
      </main>
    </div>
  )
}
