import {
  buscarNoCatalogoPorFala,
  centavos,
  formatarBRL,
  interpretarPedido,
  multiplicarPorQuantidade,
  palavrasDeBusca,
  type FormaPagamento,
} from '@adega/core'
import { useEffect, useMemo, useState } from 'react'
import {
  buscarCatalogoPdv,
  caixaAtual,
  ErroRequisicao,
  registrarVenda,
  type PagamentoVendaApi,
  type ProdutoApi,
} from './api'
import { construtorReconhecimentoDeVoz, type ResultadoReconhecimentoVoz } from './voz'

/**
 * Venda rapida pelo celular (14/10/2026): o Leandro (ou funcionario, pelo
 * PIN) fica no espaco do espetinho/chopp, do outro lado da rua. Fala o
 * pedido ("3 espetinhos de frango e 2 chopps"), confere, recebe e pronto --
 * a venda entra no MESMO caixa aberto da adega, marcada como origem
 * 'celular' so pra separar no relatorio. Nada e gravado sem confirmar.
 */

interface LinhaCarrinho {
  readonly chave: string
  readonly trecho: string
  readonly candidatos: readonly ProdutoApi[]
  readonly produtoId: string | null
  readonly quantidade: number
}

const FORMAS: readonly { valor: FormaPagamento; rotulo: string }[] = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'debito', rotulo: 'Debito' },
  { valor: 'credito', rotulo: 'Credito' },
]
const MAQUININHAS = ['Maquininha 1', 'Maquininha 2', 'Maquininha 3']

function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/\s|R\$/g, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

let contador = 0
function novaChave(): string {
  contador += 1
  return `l${Date.now()}-${contador}`
}

