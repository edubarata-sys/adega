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

interface Props {
  readonly operadorNome: string
  readonly aoQuererFecharCaixa: () => void
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
export function PdvTela({ operadorNome, aoQuererFecharCaixa }: Props) {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [eanTexto, setEanTexto] = useState('')
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const eanRef = useRef<HTMLInputElement>(null)

  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro')
  const [valorPagamentoTexto, setValorPagamentoTexto] = useState('')
  const [pagamentos, setPagamentos] = useState<PagamentoInformado[]>([])
  const [erroPagamento, setErroPagamento] = useState<string | null>(null)

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
    setPagamentos((atual) => [...atual, { forma: formaPagamento, valor: centavos(valor) }])
    setValorPagamentoTexto('')
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
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
        <h1 style={{ color: '#16a34a' }}>Venda registrada</h1>
        <p>Total: {formatarBRL(centavos(resultado.venda.total))}</p>
        {dinheiro && dinheiro.troco > 0 && (
          <p>
            Troco: <strong>{formatarBRL(centavos(dinheiro.troco))}</strong>
          </p>
        )}

        {recibo && (
          <>
            <pre
              style={{
                fontFamily: 'monospace',
                background: '#f3f4f6',
                padding: '1rem',
                whiteSpace: 'pre-wrap',
              }}
            >
              {recibo.linhas.join('\n')}
            </pre>
            <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Impressao real (ESC/POS) ainda depende de uma impressora fisica conectada -- o botao
              abaixo e so um fallback AUXILIAR via janela de impressao do navegador.
            </p>
            <button type="button" onClick={() => window.print()}>
              Imprimir (navegador -- auxiliar)
            </button>
          </>
        )}

        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={novaVenda}>
            Nova venda
          </button>
        </div>
      </main>
    )
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>PDV</h1>
        <span>
          Operador: {operadorNome}{' '}
          <button type="button" onClick={aoQuererFecharCaixa}>
            Fechar caixa
          </button>
        </span>
      </header>

      <label>
        Codigo de barras (EAN)
        <input
          ref={eanRef}
          autoFocus
          type="text"
          value={eanTexto}
          disabled={buscando}
          onChange={(e) => setEanTexto(e.target.value)}
          onKeyDown={(e) => void buscarPorEan(e)}
          placeholder="Passe a pistola ou digite e pressione Enter"
          style={{ display: 'block', width: '100%', fontSize: '1.1rem' }}
        />
      </label>
      {erroBusca && <p style={{ color: '#dc2626' }}>{erroBusca}</p>}

      <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Produto</th>
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
                  style={{ width: 56 }}
                />
              </td>
              <td>{formatarBRL(item.precoUnitario)}</td>
              <td>{formatarBRL(totalItem(item))}</td>
              <td>
                <button
                  type="button"
                  onClick={() => setCarrinho((atual) => removerDoCarrinho(atual, item.produtoId))}
                >
                  remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontSize: '1.5rem', textAlign: 'right' }}>
        Total: <strong>{formatarBRL(total)}</strong>
      </p>

      <section style={{ marginTop: 16 }}>
        <h2>Pagamento</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <label>
            Forma
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}
              style={{ display: 'block' }}
            >
              {FORMAS_PAGAMENTO.map((forma) => (
                <option key={forma} value={forma}>
                  {forma}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valor (R$)
            <input
              type="text"
              inputMode="decimal"
              value={valorPagamentoTexto}
              onChange={(e) => setValorPagamentoTexto(e.target.value)}
              style={{ display: 'block' }}
            />
          </label>
          <button type="button" onClick={adicionarPagamento}>
            Adicionar pagamento
          </button>
        </div>
        {erroPagamento && <p style={{ color: '#dc2626' }}>{erroPagamento}</p>}

        <ul>
          {pagamentos.map((p, indice) => (
            <li key={indice}>
              {p.forma}: {formatarBRL(p.valor)}{' '}
              <button type="button" onClick={() => removerPagamento(indice)}>
                remover
              </button>
            </li>
          ))}
        </ul>
        <p>
          Pago: {formatarBRL(pago)}{' '}
          {pago > total && <span>(troco estimado: {formatarBRL(centavos(pago - total))})</span>}
        </p>
      </section>

      {erroVenda && <p style={{ color: '#dc2626' }}>{erroVenda}</p>}
      <button
        type="button"
        disabled={carrinho.length === 0 || pagamentos.length === 0 || enviandoVenda}
        onClick={() => void confirmarVenda()}
        style={{ fontSize: '1.1rem', padding: '0.5rem 1rem' }}
      >
        {enviandoVenda ? 'Registrando...' : 'Confirmar venda'}
      </button>
    </main>
  )
}
