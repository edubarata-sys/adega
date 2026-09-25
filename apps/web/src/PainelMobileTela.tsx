import { centavos, dataLojaIso, formatarBRL } from '@adega/core'
import { useEffect, useState } from 'react'
import {
  ajustarEstoque,
  baixarRelatorioXml,
  buscarProdutosPorDescricao,
  caixaAtual,
  ErroRequisicao,
  logout,
  type ProdutoApi,
  type SessaoCaixaApi,
  type UsuarioSessao,
} from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly usuario: UsuarioSessao
  readonly aoSair: () => void
}

type Aba = 'estoque' | 'caixa' | 'relatorio'

/**
 * Painel admin mobile (HANDOFF.md secao 12 -- combinado com o cliente):
 * segunda area do sistema, separada da tela de venda do balconista, pensada
 * pro celular do dono. Tres abas: atualizar estoque por voz, consultar
 * caixa (so leitura) e gerar o XML da contadora.
 */
export function PainelMobileTela({ usuario, aoSair }: Props) {
  const [aba, setAba] = useState<Aba>('estoque')

  async function sair() {
    await logout().catch(() => {})
    aoSair()
  }

  return (
    <div className="app">
      <TopoApp titulo="Painel mobile">
        <span>{usuario.nome}</span>
        <button type="button" className="app-btn-ghost" onClick={() => void sair()}>
          Sair
        </button>
      </TopoApp>
      <main className="app-shell mobile-shell" style={{ maxWidth: 480 }}>
        <div className="app-card">
          {aba === 'estoque' && <AbaEstoquePorVoz />}
          {aba === 'caixa' && <AbaCaixa />}
          {aba === 'relatorio' && <AbaRelatorio />}
        </div>
      </main>

      <nav className="mobile-tabbar">
        <button
          type="button"
          className="mobile-tab-btn"
          aria-pressed={aba === 'estoque'}
          onClick={() => setAba('estoque')}
        >
          <span className="mobile-tab-icone">{'\u{1F4E6}'}</span>
          Estoque
        </button>
        <button
          type="button"
          className="mobile-tab-btn"
          aria-pressed={aba === 'caixa'}
          onClick={() => setAba('caixa')}
        >
          <span className="mobile-tab-icone">{'\u{1F4B0}'}</span>
          Caixa
        </button>
        <button
          type="button"
          className="mobile-tab-btn"
          aria-pressed={aba === 'relatorio'}
          onClick={() => setAba('relatorio')}
        >
          <span className="mobile-tab-icone">{'\u{1F4C4}'}</span>
          Relatorio
        </button>
      </nav>
    </div>
  )
}

function AbaCaixa() {
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando')
  const [sessao, setSessao] = useState<SessaoCaixaApi | null>(null)
  const [totalVendido, setTotalVendido] = useState<number | null>(null)

  useEffect(() => {
    let cancelado = false
    setEstado('carregando')
    caixaAtual()
      .then((r) => {
        if (cancelado) return
        setSessao(r.sessao)
        setTotalVendido(r.totalVendido)
        setEstado('ok')
      })
      .catch(() => {
        if (!cancelado) setEstado('erro')
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (estado === 'carregando') return <p>Carregando...</p>
  if (estado === 'erro') return <p className="app-msg-erro">Falha ao consultar o caixa.</p>
  if (!sessao) return <p className="app-aviso">Nenhum caixa aberto agora.</p>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ marginTop: 0 }}>Caixa aberto</h2>
      <p>
        Aberto em: <strong>{new Date(sessao.abertoEm).toLocaleString('pt-BR')}</strong>
      </p>
      <p>
        Fundo de troco: <strong>{formatarBRL(centavos(sessao.fundoTroco))}</strong>
      </p>
      <p>
        Total vendido nesta sessao: <strong>{formatarBRL(centavos(totalVendido ?? 0))}</strong>
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
        So consulta -- pra abrir ou fechar o caixa, use o sistema no balcao.
      </p>
    </div>
  )
}

/** Hoje no calendario da loja -- `toISOString()` e UTC e, depois das 21h,
 * ja devolvia o dia seguinte (relatorio "de hoje" vinha vazio). */
function hojeIso(): string {
  return dataLojaIso()
}

function AbaRelatorio() {
  const [inicio, setInicio] = useState(hojeIso())
  const [fim, setFim] = useState(hojeIso())
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [baixando, setBaixando] = useState(false)

  async function baixar() {
    setErro(null)
    setOk(null)
    setBaixando(true)
    try {
      await baixarRelatorioXml(inicio, fim)
      setOk('XML baixado -- confere na pasta de downloads do celular.')
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao gerar o relatorio.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ marginTop: 0 }}>Relatorio de vendas (XML)</h2>
      <div className="app-grid-2">
        <label>
          <span className="app-label">De</span>
          <input
            type="date"
            className="app-input"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
        </label>
        <label>
          <span className="app-label">Ate</span>
          <input
            type="date"
            className="app-input"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="app-btn app-btn-grande"
        disabled={baixando}
        onClick={() => void baixar()}
      >
        {baixando ? 'Gerando...' : 'Baixar XML'}
      </button>
      {erro && <p className="app-msg-erro">{erro}</p>}
      {ok && <p className="app-msg-ok">{ok}</p>}
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
        Envio automatico por e-mail ainda nao esta configurado -- baixa aqui e encaminha na mao pra
        contadora por enquanto.
      </p>
    </div>
  )
}

