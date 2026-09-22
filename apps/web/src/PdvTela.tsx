import { centavos, formatarBRL, FORMAS_PAGAMENTO, type FormaPagamento } from '@adega/core'
import { useEffect, useRef, useState } from 'react'
import {
  buscarProdutoPorEan,
  buscarRecibo,
  ErroRequisicao,
  registrarVenda,
  type ReciboApi,
  type VendaConfirmadaApi,
} from './api'
import {
  adicionarAoCarrinho,
  removerDoCarrinho,
  totalCarrinho,
  totalItem,
  totalPagamentos,
  atualizarQuantidade,
  type ItemCarrinho,
  type PagamentoInformado,
} from './carrinho'
import { TopoApp } from './TopoApp'

interface Props {
  readonly operadorNome: string
  readonly aoQuererFecharCaixa: () => void
  readonly aoQuererGerenciarProdutos: () => void
}

function reaisParaCentavos(texto: string): number {
  const normalizado = texto.trim().replace(',', '.')
  const valor = Number(normalizado)
  if (!Number.isFinite(valor)) return NaN
  return Math.round(valor * 100)
}

/**
 * Tela de venda do PDV: leitor (EAN) -> produto -> carrinho -> quantidade ->
 * total -> pagamento -> confirmar -> sucesso/erro (PASSO 7 da missao).
 *
 * O campo de EAN fica sempre focado: um leitor de codigo de barras USB se
 * comporta como teclado (digita os digitos e um Enter no final), entao nao
 * precisa de nenhum SDK -- so um input de texto que reage a Enter.
 */
