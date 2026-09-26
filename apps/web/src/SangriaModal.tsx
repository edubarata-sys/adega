import { centavos, formatarBRL } from '@adega/core'
import { useState } from 'react'
import {
  ajustarEstoque,
  buscarProdutoPorEan,
  buscarProdutosPorDescricao,
  ErroRequisicao,
  registrarMovimentoCaixa,
  type ProdutoApi,
  type TipoMovimentoCaixaApi,
} from './api'

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
  const [tipo, setTipo] = useState<TipoMovimentoCaixaApi | 'produto'>('sangria')
  const [valorTexto, setValorTexto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // --- Retirada de PRODUTO sem pagamento (consumo da casa, alguem pegou):
  // nao mexe no dinheiro do caixa, so baixa o estoque com o motivo.
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProdutoApi[]>([])
  const [produto, setProduto] = useState<ProdutoApi | null>(null)
  const [qtdTexto, setQtdTexto] = useState('1')

  async function buscarProduto() {
    setErro(null)
    const t = termo.trim()
    if (!t) return
    try {
      if (/^\d{8,14}$/.test(t)) {
        const r = await buscarProdutoPorEan(t)
        const lista = r.produtos && r.produtos.length > 1 ? r.produtos : [r.produto]
        setResultados(lista)
        if (lista.length === 1) setProduto(lista[0]!)
      } else {
        const r = await buscarProdutosPorDescricao(t)
        setResultados(r.produtos)
        if (r.produtos.length === 0) setErro('Nenhum produto encontrado.')
      }
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha na busca.')
    }
    setTermo('')
  }

  async function confirmarProduto() {
    setErro(null)
    setOk(null)
    if (!produto) return setErro('Escolha o produto.')
    const qtd = Number(qtdTexto.replace(',', '.'))
    if (!(qtd > 0)) return setErro('Informe a quantidade.')
    setSalvando(true)
    try {
      await ajustarEstoque(
        produto.id,
        'perda',
        qtd,
        (descricao.trim()
          ? `RETIRADA SEM PAGAMENTO: ${descricao.trim()}`
          : 'RETIRADA SEM PAGAMENTO'
        ).slice(0, 200),
      )
      setOk(`Retirada sem pagamento registrada: ${qtd} x ${produto.descricao}.`)
      setProduto(null)
      setResultados([])
      setQtdTexto('1')
      setDescricao('')
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao registrar.')
    } finally {
      setSalvando(false)
    }
  }

  async function confirmar() {
    if (tipo === 'produto') return confirmarProduto()
    setErro(null)
    setOk(null)
    const valor = textoParaCentavos(valorTexto)
    if (valor === null) return setErro('Informe um valor maior que zero.')
    const rotulo = TIPOS.find((t) => t.tipo === tipo)?.rotulo ?? tipo
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
          <button
            type="button"
            className="app-pill-btn"
            aria-pressed={tipo === 'produto'}
            onClick={() => setTipo('produto')}
          >
            Produto (sem pagar)
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0' }}>
          {tipo === 'produto'
            ? 'Produto que saiu sem pagamento. Nao mexe no dinheiro do caixa: so tira do estoque.'
            : TIPOS.find((t) => t.tipo === tipo)!.ajuda}
        </p>
        {tipo === 'produto' ? (
          <>
            {produto ? (
              <p style={{ margin: '4px 0' }}>
                Produto: <strong>{produto.descricao}</strong>{' '}
                <button
                  type="button"
                  className="app-btn-ghost"
                  style={{ padding: '0 6px' }}
                  onClick={() => setProduto(null)}
                >
                  trocar
                </button>
              </p>
            ) : (
              <>
                <input
                  className="app-input app-input-lg"
                  autoFocus
                  placeholder="Passe a pistola ou digite o nome e Enter"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      void buscarProduto()
                    }
                  }}
                />
                {resultados.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gap: 4,
                      marginTop: 6,
                      maxHeight: 180,
                      overflowY: 'auto',
                    }}
                  >
                    {resultados.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="app-btn-outline"
                        style={{ textAlign: 'left' }}
                        onClick={() => setProduto(p)}
                      >
                        {p.descricao}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <label style={{ display: 'block', marginTop: 8 }}>
              <span className="app-label">Quantidade</span>
              <input
                className="app-input"
                inputMode="decimal"
                value={qtdTexto}
                onChange={(e) => setQtdTexto(e.target.value)}
              />
            </label>
          </>
        ) : (
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
        )}
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
