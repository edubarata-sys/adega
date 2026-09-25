import { centavos, formatarBRL, FORMAS_PAGAMENTO, type FormaPagamento } from '@adega/core'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SangriaModal } from './SangriaModal'
import {
  buscarProdutoPorEan,
  buscarProdutosPorDescricao,
  buscarRecibo,
  ErroRequisicao,
  listarEansAtivos,
  registrarVenda,
  type ProdutoApi,
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
import { aquecerCacheDeFotos, buscarFotoProduto } from './fotoProduto'
import { TopoApp } from './TopoApp'

interface Props {
  readonly operadorNome: string
  readonly aoQuererFecharCaixa: () => void
  /** Sai do usuario atual (volta pro login) sem fechar o caixa. */
  readonly aoSair: () => void
  /** So vem preenchido pra administrador (relatorio mostra custo e lucro). */
  readonly aoQuererRelatorios?: () => void
  /** So admin: entrada de mercadoria por foto da nota. */
  readonly aoQuererEntradaNota?: () => void
  /** Com codigo: abre o cadastro ja em "Novo produto" com esse codigo. */
  readonly aoQuererGerenciarProdutos: (eanInicial?: string) => void
}

/**
 * Deteccao de leitura da pistola SEM depender do sufixo: o teste de hardware
 * de 21/09 confirmou que a pistola le, mas nunca registrou se ela termina com
 * Enter, Tab ou nada (ver DiagnosticoTela, sufixoTerminacao). Por isso a tela
 * aceita Enter OU Tab, e tambem dispara sozinha quando chega uma rajada de
 * digitos rapida demais pra ser digitacao humana e depois para.
 */
const LIMIAR_PISTOLA_MS = 35
const ESPERA_FIM_LEITURA_MS = 150
const MIN_DIGITOS_EAN = 8

/**
 * Copia do recibo que so existe na impressao. Vai direto pro <body> (portal)
 * pra que o CSS de impressao (tema.css, `.recibo-impressao`) consiga esconder
 * TODO o resto da tela -- antes, window.print() imprimia a pagina inteira do
 * PDV encolhida pra 58mm (tira longa, quase vazia, texto bege quase apagado).
 * O tamanho da pagina acompanha o numero de linhas, entao a impressora para
 * de puxar papel quando o recibo acaba.
 */
function ReciboParaImpressao({ linhas }: { readonly linhas: readonly string[] }) {
  // 7pt x 1.25 de entrelinha ~= 3.1mm por linha, + folga pro corte.
  const alturaMm = Math.ceil(linhas.length * 3.2 + 12)
  return createPortal(
    <div className="recibo-impressao">
      <style>{`@media print { @page { size: 58mm ${alturaMm}mm; margin: 0; } }`}</style>
      <pre>{linhas.join('\n')}</pre>
    </div>,
    document.body,
  )
}

function centavosParaTexto(valor: number): string {
  return (valor / 100).toFixed(2).replace('.', ',')
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
export function PdvTela({
  operadorNome,
  aoQuererFecharCaixa,
  aoSair,
  aoQuererRelatorios,
  aoQuererEntradaNota,
  aoQuererGerenciarProdutos,
}: Props) {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [eanTexto, setEanTexto] = useState('')
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [eanNaoCadastrado, setEanNaoCadastrado] = useState<string | null>(null)
  const [escolhaMesmoCodigo, setEscolhaMesmoCodigo] = useState(false)
  const [sangriaAberta, setSangriaAberta] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [sugestoes, setSugestoes] = useState<ProdutoApi[]>([])
  // 'itens': passando produtos -- lado direito so mostra o ultimo item e o
  // total. 'pagamento': depois de "Finalizar compra", lado direito vira o
  // pagamento. Pedido do cliente 23/09 (menos poluicao enquanto passa itens).
  const [etapa, setEtapa] = useState<'itens' | 'pagamento'>('itens')
  const [ultimoItem, setUltimoItem] = useState<ProdutoApi | null>(null)
  const [fotoUltimo, setFotoUltimo] = useState<string | null>(null)

  // Foto do ultimo item (Open Food Facts, ver fotoProduto.ts). Nunca trava a
  // venda: o item ja entrou no carrinho; a foto aparece se e quando chegar.
  useEffect(() => {
    setFotoUltimo(null)
    if (!ultimoItem) return
    let cancelado = false
    void buscarFotoProduto(ultimoItem.ean).then((url) => {
      if (!cancelado) setFotoUltimo(url)
    })
    return () => {
      cancelado = true
    }
  }, [ultimoItem])

  // Banco de fotos: em segundo plano, 1 consulta a cada ~0,7s, so pros
  // codigos que ainda nao estao guardados neste computador.
  useEffect(() => {
    let parar: (() => void) | null = null
    let cancelado = false
    void listarEansAtivos().then(
      ({ eans }) => {
        if (!cancelado) parar = aquecerCacheDeFotos(eans)
      },
      () => {
        // Sem lista, sem aquecimento -- a foto ainda e buscada item a item.
      },
    )
    return () => {
      cancelado = true
      parar?.()
    }
  }, [])
  const eanRef = useRef<HTMLInputElement>(null)
  const buscandoRef = useRef(false)
  const teclasRef = useRef<number[]>([])
  const timerLeituraRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerLeituraRef.current !== null) window.clearTimeout(timerLeituraRef.current)
    },
    [],
  )

  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro')
  const [valorPagamentoTexto, setValorPagamentoTexto] = useState('')
  // true depois que o operador mexe no valor na mao -- ai o campo para de
  // ser preenchido sozinho com o que falta pagar ate o proximo pagamento.
  const valorEditadoRef = useRef(false)
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
  const quantidadeItens = carrinho.reduce((soma, item) => soma + item.quantidade, 0)

  useEffect(() => {
    if (carrinho.length === 0) setEtapa('itens')
    setUltimoItem((atual) =>
      atual && carrinho.some((item) => item.produtoId === atual.id) ? atual : null,
    )
  }, [carrinho])
  const faltaPagar = Math.max(total - pago, 0)

  // Campo de valor ja vem com o que falta pagar (subtotal na primeira vez,
  // o restante depois de cada pagamento) -- pra dividir em dois cartoes o
  // operador so baixa o valor do primeiro e o segundo ja vem com o resto.
  useEffect(() => {
    if (valorEditadoRef.current) return
    setValorPagamentoTexto(faltaPagar > 0 ? centavosParaTexto(faltaPagar) : '')
  }, [faltaPagar])

  /**
   * Quantidade antes do produto, igual ao sistema antigo: "3*" + produto
   * (ou "3**", "3*coca", "3*7894900027013") entra com quantidade 3.
   * Digitou so "3*" e Enter: vale pro PROXIMO produto (pistola ou nome).
   */
  const multiplicadorRef = useRef(1)
  const [multiplicador, setMultiplicador] = useState(1)
  function definirMultiplicador(q: number) {
    multiplicadorRef.current = q
    setMultiplicador(q)
  }

  function adicionarProduto(produto: ProdutoApi, quantidade?: number) {
    const qtd = quantidade ?? multiplicadorRef.current
    definirMultiplicador(1)
    setUltimoItem(produto)
    setCarrinho((atual) =>
      adicionarAoCarrinho(atual, {
        produtoId: produto.id,
        ean: produto.ean,
        descricao: produto.descricao,
        precoUnitario: centavos(produto.precoVenda),
        quantidade: qtd,
      }),
    )
    setSugestoes([])
    setEscolhaMesmoCodigo(false)
    setErroBusca(null)
    eanRef.current?.focus()
  }

  /**
   * Codigo so com digitos -> busca exata por EAN (pistola). Texto com letras
   * -> busca por nome e mostra a lista pra escolher. O campo e limpo ANTES da
   * busca: se a proxima leitura da pistola chegar, nao gruda no codigo
   * anterior (antes, um codigo nao encontrado ficava no campo e a leitura
   * seguinte virava um numero de 26 digitos que nunca achava nada).
   */
  async function processarEntrada(textoBruto: string) {
    let texto = textoBruto.trim()
    if (!texto || buscandoRef.current) return
    const comQtd = texto.match(/^(\d+(?:[.,]\d+)?)\s*\*+\s*(.*)$/)
    if (comQtd) {
      const q = Number(comQtd[1]!.replace(',', '.'))
      if (!(q > 0)) {
        setErroBusca('Quantidade invalida antes do *.')
        setEanTexto('')
        return
      }
      definirMultiplicador(q)
      texto = comQtd[2]!.trim()
      if (!texto) {
        // So "3*": espera o proximo produto.
        setEanTexto('')
        setErroBusca(null)
        eanRef.current?.focus()
        return
      }
    }
    buscandoRef.current = true
    setBuscando(true)
    setErroBusca(null)
    setEanNaoCadastrado(null)
    setEscolhaMesmoCodigo(false)
    setSugestoes([])
    setEanTexto('')
    try {
      if (/^\d+$/.test(texto)) {
        try {
          const { produto, produtos } = await buscarProdutoPorEan(texto)
          if (produtos && produtos.length > 1) {
            // Mesmo codigo em varios produtos (ex.: gelo por sabor): pergunta
            // qual. A quantidade do "3*" continua valendo pro escolhido.
            setEscolhaMesmoCodigo(true)
            setSugestoes(produtos)
            return
          }
          adicionarProduto(produto)
        } catch (e) {
          if (e instanceof ErroRequisicao && e.status === 404) {
            setErroBusca(
              `Codigo ${texto} nao esta cadastrado em nenhum produto. Digite o nome do produto e aperte Enter para buscar.`,
            )
            setEanNaoCadastrado(texto)
            return
          }
          throw e
        }
        return
      }
      if (texto.length < 2) {
        setErroBusca('Digite ao menos 2 letras do nome do produto.')
        return
      }
      const { produtos } = await buscarProdutosPorDescricao(texto)
      if (produtos.length === 0) {
        setErroBusca(`Nenhum produto encontrado com "${texto}".`)
      } else {
        setSugestoes(produtos)
      }
    } catch (e) {
      setErroBusca(e instanceof Error ? e.message : 'Erro ao buscar produto.')
    } finally {
      buscandoRef.current = false
      setBuscando(false)
      eanRef.current?.focus()
    }
  }

  function cancelarTimerLeitura() {
    if (timerLeituraRef.current !== null) {
      window.clearTimeout(timerLeituraRef.current)
      timerLeituraRef.current = null
    }
  }

  function aoTeclarBusca(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter' || evento.key === 'Tab') {
      // Tab com o campo vazio continua navegando normalmente.
      if (evento.key === 'Tab' && !evento.currentTarget.value.trim()) return
      evento.preventDefault()
      cancelarTimerLeitura()
      teclasRef.current = []
      void processarEntrada(evento.currentTarget.value)
      return
    }
    if (evento.key.length !== 1) return
    teclasRef.current.push(performance.now())
    cancelarTimerLeitura()
    timerLeituraRef.current = window.setTimeout(() => {
      timerLeituraRef.current = null
      const marcas = teclasRef.current
      teclasRef.current = []
      const valor = eanRef.current?.value.trim() ?? ''
      // "3*" digitado na mao + pistola: olha so a parte do codigo.
      const codigo = valor.replace(/^\d+(?:[.,]\d+)?\s*\*+\s*/, '')
      if (marcas.length < MIN_DIGITOS_EAN || !/^\d{8,14}$/.test(codigo)) return
      const ultimas = marcas.slice(-codigo.length)
      const intervaloMedio =
        (ultimas[ultimas.length - 1]! - ultimas[0]!) / Math.max(1, ultimas.length - 1)
      if (intervaloMedio <= LIMIAR_PISTOLA_MS) void processarEntrada(valor)
    }, ESPERA_FIM_LEITURA_MS)
  }

  function adicionarPagamento() {
    setErroPagamento(null)
    const valor = reaisParaCentavos(valorPagamentoTexto)
    if (!Number.isFinite(valor) || valor <= 0) {
      setErroPagamento('Informe um valor de pagamento maior que zero.')
      return
    }
    // Mesma regra do core (venda.ts): so dinheiro devolve troco. Avisar aqui
    // evita o operador descobrir so no "Confirmar venda".
    if (formaPagamento !== 'dinheiro' && valor > faltaPagar) {
      setErroPagamento(
        `${formaPagamento} nao pode passar do que falta pagar (${formatarBRL(centavos(faltaPagar))}). Troco so em dinheiro.`,
      )
      return
    }
    const pagamento: PagamentoInformado = {
      forma: formaPagamento,
      valor: centavos(valor),
      ...(ehPagamentoDeCartao && terminalApelido ? { terminalApelido } : {}),
    }
    valorEditadoRef.current = false
    const restante = Math.max(faltaPagar - valor, 0)
    setPagamentos((atual) => [...atual, pagamento])
    setValorPagamentoTexto(restante > 0 ? centavosParaTexto(restante) : '')
    setTerminalApelido(null)
  }

  function removerPagamento(indice: number) {
    valorEditadoRef.current = false
    setPagamentos((atual) => atual.filter((_, i) => i !== indice))
  }

  function novaVenda() {
    setEtapa('itens')
    setUltimoItem(null)
    valorEditadoRef.current = false
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
    // Mesmo esquema da tela de venda: pagina sem rolagem; so o quadro do
    // recibo rola por dentro quando a nota e grande. Direita fixa com total,
    // troco e os botoes (Nova venda ja focado: Enter comeca a proxima).
    return (
      <div className="app pdv-tela">
        <TopoApp titulo="Venda registrada">
          <span>{operadorNome}</span>
        </TopoApp>
        <main className="pdv-corpo">
          <div className="pdv-coluna">
            <div className="app-card pdv-card-compacto pdv-carrinho">
              <h2>Recibo</h2>
              {recibo ? (
                <>
                  <ReciboParaImpressao linhas={recibo.linhas} />
                  <div className="pdv-recibo-tela">
                    <pre>{recibo.linhas.join('\n')}</pre>
                  </div>
                </>
              ) : (
                <p className="app-label">Carregando recibo...</p>
              )}
            </div>
          </div>

          <div className="pdv-coluna pdv-coluna-pagamento">
            <div className="app-card pdv-card-compacto pdv-ultimo-item">
              <div className="app-resultado-icone ok">✓</div>
              <h2 style={{ margin: 0 }}>Venda registrada</h2>
              <p className="app-total-label" style={{ margin: '8px 0 0' }}>
                Total
              </p>
              <p className="app-total" style={{ margin: 0 }}>
                {formatarBRL(centavos(resultado.venda.total))}
              </p>
              {dinheiro && dinheiro.troco > 0 && (
                <p style={{ fontSize: '1.3rem', margin: '8px 0 0' }}>
                  Troco:{' '}
                  <strong style={{ color: 'var(--gold)' }}>
                    {formatarBRL(centavos(dinheiro.troco))}
                  </strong>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="app-btn-outline"
              disabled={!recibo}
            >
              Imprimir recibo
            </button>
            <button type="button" autoFocus onClick={novaVenda} className="app-btn app-btn-grande">
              Nova venda
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app pdv-tela">
      {sangriaAberta && (
        <SangriaModal
          aoFechar={() => {
            setSangriaAberta(false)
            eanRef.current?.focus()
          }}
        />
      )}
      <TopoApp titulo="Ponto de venda">
        <span>{operadorNome}</span>
        <button
          type="button"
          className="app-btn-outline"
          onClick={() => aoQuererGerenciarProdutos()}
        >
          Produtos
        </button>
        {aoQuererEntradaNota && (
          <button type="button" className="app-btn-outline" onClick={aoQuererEntradaNota}>
            Entrada por nota
          </button>
        )}
        {aoQuererRelatorios && (
          <button type="button" className="app-btn-outline" onClick={aoQuererRelatorios}>
            Relatorios
          </button>
        )}
        <button type="button" className="app-btn-outline" onClick={() => setSangriaAberta(true)}>
          Sangria
        </button>
        <button type="button" className="app-btn-outline" onClick={aoQuererFecharCaixa}>
          Fechar caixa
        </button>
        <button
          type="button"
          className="app-btn-ghost"
          title="Trocar de usuario (o caixa continua aberto)"
          onClick={aoSair}
        >
          Sair
        </button>
      </TopoApp>

      {/* Tela cheia sem rolagem geral: coluna da esquerda = busca + carrinho
          (so o carrinho rola por dentro); coluna da direita = total, falta
          pagar, pagamento e confirmar, sempre visiveis. */}
      <main className="pdv-corpo">
        <div className="pdv-coluna">
          <div className="app-card pdv-card-compacto">
            <span className="app-label">Codigo de barras ou nome do produto</span>
            <input
              ref={eanRef}
              autoFocus
              type="text"
              value={eanTexto}
              onChange={(e) => setEanTexto(e.target.value)}
              onKeyDown={aoTeclarBusca}
              placeholder="Passe a pistola ou digite o nome (3* antes = quantidade 3)"
              className="app-input app-input-lg"
            />
            {multiplicador !== 1 && (
              <p className="app-aviso" style={{ margin: '6px 0 0' }}>
                Proximo produto entra com quantidade{' '}
                <strong>{multiplicador.toLocaleString('pt-BR')}</strong>{' '}
                <button
                  type="button"
                  className="app-btn-ghost"
                  style={{ padding: '0 6px' }}
                  onClick={() => definirMultiplicador(1)}
                >
                  cancelar
                </button>
              </p>
            )}
            {buscando && <p className="app-label">Buscando...</p>}
            {erroBusca && <p className="app-msg-erro">{erroBusca}</p>}
            {erroBusca && eanNaoCadastrado && (
              <button
                type="button"
                className="app-btn-outline"
                style={{ marginTop: 6 }}
                onClick={() => aoQuererGerenciarProdutos(eanNaoCadastrado)}
              >
                Cadastrar produto com este codigo
              </button>
            )}
            {sugestoes.length > 0 && escolhaMesmoCodigo && (
              <p className="app-aviso" style={{ margin: '8px 0 0', fontSize: '1.1em' }}>
                <strong>Qual e?</strong> Esse codigo de barras e de {sugestoes.length} produtos.
              </p>
            )}
            {sugestoes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {sugestoes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="app-btn-outline"
                    style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                    onClick={() => adicionarProduto(p)}
                  >
                    <span>{p.descricao}</span>
                    <span>{formatarBRL(centavos(p.precoVenda))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="app-card pdv-card-compacto pdv-carrinho">
            <div className="pdv-carrinho-lista">
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
            </div>
          </div>
        </div>

        <div className="pdv-coluna pdv-coluna-pagamento">
          {etapa === 'itens' ? (
            <>
              <div className="app-card pdv-card-compacto pdv-ultimo-item">
                {/* Espaco da foto do produto -- por enquanto um desenho neutro
                    de garrafa; a foto de verdade entra aqui quando existir. */}
                <div className="pdv-foto-produto">
                  {fotoUltimo ? (
                    <img
                      src={fotoUltimo}
                      alt={ultimoItem?.descricao ?? ''}
                      onError={() => setFotoUltimo(null)}
                    />
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M10 2h4v3.2l1.4 2.3c.4.6.6 1.3.6 2V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5c0-.7.2-1.4.6-2L10 5.2V2z" />
                      <rect x="9.3" y="12" width="5.4" height="5" rx=".6" />
                    </svg>
                  )}
                  {fotoUltimo && <span className="pdv-foto-credito">foto: Open Food Facts</span>}
                </div>
                {ultimoItem ? (
                  <>
                    <p className="pdv-ultimo-nome">{ultimoItem.descricao}</p>
                    <p className="pdv-ultimo-preco">
                      {formatarBRL(centavos(ultimoItem.precoVenda))}
                    </p>
                  </>
                ) : (
                  <p className="pdv-ultimo-vazio">Passe a pistola no primeiro produto</p>
                )}
              </div>

              <div className="app-card pdv-card-compacto">
                <p className="app-total-label">Total da venda</p>
                <p className="app-total" style={{ margin: 0 }}>
                  {formatarBRL(total)}
                </p>
                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', textAlign: 'right' }}>
                  {quantidadeItens} {quantidadeItens === 1 ? 'item' : 'itens'}
                </p>
              </div>

              <button
                type="button"
                disabled={carrinho.length === 0}
                onClick={() => setEtapa('pagamento')}
                className="app-btn app-btn-grande"
              >
                Finalizar compra
              </button>
            </>
          ) : (
            <>
              <div className="app-card pdv-card-compacto">
                <p className="app-total-label">Total da venda</p>
                <p className="app-total" style={{ margin: 0 }}>
                  {formatarBRL(total)}
                </p>
                <div className="pdv-linha-status">
                  <button type="button" className="app-btn-ghost" onClick={() => setEtapa('itens')}>
                    ← Voltar aos itens
                  </button>
                  {faltaPagar > 0 ? (
                    <span>
                      Falta pagar:{' '}
                      <strong style={{ color: 'var(--gold)' }}>
                        {formatarBRL(centavos(faltaPagar))}
                      </strong>
                    </span>
                  ) : (
                    <strong style={{ color: 'var(--green)' }}>Pago</strong>
                  )}
                </div>
              </div>

              <div className="app-card pdv-card-compacto pdv-pagamento">
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
                  <label style={{ flex: 1, minWidth: 110 }}>
                    <span className="app-label">Valor (R$) -- baixe pra dividir</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valorPagamentoTexto}
                      onChange={(e) => {
                        valorEditadoRef.current = true
                        setValorPagamentoTexto(e.target.value)
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          adicionarPagamento()
                        }
                      }}
                      className="app-input"
                    />
                  </label>
                  <button type="button" onClick={adicionarPagamento} className="app-btn">
                    Adicionar pagamento
                  </button>
                </div>
                {erroPagamento && <p className="app-msg-erro">{erroPagamento}</p>}

                {pagamentos.length > 0 && (
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      marginTop: 12,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
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
                          {p.terminalApelido ? ` (${p.terminalApelido})` : ''}:{' '}
                          {formatarBRL(p.valor)}
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
                disabled={
                  carrinho.length === 0 ||
                  pagamentos.length === 0 ||
                  faltaPagar > 0 ||
                  enviandoVenda
                }
                onClick={() => void confirmarVenda()}
                className="app-btn app-btn-grande"
              >
                {enviandoVenda ? 'Registrando...' : 'Confirmar venda'}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