const PALAVRAS_ENTRADA = [
  'entrada',
  'entrou',
  'chegou',
  'recebi',
  'recebido',
  'comprei',
  'adicionar',
  'adiciona',
  'chegada',
]
const PALAVRAS_PERDA = [
  'perda',
  'perdi',
  'quebrou',
  'quebrei',
  'venceu',
  'vencido',
  'estragou',
  'estragado',
  'sumiu',
]
const PALAVRAS_AJUSTE = ['ajuste', 'ajustar', 'corrigir', 'correcao', 'contagem']
const PALAVRAS_IGNORADAS = new Set([
  'de',
  'do',
  'da',
  'das',
  'dos',
  'um',
  'uma',
  'unidades',
  'unidade',
  'un',
  'no',
  'na',
  'o',
  'a',
])

const NUMEROS_EXTENSO: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
}

function removerAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Interpretacao BEM simples do comando falado/digitado -- nunca decide
 * sozinha: so preenche os campos do formulario de confirmacao, que o
 * operador sempre revisa (e pode corrigir) antes de gravar qualquer coisa.
 * Nome de produto errado por reconhecimento de voz e risco real (rotulo
 * estrangeiro, sotaque) -- por isso a gravacao direta sem confirmacao nunca
 * acontece.
 */
function interpretarComandoEstoque(textoOriginal: string): {
  tipo: 'entrada' | 'perda' | 'ajuste'
  quantidade: number | null
  termoProduto: string
} {
  const texto = removerAcentos(textoOriginal.toLowerCase().trim())
  const palavras = texto.split(/\s+/).filter(Boolean)

  let tipo: 'entrada' | 'perda' | 'ajuste' = 'entrada'
  if (PALAVRAS_PERDA.some((p) => texto.includes(p))) tipo = 'perda'
  else if (PALAVRAS_AJUSTE.some((p) => texto.includes(p))) tipo = 'ajuste'
  else if (PALAVRAS_ENTRADA.some((p) => texto.includes(p))) tipo = 'entrada'

  let quantidade: number | null = null
  const restante: string[] = []
  for (const palavra of palavras) {
    const digitos = /\d+/.exec(palavra)
    if (digitos && quantidade === null) {
      quantidade = Number(digitos[0])
      continue
    }
    if (quantidade === null && palavra in NUMEROS_EXTENSO) {
      quantidade = NUMEROS_EXTENSO[palavra]!
      continue
    }
    const ePalavraChave =
      PALAVRAS_ENTRADA.includes(palavra) ||
      PALAVRAS_PERDA.includes(palavra) ||
      PALAVRAS_AJUSTE.includes(palavra) ||
      PALAVRAS_IGNORADAS.has(palavra)
    if (!ePalavraChave) restante.push(palavra)
  }

  return { tipo, quantidade, termoProduto: restante.join(' ').trim() }
}

/**
 * Web Speech API nao tem tipos oficiais no TS/DOM lib -- declaramos so o
 * pedacinho que usamos (nao o `any` cru, que o lint bloqueia), com
 * checagem de suporte antes de usar (Safari/iOS nao tem).
 */
interface ResultadoReconhecimentoVoz {
  readonly results: {
    readonly [indice: number]: { readonly [alternativa: number]: { readonly transcript: string } }
  }
}