export function VendaCelularTela() {
  const [catalogo, setCatalogo] = useState<ProdutoApi[] | null>(null)
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [suportaVoz] = useState(() => construtorReconhecimentoDeVoz() !== null)
  const [ouvindo, setOuvindo] = useState(false)
  const [texto, setTexto] = useState('')
  const [linhas, setLinhas] = useState<LinhaCarrinho[]>([])
  const [forma, setForma] = useState<FormaPagamento | null>(null)
  const [maquininha, setMaquininha] = useState<string | null>(null)
  const [recebidoTexto, setRecebidoTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [vendaId, setVendaId] = useState(() => crypto.randomUUID())
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function carregar() {
    setErroCarga(null)
    Promise.all([buscarCatalogoPdv(), caixaAtual()])
      .then(([cat, caixa]) => {
        setCatalogo(cat.produtos)
        setCaixaAberto(caixa.sessao !== null)
      })
      .catch((e) =>
        setErroCarga(
          e instanceof ErroRequisicao ? e.message : 'Sem conexao -- confere o 4G e tenta de novo.',
        ),
      )
  }
  useEffect(carregar, [])

  const porId = useMemo(() => new Map((catalogo ?? []).map((p) => [p.id, p])), [catalogo])

  function adicionarDoTexto(fala: string) {
    if (!catalogo) return
    const novas = interpretarPedido(fala, catalogo).map((l) => ({
      chave: novaChave(),
      trecho: l.trecho,
      candidatos: l.candidatos as ProdutoApi[],
      produtoId: l.candidatos[0]?.id ?? null,
      quantidade: l.quantidade,
    }))
    if (novas.length === 0) {
      setErro('Nao entendi o pedido -- fala de novo ou digita.')
      return
    }
    setErro(null)
    setOk(null)
    setLinhas((atual) => [...atual, ...novas])
    setTexto('')
  }

  function falar() {
    const Construtor = construtorReconhecimentoDeVoz()
    if (!Construtor) return
    setErro(null)
    const rec = new Construtor()
    rec.lang = 'pt-BR'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (evento: ResultadoReconhecimentoVoz) => {
      const fala = String(evento.results[0]?.[0]?.transcript ?? '')
      setTexto(fala)
      adicionarDoTexto(fala)
    }
    rec.onerror = () => {
      setOuvindo(false)
      setErro('Nao consegui ouvir -- tenta de novo ou digita abaixo.')
    }
    rec.onend = () => setOuvindo(false)
    setOuvindo(true)
    rec.start()
  }

  function mudar(chave: string, mudanca: Partial<LinhaCarrinho>) {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)))
  }

  function buscarDeNovo(chave: string, termo: string) {
    if (!catalogo) return
    const candidatos = buscarNoCatalogoPorFala(catalogo, palavrasDeBusca(termo)) as ProdutoApi[]
    mudar(chave, { trecho: termo, candidatos, produtoId: candidatos[0]?.id ?? null })
  }

  const itensValidos = linhas.filter((l) => l.produtoId && porId.has(l.produtoId))
  const total = itensValidos.reduce(
    (s, l) =>
      s + multiplicarPorQuantidade(centavos(porId.get(l.produtoId!)!.precoVenda), l.quantidade),
    0,
  )
  const pendentes = linhas.length - itensValidos.length
  const recebido = reaisParaCentavos(recebidoTexto)
  const ehCartao = forma === 'debito' || forma === 'credito'
  const troco = forma === 'dinheiro' && recebido !== null ? recebido - total : null
  const podeVender =
    caixaAberto === true &&
    itensValidos.length > 0 &&
    pendentes === 0 &&
    forma !== null &&
    (!ehCartao || maquininha !== null) &&
    (forma !== 'dinheiro' || recebidoTexto.trim() === '' || (troco !== null && troco >= 0)) &&
    !enviando

  async function vender() {
    if (!podeVender || !forma) return
    setEnviando(true)
    setErro(null)
    const pagamento: PagamentoVendaApi = {
      forma,
      valor: forma === 'dinheiro' && recebido !== null && recebido > 0 ? recebido : total,
      ...(ehCartao && maquininha ? { terminalApelido: maquininha } : {}),
    }
    try {
      await registrarVenda(
        vendaId,
        itensValidos.map((l) => ({
          produtoId: l.produtoId!,
          quantidade: l.quantidade,
          precoUnitario: porId.get(l.produtoId!)!.precoVenda,
        })),
        [pagamento],
        undefined,
        'celular',
      )
      setOk(
        `Venda registrada: ${formatarBRL(centavos(total))}` +
          (troco && troco > 0 ? ` -- troco ${formatarBRL(centavos(troco))}` : ''),
      )
      setLinhas([])
      setForma(null)
      setMaquininha(null)
      setRecebidoTexto('')
      setVendaId(crypto.randomUUID())
    } catch (e) {
      // Mesmo id na proxima tentativa: se a venda chegou e so a resposta
      // se perdeu, o servidor devolve a mesma venda (nao duplica).
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao registrar -- tenta de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (erroCarga) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Venda</h2>
        <p className="app-msg-erro">{erroCarga}</p>
        <button type="button" className="app-btn" onClick={carregar}>
          Tentar de novo
        </button>
      </div>
    )
  }
  if (catalogo === null || caixaAberto === null) return <p>Carregando produtos...</p>

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ marginTop: 0 }}>Venda</h2>

      {!caixaAberto && (
        <p className="app-msg-erro">
          O caixa da adega esta fechado. Abra o caixa no PDV antes de vender pelo celular.
        </p>
      )}
      {ok && <p className="app-aviso">{ok}</p>}

      {suportaVoz ? (
        <button
          type="button"
          className={`mobile-mic-btn${ouvindo ? ' ouvindo' : ''}`}
          onClick={falar}
          disabled={ouvindo}
        >
          <span className="mobile-mic-icone">{'\u{1F3A4}'}</span>
          {ouvindo ? 'Ouvindo...' : 'Falar o pedido'}
        </button>
      ) : (
        <p className="app-aviso">Voz nao funciona neste navegador -- digita o pedido abaixo.</p>
      )}

      <label>
        <span className="app-label">Pedido</span>
        <textarea
          className="app-input"
          rows={2}
          placeholder='Ex.: "3 espetinhos de frango e 2 chopps"'
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="app-btn-outline"
        onClick={() => adicionarDoTexto(texto)}
        disabled={texto.trim().length === 0}
      >
        Adicionar
      </button>

      {linhas.length > 0 && (
        <div className="app-card" style={{ background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <p className="app-label" style={{ margin: 0 }}>
            Confira o pedido
          </p>
          {linhas.map((l) => {
            const produto = l.produtoId ? porId.get(l.produtoId) : undefined
            return (
              <div key={l.chave} style={{ display: 'grid', gap: 6 }}>
                {l.candidatos.length > 0 ? (
                  <select
                    className="app-input"
                    value={l.produtoId ?? ''}
                    onChange={(e) => mudar(l.chave, { produtoId: e.target.value || null })}
                  >
                    {l.candidatos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.descricao} -- {formatarBRL(centavos(c.precoVenda))}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="app-msg-erro" style={{ margin: 0 }}>
                    Nao achei &quot;{l.trecho}&quot; -- digita outro nome:
                  </p>
                )}
                {l.candidatos.length === 0 && (
                  <input
                    className="app-input"
                    placeholder="Nome do produto"
                    onBlur={(e) => e.target.value.trim() && buscarDeNovo(l.chave, e.target.value)}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="app-btn-outline"
                    aria-label="Diminuir"
                    onClick={() =>
                      l.quantidade > 1
                        ? mudar(l.chave, { quantidade: l.quantidade - 1 })
                        : setLinhas((a) => a.filter((x) => x.chave !== l.chave))
                    }
                  >
                    -
                  </button>
                  <strong style={{ minWidth: 28, textAlign: 'center' }}>{l.quantidade}</strong>
                  <button
                    type="button"
                    className="app-btn-outline"
                    aria-label="Aumentar"
                    onClick={() => mudar(l.chave, { quantidade: l.quantidade + 1 })}
                  >
                    +
                  </button>
                  <span style={{ marginLeft: 'auto' }}>
                    {produto
                      ? formatarBRL(
                          multiplicarPorQuantidade(centavos(produto.precoVenda), l.quantidade),
                        )
                      : '-'}
                  </span>
                  <button
                    type="button"
                    className="app-btn-ghost"
                    onClick={() => setLinhas((a) => a.filter((x) => x.chave !== l.chave))}
                  >
                    Tirar
                  </button>
                </div>
              </div>
            )
          })}
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
            Total: {formatarBRL(centavos(total))}
          </p>
        </div>
      )}

      {itensValidos.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="app-label">Pagamento</span>
          <div className="app-toggle-grupo">
            {FORMAS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className="app-toggle"
                aria-pressed={forma === f.valor}
                onClick={() => setForma(f.valor)}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
          {ehCartao && (
            <div className="app-toggle-grupo">
              {MAQUININHAS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="app-toggle"
                  aria-pressed={maquininha === m}
                  onClick={() => setMaquininha(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {forma === 'dinheiro' && (
            <label>
              <span className="app-label">Recebido (opcional, pra calcular troco)</span>
              <input
                className="app-input"
                inputMode="decimal"
                placeholder="Ex.: 50"
                value={recebidoTexto}
                onChange={(e) => setRecebidoTexto(e.target.value)}
              />
              {troco !== null && (
                <span style={{ fontWeight: 700 }}>
                  {troco >= 0
                    ? `Troco: ${formatarBRL(centavos(troco))}`
                    : `Faltam ${formatarBRL(centavos(-troco))}`}
                </span>
              )}
            </label>
          )}
          <button
            type="button"
            className="app-btn"
            disabled={!podeVender}
            onClick={() => void vender()}
          >
            {enviando ? 'Registrando...' : `Confirmar venda -- ${formatarBRL(centavos(total))}`}
          </button>
        </div>
      )}

      {erro && <p className="app-msg-erro">{erro}</p>}
    </div>
  )
}
