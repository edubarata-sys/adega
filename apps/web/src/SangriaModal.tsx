import { centavos, formatarBRL } from '@adega/core'
import { useState } from 'react'
import { ErroRequisicao, registrarMovimentoCaixa, type TipoMovimentoCaixaApi } from './api'

interface Props {
  readonly aoFechar: () => void
}

const TIPOS: readonly {
  readonly tipo: TipoMovimentoCaixaApi
  readonly rotulo: string
  readonly ajuda: string
}[] = [
  {
    tipo: 'sangria',
    rotulo: 'Sangria (retirar)',
    ajuda: 'Tirou dinheiro da gaveta (ex.: levar pro cofre/banco).',
  },
  {
    tipo: 'suprimento',
    rotulo: 'Suprimento (colocar)',
    ajuda: 'Colocou dinheiro na gaveta (ex.: reforco de troco).',
  },
  {
    tipo: 'despesa',
    rotulo: 'Despesa',
    ajuda: 'Pagou algo com o dinheiro da gaveta (ex.: gelo, entrega).',
  },
]

function textoParaCentavos(t: string): number | null {
  const limpo = t.trim().replace(/\./g, '').replace(',', '.')
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

/**
 * Sangria / suprimento / despesa do caixa (pedido do cliente 25/09). O
 * backend (/caixa/movimentos) ja existia e o fechamento cego ja desconta
 * esses movimentos do valor esperado -- faltava a tela.
 */
export function SangriaModal({ aoFechar }: Props) {
  const [tipo, setTipo] = useState<TipoMovimentoCaixaApi>('sangria')
  const [valorTexto, setValorTexto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function confirmar() {
    setErro(null)
    setOk(null)
    const valor = textoParaCentavos(valorTexto)
    if (valor === null) return setErro('Informe um valor maior que zero.')
    const rotulo = TIPOS.find((t) => t.tipo === tipo)!.rotulo
    setSalvando(true)
    try {
      await registrarMovimentoCaixa({ tipo, valor, descricao: descricao.trim() || rotulo })
      setOk(`${rotulo}: ${formatarBRL(centavos(valor))} registrado.`)
      setValorTexto('')
      setDescricao('')
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao registrar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar()
      }}
    >
      <div className="app-card" style={{ width: '100%', maxWidth: 440, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>Movimento de caixa</h2>
        <div className="app-pill-group">
          {TIPOS.map((t) => (
            <button
              key={t.tipo}
              type="button"
              className="app-pill-btn"
              aria-pressed={tipo === t.tipo}
              onClick={() => setTipo(t.tipo)}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0' }}>
          {TIPOS.find((t) => t.tipo === tipo)!.ajuda}
        </p>
        <label style={{ display: 'block' }}>
          <span className="app-label">Valor (R$)</span>
          <input
            className="app-input app-input-lg"
            autoFocus
            inputMode="decimal"
            placeholder="0,00"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void confirmar()}
          />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          <span className="app-label">Motivo (opcional)</span>
          <input
            className="app-input"
            placeholder="Ex.: deposito no banco, troco, pagamento do gelo"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void confirmar()}
          />
        </label>
        {erro && <p className="app-msg-erro">{erro}</p>}
        {ok && <p className="app-msg-ok">{ok}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="app-btn app-btn-grande"
            disabled={salvando}
            onClick={() => void confirmar()}
          >
            {salvando ? 'Gravando...' : 'Confirmar'}
          </button>
          <button type="button" className="app-btn-ghost" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