interface ReconhecimentoVoz {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((evento: ResultadoReconhecimentoVoz) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
}

function construtorReconhecimentoDeVoz(): (new () => ReconhecimentoVoz) | null {
  const janela = window as unknown as {
    SpeechRecognition?: new () => ReconhecimentoVoz
    webkitSpeechRecognition?: new () => ReconhecimentoVoz
  }
  return janela.SpeechRecognition ?? janela.webkitSpeechRecognition ?? null
}

function formatarEstoque(valor: number | string | null): string {
  if (valor === null || valor === undefined || valor === '') return '0'
  const n = Number(valor)
  if (!Number.isFinite(n)) return String(valor)
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function AbaEstoquePorVoz() {
  const [suportaVoz] = useState(() => construtorReconhecimentoDeVoz() !== null)
  const [ouvindo, setOuvindo] = useState(false)
  const [textoComando, setTextoComando] = useState('')
  const [tipoMovimento, setTipoMovimento] = useState<'entrada' | 'perda' | 'ajuste'>('entrada')
  const [quantidadeTexto, setQuantidadeTexto] = useState('')
  const [sinalAjuste, setSinalAjuste] = useState<'+' | '-'>('+')
  const [termoBusca, setTermoBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoApi[]>([])
  const [produtoId, setProdutoId] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [mensagemOk, setMensagemOk] = useState<string | null>(null)

  function interpretar(texto: string) {
    const resultado = interpretarComandoEstoque(texto)
    setTipoMovimento(resultado.tipo)
    if (resultado.quantidade !== null) setQuantidadeTexto(String(resultado.quantidade))
    setTermoBusca(resultado.termoProduto)
    setProdutoId(null)
    setMensagemOk(null)
  }

  function falar() {
    const Construtor = construtorReconhecimentoDeVoz()
    if (!Construtor) return
    setErro(null)
    setMensagemOk(null)
    const reconhecimento = new Construtor()
    reconhecimento.lang = 'pt-BR'
    reconhecimento.interimResults = false
    reconhecimento.maxAlternatives = 1
    reconhecimento.onresult = (evento: ResultadoReconhecimentoVoz) => {
      const transcricao = String(evento.results[0]?.[0]?.transcript ?? '')
      setTextoComando(transcricao)
      interpretar(transcricao)
    }
    reconhecimento.onerror = () => {
      setOuvindo(false)
      setErro('Nao consegui ouvir -- tenta de novo ou digita abaixo.')
    }
    reconhecimento.onend = () => setOuvindo(false)
    setOuvindo(true)
    reconhecimento.start()
  }

  useEffect(() => {
    if (termoBusca.trim().length < 2) {
      setResultados([])
      return
    }
    let cancelado = false
    setBuscando(true)
    const temporizador = setTimeout(() => {
      buscarProdutosPorDescricao(termoBusca.trim())
        .then((r) => {
          if (cancelado) return
          setResultados(r.produtos)
          if (r.produtos.length > 0) setProdutoId(r.produtos[0]!.id)
        })
        .catch(() => {
          if (!cancelado) setResultados([])
        })
        .finally(() => {
          if (!cancelado) setBuscando(false)
        })
    }, 400)
    return () => {
      cancelado = true
      clearTimeout(temporizador)
    }
  }, [termoBusca])

  const produtoSelecionado = resultados.find((p) => p.id === produtoId) ?? null
  const quantidadeNumero = Number(quantidadeTexto.replace(',', '.'))
  const quantidadeValida = Number.isFinite(quantidadeNumero) && quantidadeNumero > 0
  const mostrarConfirmacao = termoBusca.trim().length > 0 || quantidadeTexto.trim().length > 0

  async function confirmar() {
    if (!produtoSelecionado || !quantidadeValida) return
    setEnviando(true)
    setErro(null)
    try {
      const delta =
        tipoMovimento === 'ajuste' && sinalAjuste === '-' ? -quantidadeNumero : quantidadeNumero
      const { produto } = await ajustarEstoque(
        produtoSelecionado.id,
        tipoMovimento,
        delta,
        'Registrado por voz -- painel mobile',
      )
      setMensagemOk(
        `Feito: ${produto.descricao} agora tem ${produto.estoqueAtual ?? '?'} em estoque.`,
      )
      setTextoComando('')
      setQuantidadeTexto('')
      setTermoBusca('')
      setResultados([])
      setProdutoId(null)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao gravar o ajuste de estoque.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ marginTop: 0 }}>Atualizar estoque</h2>

      {suportaVoz ? (
        <button
          type="button"
          className={`mobile-mic-btn${ouvindo ? ' ouvindo' : ''}`}
          onClick={falar}
          disabled={ouvindo}
        >
          <span className="mobile-mic-icone">{'\u{1F3A4}'}</span>
          {ouvindo ? 'Ouvindo...' : 'Falar'}
        </button>
      ) : (
        <p className="app-aviso">
          Reconhecimento de voz nao e suportado neste navegador (funciona no Chrome/Android) --
          digita abaixo.
        </p>
      )}

      <label>
        <span className="app-label">O que voce quer registrar</span>
        <textarea
          className="app-input"
          rows={2}
          placeholder='Ex.: "entrada de 12 cerveja lata" ou "perdi 2 vinho tinto"'
          value={textoComando}
          onChange={(e) => setTextoComando(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="app-btn-outline"
        onClick={() => interpretar(textoComando)}
        disabled={textoComando.trim().length === 0}
      >
        Interpretar
      </button>

      {mostrarConfirmacao && (
        <div className="app-card" style={{ background: 'var(--bg)' }}>
          <p className="app-label" style={{ marginTop: 0 }}>
            Confirme antes de gravar
          </p>

          <div className="app-toggle-grupo">
            <button
              type="button"
              className="app-toggle"
              aria-pressed={tipoMovimento === 'entrada'}
              onClick={() => setTipoMovimento('entrada')}
            >
              Entrada
            </button>
            <button
              type="button"
              className="app-toggle"
              aria-pressed={tipoMovimento === 'perda'}
              onClick={() => setTipoMovimento('perda')}
            >
              Perda
            </button>
            <button
              type="button"
              className="app-toggle"
              aria-pressed={tipoMovimento === 'ajuste'}
              onClick={() => setTipoMovimento('ajuste')}
            >
              Ajuste
            </button>
          </div>

          <div className="app-grid-2" style={{ marginTop: 10 }}>
            <label>
              <span className="app-label">Quantidade</span>
              <input
                type="text"
                inputMode="decimal"
                className="app-input"
                value={quantidadeTexto}
                onChange={(e) => setQuantidadeTexto(e.target.value)}
              />
            </label>
            {tipoMovimento === 'ajuste' && (
              <label>
                <span className="app-label">Sinal</span>
                <div className="app-pill-group">
                  <button
                    type="button"
                    className="app-pill-btn"
                    aria-pressed={sinalAjuste === '+'}
                    onClick={() => setSinalAjuste('+')}
                  >
                    + (subir)
                  </button>
                  <button
                    type="button"
                    className="app-pill-btn"
                    aria-pressed={sinalAjuste === '-'}
                    onClick={() => setSinalAjuste('-')}
                  >
                    - (baixar)
                  </button>
                </div>
              </label>
            )}
          </div>

          <label style={{ display: 'block', marginTop: 10 }}>
            <span className="app-label">Produto</span>
            <input
              type="text"
              className="app-input"
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Digite pra buscar (minimo 2 letras)"
            />
          </label>

          {buscando && <p style={{ color: 'var(--text-muted)' }}>Buscando...</p>}

          {resultados.length > 0 && (
            <div className="app-pill-group" style={{ marginTop: 8 }}>
              {resultados.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="app-pill-btn"
                  aria-pressed={produtoId === p.id}
                  onClick={() => setProdutoId(p.id)}
                >
                  {p.descricao}
                  <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.8 }}>
                    Estoque: {formatarEstoque(p.estoqueAtual)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {termoBusca.trim().length >= 2 && !buscando && resultados.length === 0 && (
            <p className="app-msg-erro">Nenhum produto encontrado com esse nome.</p>
          )}

          {produtoSelecionado && (
            <p style={{ marginTop: 12, fontSize: '1.1em' }}>
              <strong>{produtoSelecionado.descricao}</strong>
              <br />
              Estoque atual: <strong>{formatarEstoque(produtoSelecionado.estoqueAtual)}</strong>
            </p>
          )}

          {produtoSelecionado && quantidadeValida && (
            <p className="app-aviso" style={{ marginTop: 12 }}>
              Vai gravar: <strong>{tipoMovimento}</strong> de{' '}
              <strong>
                {quantidadeNumero}
                {tipoMovimento === 'ajuste' ? ` (${sinalAjuste})` : ''}
              </strong>{' '}
              em <strong>{produtoSelecionado.descricao}</strong>.
            </p>
          )}

          <button
            type="button"
            className="app-btn app-btn-grande"
            style={{ marginTop: 12 }}
            disabled={!produtoSelecionado || !quantidadeValida || enviando}
            onClick={() => void confirmar()}
          >
            {enviando ? 'Gravando...' : 'Confirmar e gravar'}
          </button>
        </div>
      )}

      {erro && <p className="app-msg-erro">{erro}</p>}
      {mensagemOk && <p className="app-msg-ok">{mensagemOk}</p>}
    </div>
  )
}