export function PdvTela({ operadorNome, aoQuererFecharCaixa, aoQuererGerenciarProdutos }: Props) {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [eanTexto, setEanTexto] = useState('')
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const eanRef = useRef<HTMLInputElement>(null)

  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro')
  const [valorPagamentoTexto, setValorPagamentoTexto] = useState('')
  const [pagamentos, setPagamentos] = useState<PagamentoInformado[]>([])
  const [erroPagamento, setErroPagamento] = useState<string | null>(null)
  // A loja tem duas maquininhas fisicas -- so aparece pra debito/credito, e
  // so serve pra separar o relatorio de vendas depois (Task #11/#12).
  const [terminalApelido, setTerminalApelido] = useState<string | null>(null)
  const ehPagamentoDeCartao = formaPagamento === 'debito' || formaPagamento === 'credito'

  const [enviandoVenda, setEnviandoVenda] = useState(false)
  const [erroVenda, setErroVenda] = useState<string | null>(null)
  const [resultado, setResultado] = useState<VendaConfirmadaApi | null>(null)
  const [recibo, setRecibo] = useState<ReciboApi | null>(null)
  const vendaIdRef = useRef<string | null>(null)

  // Comprovante (PASSO 8): buscado assim que a venda e confirmada. O texto
  // vem pronto do FakePrinterAdapter (packages/core/recibo.ts) -- a tela so
  // exibe; window.print() abaixo e so um fallback AUXILIAR sobre este
  // texto, nunca a unica forma de emitir o comprovante.
  useEffect(() => {
    if (!resultado) {
      setRecibo(null)
      return
    }
    let cancelado = false
    void buscarRecibo(resultado.venda.id).then(
      (r) => {
        if (!cancelado) setRecibo(r)
      },
      () => {
        // Falha ao buscar o comprovante nao desfaz a venda -- ela ja foi
        // registrada com sucesso. So fica sem texto de recibo pra mostrar.
      },
    )
    return () => {
      cancelado = true
    }
  }, [resultado])

  const total = totalCarrinho(carrinho)
  const pago = totalPagamentos(pagamentos)

  async function buscarPorEan(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return
    evento.preventDefault()
    const ean = eanTexto.trim()
    if (!ean) return
    setBuscando(true)
    setErroBusca(null)
    try {
      const { produto } = await buscarProdutoPorEan(ean)
      setCarrinho((atual) =>
        adicionarAoCarrinho(atual, {
          produtoId: produto.id,
          ean: produto.ean,
          descricao: produto.descricao,
          precoUnitario: centavos(produto.precoVenda),
          quantidade: 1,
        }),
      )
      setEanTexto('')
    } catch (e) {
      setErroBusca(e instanceof ErroRequisicao ? e.message : 'Produto nao encontrado.')
    } finally {
      setBuscando(false)
      eanRef.current?.focus()
    }
  }

  function adicionarPagamento() {
    setErroPagamento(null)
    const valor = reaisParaCentavos(valorPagamentoTexto)
    if (!Number.isFinite(valor) || valor <= 0) {
      setErroPagamento('Informe um valor de pagamento maior que zero.')
      return
    }
    const pagamento: PagamentoInformado = {
      forma: formaPagamento,
      valor: centavos(valor),
      ...(ehPagamentoDeCartao && terminalApelido ? { terminalApelido } : {}),
    }
    setPagamentos((atual) => [...atual, pagamento])
    setValorPagamentoTexto('')
    setTerminalApelido(null)
  }

  function removerPagamento(indice: number) {
    setPagamentos((atual) => atual.filter((_, i) => i !== indice))
  }

  function novaVenda() {
    setCarrinho([])
    setPagamentos([])
    setResultado(null)
    setErroVenda(null)
    vendaIdRef.current = null
    eanRef.current?.focus()
  }

  async function confirmarVenda() {
    setErroVenda(null)
    if (carrinho.length === 0) {
      setErroVenda('Carrinho vazio.')
      return
    }
    if (!vendaIdRef.current) {
      vendaIdRef.current = crypto.randomUUID()
    }
    setEnviandoVenda(true)
    try {
      const resposta = await registrarVenda(
        vendaIdRef.current,
        carrinho.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
        })),
        pagamentos,
      )
      setResultado(resposta)
    } catch (e) {
      setErroVenda(e instanceof ErroRequisicao ? e.message : 'Falha ao registrar a venda.')
    } finally {
      setEnviandoVenda(false)
    }
  }

  if (resultado) {
    const dinheiro = resultado.pagamentos.find((p) => p.forma === 'dinheiro')
    return (
      <div className="app">
        <TopoApp titulo="Venda registrada">
          <span>{operadorNome}</span>
        </TopoApp>
        <main className="app-shell" style={{ maxWidth: 480 }}>
          <div className="app-card">
            <div className="app-resultado-icone ok">✓</div>
            <h2 style={{ margin: '0 0 4px' }}>Venda registrada</h2>
            <p className="app-total-label" style={{ textAlign: 'left', marginTop: 12 }}>
              Total
            </p>
            <p className="app-total" style={{ textAlign: 'left' }}>
              {formatarBRL(centavos(resultado.venda.total))}
            </p>
            {dinheiro && dinheiro.troco > 0 && (
              <p style={{ fontSize: '1.1rem' }}>
                Troco:{' '}
                <strong style={{ color: 'var(--gold)' }}>
                  {formatarBRL(centavos(dinheiro.troco))}
                </strong>
              </p>
            )}

            {recibo && (
              <>
                <pre
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    background: 'var(--bg-card-alt)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '1rem',
                    whiteSpace: 'pre-wrap',
                    color: '#dcd4bf',
                    fontSize: '.85rem',
                  }}
                >
                  {recibo.linhas.join('\n')}
                </pre>
                <p className="app-aviso">
                  Impressao real (ESC/POS) ainda depende de uma impressora fisica conectada -- o
                  botao abaixo e so um fallback AUXILIAR via janela de impressao do navegador.
                </p>
                <button type="button" onClick={() => window.print()} className="app-btn-outline">
                  Imprimir (navegador -- auxiliar)
                </button>
              </>
            )}

            <div style={{ marginTop: 16 }}>
              <button type="button" onClick={novaVenda} className="app-btn app-btn-grande">
                Nova venda
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <TopoApp titulo="Ponto de venda">
        <span>{operadorNome}</span>
        <button type="button" className="app-btn-outline" onClick={aoQuererGerenciarProdutos}>
          Produtos
        </button>
        <button type="button" className="app-btn-outline" onClick={aoQuererFecharCaixa}>
          Fechar caixa
        </button>
      </TopoApp>

      <main className="app-shell" style={{ maxWidth: 720 }}>
        <div className="app-card">
          <span className="app-label">Codigo de barras (EAN)</span>
          <input
            ref={eanRef}
            autoFocus
            type="text"
            value={eanTexto}
            disabled={buscando}
            onChange={(e) => setEanTexto(e.target.value)}
            onKeyDown={(e) => void buscarPorEan(e)}
            placeholder="Passe a pistola ou digite e pressione Enter"
            className="app-input app-input-lg"
          />
          {erroBusca && <p className="app-msg-erro">{erroBusca}</p>}
        </div>

        <div className="app-card">
          <table className="app-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd</th>
                <th>Preco</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {carrinho.map((item) => (
                <tr key={item.produtoId}>
                  <td>{item.descricao}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={item.quantidade}
                      onChange={(e) =>
                        setCarrinho((atual) =>
                          atualizarQuantidade(
                            atual,
                            item.produtoId,
                            Math.max(1, Number(e.target.value) || 1),
                          ),
                        )
                      }
                      className="app-input"
                      style={{ width: 64, padding: '6px 8px', fontSize: '.95rem' }}
                    />
                  </td>
                  <td>{formatarBRL(item.precoUnitario)}</td>
                  <td>{formatarBRL(totalItem(item))}</td>
                  <td>
                    <button
                      type="button"
                      className="app-btn-ghost"
                      onClick={() =>
                        setCarrinho((atual) => removerDoCarrinho(atual, item.produtoId))
                      }
                    >
                      remover
                    </button>
                  </td>
                </tr>
              ))}
              {carrinho.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)', paddingTop: 12 }}>
                    Nenhum item no carrinho ainda. Passe a pistola no campo acima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 12 }}>
            <p className="app-total-label">Total</p>
            <p className="app-total">{formatarBRL(total)}</p>
          </div>
        </div>

        <div className="app-card">
          <h2>Pagamento</h2>
          <div className="app-pill-group" style={{ marginBottom: 12 }}>
            {FORMAS_PAGAMENTO.map((forma) => (
              <button
                key={forma}
                type="button"
                className="app-pill-btn"
                aria-pressed={formaPagamento === forma}
                onClick={() => {
                  setFormaPagamento(forma)
                  setTerminalApelido(null)
                }}
              >
                {forma}
              </button>
            ))}
          </div>

          {ehPagamentoDeCartao && (
            <div style={{ marginBottom: 12 }}>
              <span className="app-label">Maquininha</span>
              <div className="app-pill-group">
                {['Maquininha 1', 'Maquininha 2'].map((apelido) => (
                  <button
                    key={apelido}
                    type="button"
                    className="app-pill-btn"
                    aria-pressed={terminalApelido === apelido}
                    onClick={() => setTerminalApelido(apelido)}
                  >
                    {apelido}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 160 }}>
              <span className="app-label">Valor (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={valorPagamentoTexto}
                onChange={(e) => setValorPagamentoTexto(e.target.value)}
                className="app-input"
              />
            </label>
            <button type="button" onClick={adicionarPagamento} className="app-btn">
              Adicionar pagamento
            </button>
          </div>
          {erroPagamento && <p className="app-msg-erro">{erroPagamento}</p>}

          {pagamentos.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'grid', gap: 6 }}>
              {pagamentos.map((p, indice) => (
                <li
                  key={indice}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-card-alt)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                  }}
                >
                  <span>
                    {p.forma}
                    {p.terminalApelido ? ` (${p.terminalApelido})` : ''}: {formatarBRL(p.valor)}
                  </span>
                  <button
                    type="button"
                    className="app-btn-ghost"
                    onClick={() => removerPagamento(indice)}
                  >
                    remover
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p style={{ marginTop: 12 }}>
            Pago: <strong>{formatarBRL(pago)}</strong>{' '}
            {pago > total && (
              <span style={{ color: 'var(--green)' }}>
                (troco estimado: {formatarBRL(centavos(pago - total))})
              </span>
            )}
          </p>
        </div>

        {erroVenda && <p className="app-msg-erro">{erroVenda}</p>}
        <button
          type="button"
          disabled={carrinho.length === 0 || pagamentos.length === 0 || enviandoVenda}
          onClick={() => void confirmarVenda()}
          className="app-btn app-btn-grande"
        >
          {enviandoVenda ? 'Registrando...' : 'Confirmar venda'}
        </button>
      </main>
    </div>
  )
}
