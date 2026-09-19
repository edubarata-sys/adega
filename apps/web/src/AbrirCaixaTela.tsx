import { useState } from 'react'
import { abrirCaixa, ErroRequisicao, type SessaoCaixaApi, type UsuarioSessao } from './api'

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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 420 }}>
      <h1>Abrir caixa</h1>
      <p>
        Operador: <strong>{usuario.nome}</strong>
      </p>
      <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 8 }}>
        <label>
          Fundo de troco (R$)
          <input
            type="text"
            inputMode="decimal"
            value={fundoTrocoTexto}
            onChange={(e) => setFundoTrocoTexto(e.target.value)}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <button type="submit" disabled={enviando}>
          {enviando ? 'Abrindo...' : 'Abrir caixa'}
        </button>
        {erro && <p style={{ color: '#dc2626' }}>{erro}</p>}
      </form>
    </main>
  )
}
