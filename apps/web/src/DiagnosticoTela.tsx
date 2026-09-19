import { DADOS_RECIBO_DIAGNOSTICO, gerarComandosEscPos, gerarLinhasRecibo } from '@adega/core'
import { useEffect, useRef, useState } from 'react'
import logoAdega from './assets/logo-adega-dois-irmaos.jpg?inline'

/**
 * Pagina de diagnostico de hardware (pedido do cliente, fora dos 10 PASSOs
 * da missao ponta-a-ponta): pistola de codigo de barras, impressora termica
 * e maquininha Itau/Rede. Publica, SEM login -- precisa funcionar antes de
 * qualquer operador logar ou qualquer venda real existir.
 *
 * Pedido do dia seguinte (ainda do cliente, via Torre): uma versao "bonita",
 * com a marca da loja, pra jogar direto no servidor e o Leandro abrir no
 * Chrome e reconhecer o que esta testando. A logica de cada teste e a MESMA
 * da versao anterior -- so a camada visual mudou (tema escuro/dourado com a
 * logo real da ADEGA DOIS IRMAOS, resumo de status no topo, detalhes
 * tecnicos escondidos atras de <details> em vez de expostos direto).
 *
 * Pedido seguinte (ainda do cliente): uma versao que rode sem NENHUM acesso
 * a configuracao de servidor -- so soltar arquivos por FTP e abrir no
 * Chrome. Por isso o recibo de teste (antes buscado da API local) agora e
 * gerado direto aqui no navegador, com os MESMOS geradores puros de
 * `@adega/core` que a API usa (`packages/core/src/recibo-diagnostico.ts` e
 * a fonte unica dos dados) -- e a logo vem embutida no proprio JS
 * (`?inline`), nao como arquivo separado. Isso faz esta pagina funcionar
 * tanto rodando o sistema completo no PC da loja quanto como um build
 * estatico solto num servidor sem Node/pnpm.
 *
 * Especificacoes vieram da Torre (ESPECIFICACOES DE HARDWARE -- RESPOSTA DA
 * TORRE) e de fotos reais do hardware da loja enviadas pelo cliente em
 * 10/09/2026. Onde algo ainda nao foi confirmado -- nem pela Torre, nem
 * pelas fotos -- esta pagina NAO assume um valor.
 */

/** Base64 sem depender de `Buffer` (nao existe no navegador). Os bytes do
 * ESC/POS sao sempre 0-255, entao `String.fromCharCode` + `btoa` (latin1)
 * e seguro aqui -- o recibo de teste e curto, sem risco do limite de
 * argumentos do spread. */
function bytesParaBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

const RECIBO_DIAGNOSTICO = (() => {
  const linhas = gerarLinhasRecibo(DADOS_RECIBO_DIAGNOSTICO)
  const bytes = gerarComandosEscPos(linhas)
  return { linhas, escPosBase64: bytesParaBase64(bytes) }
})()

/** Pra onde o botao "Enviar por e-mail" do resumo final (secao 4) manda o
 * relatorio pronto -- pedido explicito, pra quem esta testando nao
 * precisar escolher destinatario nenhum. */
const EMAIL_DESTINO_RESUMO = 'eduardo@impsys.com.br'

const STATUS_HARDWARE = {
  leitor: {
    modelo: 'Durawell SC-2013 (laser, confirmado por foto da etiqueta)',
    modo: 'USB HID (teclado)',
    sufixoTerminacao: 'DESCOBRIR_NO_TESTE',
  },
  impressora: {
    modelo: 'Waytec WP-50',
    papel: '58mm (confirmado na etiqueta)',
    conexao: 'USB (confirmado na etiqueta e no cabo fotografado)',
    comandos: 'ESC/POS (confirmado na etiqueta: "Comandos Compatível ESC/POS")',
    driverWindows: 'DESCOBRIR_NO_TESTE',
    codepage: 'DESCOBRIR_NO_TESTE',
  },
  maquininha: {
    modoAtual: 'AUTONOMA (sem integracao com o sistema)',
    adapterFase1: 'ManualAdapter',
    tefSdkFuturo: 'NAO_DEFINIDO',
  },
} as const

// ---------------------------------------------------------------------
// Tema visual (escuro + dourado, seguindo a logo da loja). Um unico bloco
// de CSS "de verdade" em vez de style inline gigante -- mais facil de ler
// e permite hover/responsivo, que inline puro nao da de forma limpa.
// ---------------------------------------------------------------------

const ESTILOS = `
.diag { --bg: #0b0a08; --bg-card: #17130d; --bg-card-alt: #1f1a11; --border: #362a17;
  --gold: #f2b705; --gold-dark: #caa008; --red: #e0503d; --green: #34c759;
  --text: #f6f1e4; --text-muted: #a89f8c;
  background: var(--bg); color: var(--text); min-height: 100vh;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
.diag * { box-sizing: border-box; }
.diag a { color: var(--gold); }
.diag-hero { display: flex; align-items: center; gap: 20px; padding: 28px 20px;
  background: linear-gradient(180deg, #141009 0%, #0b0a08 100%); border-bottom: 1px solid var(--border); }
.diag-logo { width: 84px; height: 84px; border-radius: 14px; box-shadow: 0 0 0 3px var(--gold), 0 8px 24px rgba(0,0,0,.5);
  flex-shrink: 0; }
.diag-eyebrow { margin: 0; font-size: .78rem; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); font-weight: 700; }
.diag-hero h1 { margin: 2px 0 6px; font-size: 1.6rem; }
.diag-hero p.diag-sub { margin: 0; color: var(--text-muted); font-size: .92rem; max-width: 52ch; }
.diag-wrap { max-width: 760px; margin: 0 auto; padding: 0 16px 48px; }
.diag-resumo { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
.diag-chip { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--bg-card);
  border-radius: 999px; padding: 8px 14px; font-size: .85rem; }
.diag-chip-dot { width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; }
.diag-chip-status { font-weight: 700; text-transform: uppercase; font-size: .72rem; letter-spacing: .04em; }
.diag-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 20px 22px; margin-top: 18px; }
.diag-card h2 { margin: 0 0 4px; font-size: 1.15rem; display: flex; align-items: center; gap: 10px; }
.diag-num { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border-radius: 999px; background: var(--gold); color: #1a1400; font-weight: 800; font-size: .85rem; flex-shrink: 0; }
.diag-card .diag-icon { width: 20px; height: 20px; color: var(--gold); flex-shrink: 0; }
.diag-card > p.diag-desc { margin: 4px 0 16px; color: var(--text-muted); font-size: .92rem; }
.diag-sub-titulo { font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--gold-dark);
  margin: 18px 0 6px; }
.diag-input { display: block; width: 100%; font-size: 1.05rem; padding: 10px 12px; margin-top: 4px;
  background: var(--bg-card-alt); border: 1px solid var(--border); border-radius: 8px; color: var(--text); }
.diag-input:focus { outline: none; border-color: var(--gold); }
.diag-btn { appearance: none; border: none; border-radius: 8px; padding: 10px 16px; font-weight: 700; font-size: .9rem;
  cursor: pointer; background: var(--gold); color: #1a1400; }
.diag-btn:hover:not(:disabled) { background: #ffd23f; }
.diag-btn:disabled { opacity: .55; cursor: default; }
.diag-btn-outline { appearance: none; border: 1px solid var(--gold-dark); border-radius: 8px; padding: 9px 15px; font-weight: 600;
  font-size: .85rem; cursor: pointer; background: transparent; color: var(--gold); }
.diag-btn-outline:hover { background: var(--gold); color: #1a1400; }
.diag-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: .8rem;
  font-weight: 700; }
.diag-pill-ok { background: rgba(52,199,89,.15); color: var(--green); }
.diag-pill-bad { background: rgba(224,80,61,.18); color: var(--red); }
.diag-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: .85rem; }
.diag-table th { text-align: left; padding: 6px 8px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
.diag-table td { padding: 8px; border-bottom: 1px solid var(--border); }
.diag-table tr:last-child td { border-bottom: none; }
.diag-code { font-family: ui-monospace, monospace; background: var(--bg-card-alt); padding: 2px 6px; border-radius: 4px; }
.diag-pre { font-family: ui-monospace, monospace; background: var(--bg-card-alt); padding: 14px; border-radius: 8px;
  white-space: pre-wrap; font-size: .82rem; line-height: 1.4; border: 1px solid var(--border); color: #dcd4bf; }
.diag-checklist { list-style: none; padding: 0; margin: 6px 0 0; display: grid; gap: 8px; }
.diag-check-item { display: flex; align-items: center; gap: 10px; background: var(--bg-card-alt); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 12px; }
.diag-check-item input { width: 18px; height: 18px; accent-color: var(--gold); }
.diag-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .76rem; font-family: ui-monospace, monospace;
  margin: 2px 6px 2px 0; }
.diag-badge-ok { background: rgba(52,199,89,.15); color: var(--green); }
.diag-badge-pendente { background: rgba(242,183,5,.15); color: var(--gold); }
.diag-details { margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 10px; }
.diag-details summary { cursor: pointer; color: var(--text-muted); font-size: .82rem; font-weight: 600; }
.diag-details summary:hover { color: var(--gold); }
.diag-details-body { margin-top: 10px; line-height: 1.7; }
.diag-footer { text-align: center; color: var(--text-muted); font-size: .8rem; padding: 24px 16px 40px; }
@media (max-width: 480px) {
  .diag-hero { flex-direction: column; text-align: center; padding: 24px 16px; }
  .diag-hero p.diag-sub { max-width: none; }
}
`

type StatusSecao = 'pendente' | 'ok' | 'atencao'

function corStatus(status: StatusSecao): string {
  if (status === 'ok') return 'var(--green)'
  if (status === 'atencao') return 'var(--red)'
  return 'var(--text-muted)'
}

function textoStatus(status: StatusSecao): string {
  if (status === 'ok') return 'confirmado'
  if (status === 'atencao') return 'atenção'
  return 'pendente'
}

function ChipResumo({ label, status }: { readonly label: string; readonly status: StatusSecao }) {
  const cor = corStatus(status)
  return (
    <div className="diag-chip" style={{ borderColor: status === 'pendente' ? undefined : cor }}>
      <span className="diag-chip-dot" style={{ background: cor }} />
      <span>{label}</span>
      <span className="diag-chip-status" style={{ color: cor }}>
        {textoStatus(status)}
      </span>
    </div>
  )
}

function Badge({ children }: { readonly children: string }) {
  const pendente = children.includes('DESCOBRIR') || children.includes('NAO_DEFINIDO')
  return (
    <span className={pendente ? 'diag-badge diag-badge-pendente' : 'diag-badge diag-badge-ok'}>
      {children}
    </span>
  )
}

function IconeBarras() {
  return (
    <svg className="diag-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="2" y="4" width="2" height="16" />
      <rect x="6" y="4" width="1" height="16" />
      <rect x="9" y="4" width="3" height="16" />
      <rect x="14" y="4" width="1" height="16" />
      <rect x="17" y="4" width="2" height="16" />
      <rect x="21" y="4" width="1" height="16" />
    </svg>
  )
}

function IconeImpressora() {
  return (
    <svg
      className="diag-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9V3h12v6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="9" width="16" height="8" rx="1.5" />
      <path d="M6 15h12v6H6z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconeCartao() {
  return (
    <svg
      className="diag-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" strokeLinecap="round" />
      <path d="M6 15h4" strokeLinecap="round" />
    </svg>
  )
}

function Secao({
  numero,
  icone,
  titulo,
  descricao,
  children,
}: {
  readonly numero: number
  readonly icone: React.ReactNode
  readonly titulo: string
  readonly descricao: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="diag-card">
      <h2>
        <span className="diag-num">{numero}</span>
        {icone}
        {titulo}
      </h2>
      <p className="diag-desc">{descricao}</p>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------
// Leitor de codigo de barras (pistola) -- DIAGNOSTICO_HID
// ---------------------------------------------------------------------

type Terminador = 'Enter' | 'Tab' | 'Nenhuma (tempo esgotado)'
type Classificacao = 'provavel pistola (HID)' | 'provavel digitacao manual' | 'indeterminado'

interface LeituraRegistrada {
  readonly codigo: string
  readonly terminador: Terminador
  readonly quantidadeCaracteres: number
  readonly duracaoMs: number
  readonly intervaloMedioMs: number | null
  readonly classificacao: Classificacao
  readonly horario: string
}

const LIMIAR_PISTOLA_MS = 30
const LIMIAR_MANUAL_MS = 150
const TIMEOUT_INATIVIDADE_MS = 1200

function classificar(intervaloMedioMs: number | null): Classificacao {
  if (intervaloMedioMs === null) return 'indeterminado'
  if (intervaloMedioMs <= LIMIAR_PISTOLA_MS) return 'provavel pistola (HID)'
  if (intervaloMedioMs >= LIMIAR_MANUAL_MS) return 'provavel digitacao manual'
  return 'indeterminado'
}

function SecaoLeitor({
  onAtualizar,
}: {
  readonly onAtualizar: (s: StatusSecao, detalhe: string) => void
}) {
  const [valor, setValor] = useState('')
  const [leituras, setLeituras] = useState<LeituraRegistrada[]>([])
  const timestampsRef = useRef<number[]>([])
  const timeoutRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  // Alimenta o resumo final (secao 4) com a leitura mais recente -- e o que
  // permite copiar/mandar um relatorio de verdade no final, em vez de o
  // Leandro precisar descrever isso de memoria.
  useEffect(() => {
    if (leituras.length === 0) return
    const ultima = leituras[0]!
    onAtualizar(
      'ok',
      `${leituras.length} leitura(s) registrada(s). Última: código "${ultima.codigo}" ` +
        `(${ultima.quantidadeCaracteres} caract.), terminador ${ultima.terminador}, ` +
        `classificação ${ultima.classificacao}.`,
    )
  }, [leituras])

  function limparTimeout() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  function finalizar(terminador: Terminador) {
    limparTimeout()
    const codigo = inputRef.current?.value ?? ''
    const marcas = timestampsRef.current
    timestampsRef.current = []
    if (!codigo) return

    const duracaoMs = marcas.length >= 2 ? marcas[marcas.length - 1]! - marcas[0]! : 0
    const intervaloMedioMs = marcas.length >= 2 ? duracaoMs / (marcas.length - 1) : null

    setLeituras((atual) => [
      {
        codigo,
        terminador,
        quantidadeCaracteres: codigo.length,
        duracaoMs: Math.round(duracaoMs),
        intervaloMedioMs: intervaloMedioMs === null ? null : Math.round(intervaloMedioMs * 10) / 10,
        classificacao: classificar(intervaloMedioMs),
        horario: new Date().toLocaleTimeString('pt-BR'),
      },
      ...atual,
    ])
    setValor('')
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter' || evento.key === 'Tab') {
      evento.preventDefault()
      finalizar(evento.key === 'Enter' ? 'Enter' : 'Tab')
      return
    }
    timestampsRef.current.push(performance.now())
    limparTimeout()
    timeoutRef.current = window.setTimeout(
      () => finalizar('Nenhuma (tempo esgotado)'),
      TIMEOUT_INATIVIDADE_MS,
    )
  }

  return (
    <Secao
      numero={1}
      icone={<IconeBarras />}
      titulo="Leitor de código de barras (pistola)"
      descricao="Clique no campo abaixo e dispare a pistola em qualquer produto. Se preferir, digite o código na mão e aperte Enter."
    >
      <input
        ref={inputRef}
        type="text"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={aoTeclar}
        placeholder="Aguardando leitura..."
        className="diag-input"
      />

      {leituras.length > 0 && (
        <table className="diag-table">
          <thead>
            <tr>
              <th>Horário</th>
              <th>Código lido</th>
              <th>Caracteres</th>
              <th>Duração</th>
              <th>Intervalo médio</th>
              <th>Terminador</th>
              <th>Classificação</th>
            </tr>
          </thead>
          <tbody>
            {leituras.map((l, i) => (
              <tr key={i}>
                <td>{l.horario}</td>
                <td>
                  <span className="diag-code">{l.codigo}</span>
                </td>
                <td>{l.quantidadeCaracteres}</td>
                <td>{l.duracaoMs} ms</td>
                <td>{l.intervaloMedioMs === null ? '—' : `${l.intervaloMedioMs} ms`}</td>
                <td>{l.terminador}</td>
                <td>{l.classificacao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="diag-details">
        <summary>Detalhes técnicos</summary>
        <div className="diag-details-body">
          Modelo: <Badge>{STATUS_HARDWARE.leitor.modelo}</Badge>
          <br />
          Modo assumido pela arquitetura: <strong>{STATUS_HARDWARE.leitor.modo}</strong>. Sufixo de
          término: <Badge>{STATUS_HARDWARE.leitor.sufixoTerminacao}</Badge>
          <p style={{ margin: '8px 0 0', fontSize: '.85rem' }}>
            Este teste <strong>não assume Enter</strong>: aceita Enter, Tab, ou nenhuma tecla (se a
            leitura parar de chegar por 1,2s, é finalizada mesmo assim). A classificação é uma
            estimativa por velocidade de digitação (≤{LIMIAR_PISTOLA_MS}ms entre teclas ≈ pistola; ≥
            {LIMIAR_MANUAL_MS}ms ≈ manual) — não é uma confirmação de hardware, só uma pista visual.
          </p>
        </div>
      </details>
    </Secao>
  )
}

// ---------------------------------------------------------------------
// Impressora -- A: driver Windows, B: bridge ESC/POS, C: teste de caracteres
// ---------------------------------------------------------------------

type ResultadoTeste = 'nao-testado' | 'funcionou' | 'nao-funcionou'

function BotaoResultado({
  resultado,
  onMudar,
}: {
  readonly resultado: ResultadoTeste
  readonly onMudar: (r: ResultadoTeste) => void
}) {
  return (
    <div
      style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}
    >
      <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Funcionou?</span>
      <button type="button" className="diag-btn-outline" onClick={() => onMudar('funcionou')}>
        Sim
      </button>
      <button type="button" className="diag-btn-outline" onClick={() => onMudar('nao-funcionou')}>
        Não
      </button>
      {resultado !== 'nao-testado' && (
        <span
          className={
            resultado === 'funcionou' ? 'diag-pill diag-pill-ok' : 'diag-pill diag-pill-bad'
          }
        >
          {resultado === 'funcionou' ? 'Confirmado OK' : 'Confirmado FALHOU'}
        </span>
      )}
    </div>
  )
}

function SecaoImpressora({
  onAtualizar,
}: {
  readonly onAtualizar: (s: StatusSecao, detalhe: string) => void
}) {
  const recibo = RECIBO_DIAGNOSTICO
  const [resultadoDriver, setResultadoDriver] = useState<ResultadoTeste>('nao-testado')
  const [resultadoBridge, setResultadoBridge] = useState<ResultadoTeste>('nao-testado')
  const [statusBridge, setStatusBridge] = useState<string | null>(null)
  const [testandoBridge, setTestandoBridge] = useState(false)

  useEffect(() => {
    const detalhe =
      `Teste A (driver Windows): ${resultadoDriver}. ` +
      `Teste B (bridge): ${resultadoBridge}${statusBridge ? ` — ${statusBridge}` : ''}.`
    if (resultadoDriver === 'funcionou' || resultadoBridge === 'funcionou') {
      onAtualizar('ok', detalhe)
    } else if (resultadoDriver === 'nao-funcionou' && resultadoBridge === 'nao-funcionou') {
      onAtualizar('atencao', detalhe)
    } else {
      onAtualizar('pendente', detalhe)
    }
  }, [resultadoDriver, resultadoBridge, statusBridge])

  async function testarBridge() {
    setTestandoBridge(true)
    setStatusBridge(null)
    try {
      const res = await fetch('http://localhost:9100/health', { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const corpo = (await res.json()) as { status?: string; versao?: string }
      setStatusBridge(
        `Bridge alcançável — status: ${corpo.status ?? '?'}, versão: ${corpo.versao ?? '?'}`,
      )
    } catch (e) {
      setStatusBridge(
        `Bridge NÃO alcançável (${e instanceof Error ? e.message : 'erro desconhecido'}). ` +
          'Isso é esperado se o bridge não estiver rodando nesta máquina, ou se o navegador bloqueou a rede privada.',
      )
    } finally {
      setTestandoBridge(false)
    }
  }

  return (
    <Secao
      numero={2}
      icone={<IconeImpressora />}
      titulo="Impressora térmica"
      descricao="Vamos tentar imprimir o comprovante de teste de duas formas diferentes — veja qual funciona na Waytec WP-50."
    >
      <p className="diag-sub-titulo">Prévia do comprovante (com teste de acentuação)</p>
      <pre className="diag-pre">{recibo.linhas.join('\n')}</pre>
      <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
        Confira, em qualquer impressão abaixo, se os acentos e o "R$" saíram certos ou viraram
        "?"/caixas — isso decide a página de código real da impressora.
      </p>

      <p className="diag-sub-titulo">Teste A — via driver do Windows</p>
      <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
        Se a WP-50 estiver instalada como impressora do Windows, ela aparece como opção no diálogo
        de impressão que vai abrir.
      </p>
      <button type="button" className="diag-btn" onClick={() => window.print()}>
        Imprimir recibo de teste
      </button>
      <BotaoResultado resultado={resultadoDriver} onMudar={setResultadoDriver} />

      <p className="diag-sub-titulo">Teste B — bridge / ESC-POS</p>
      <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
        Verifica se o programa auxiliar do sistema (bridge) está rodando nesta máquina. O envio
        direto de comandos para a impressora por aqui ainda não foi ligado — os bytes ficam
        disponíveis para copiar e testar manualmente, se precisar.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="diag-btn-outline"
          onClick={() => void testarBridge()}
          disabled={testandoBridge}
        >
          {testandoBridge ? 'Testando...' : 'Testar conexão com o bridge'}
        </button>
        <button
          type="button"
          className="diag-btn-outline"
          onClick={() => void navigator.clipboard?.writeText(recibo.escPosBase64)}
        >
          Copiar bytes ESC/POS
        </button>
      </div>
      {statusBridge && (
        <p style={{ marginTop: 8, fontSize: '.85rem', color: 'var(--text-muted)' }}>
          {statusBridge}
        </p>
      )}
      <BotaoResultado resultado={resultadoBridge} onMudar={setResultadoBridge} />

      <details className="diag-details">
        <summary>Detalhes técnicos</summary>
        <div className="diag-details-body">
          Modelo: <Badge>{STATUS_HARDWARE.impressora.modelo}</Badge> Papel:{' '}
          <Badge>{STATUS_HARDWARE.impressora.papel}</Badge>
          <br />
          Conexão: <Badge>{STATUS_HARDWARE.impressora.conexao}</Badge>
          <br />
          Comandos: <Badge>{STATUS_HARDWARE.impressora.comandos}</Badge>
          <br />
          Driver Windows: <Badge>{STATUS_HARDWARE.impressora.driverWindows}</Badge> Página de
          código: <Badge>{STATUS_HARDWARE.impressora.codepage}</Badge>
        </div>
      </details>
    </Secao>
  )
}

// ---------------------------------------------------------------------
// Maquininha Itau / Rede -- MAQUININHA_AUTONOMA (sem comunicacao com o
// sistema; so um checklist manual, como a Torre determinou)
// ---------------------------------------------------------------------

const PASSOS_MAQUININHA = [
  'Ligar a maquininha',
  'Verificar conectividade da maquininha (rede/celular/Wi-Fi, conforme o modelo)',
  'Realizar uma operação de teste na própria maquininha, quando aplicável',
  'Confirmar que a maquininha, sozinha, aprova e imprime o comprovante dela',
] as const

function SecaoMaquininha({
  onAtualizar,
}: {
  readonly onAtualizar: (s: StatusSecao, detalhe: string) => void
}) {
  const [feitos, setFeitos] = useState<boolean[]>(() => PASSOS_MAQUININHA.map(() => false))

  function alternar(indice: number) {
    setFeitos((atual) => atual.map((v, i) => (i === indice ? !v : v)))
  }

  const todosFeitos = feitos.every(Boolean)

  useEffect(() => {
    const quantidadeFeitos = feitos.filter(Boolean).length
    const detalhe =
      `${quantidadeFeitos}/${PASSOS_MAQUININHA.length} passos confirmados.` +
      (todosFeitos ? ' Maquininha confirmada funcionando de forma autônoma.' : '')
    onAtualizar(todosFeitos ? 'ok' : 'pendente', detalhe)
  }, [feitos, todosFeitos])

  return (
    <Secao
      numero={3}
      icone={<IconeCartao />}
      titulo="Maquininha Itaú / Rede"
      descricao="Este teste é manual: a página não se comunica com a maquininha. Vá fazendo os passos abaixo direto nela e marcando aqui."
    >
      <ul className="diag-checklist">
        {PASSOS_MAQUININHA.map((passo, i) => (
          <li key={passo} className="diag-check-item">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <input type="checkbox" checked={feitos[i]} onChange={() => alternar(i)} /> {passo}
            </label>
          </li>
        ))}
      </ul>
      {todosFeitos && (
        <p style={{ color: 'var(--green)', fontWeight: 700, marginTop: 12 }}>
          Maquininha confirmada funcionando de forma autônoma.
        </p>
      )}

      <details className="diag-details">
        <summary>Detalhes técnicos</summary>
        <div className="diag-details-body">
          Modo atual: <Badge>{STATUS_HARDWARE.maquininha.modoAtual}</Badge>
          <br />
          Adapter da Fase 1: <Badge>{STATUS_HARDWARE.maquininha.adapterFase1}</Badge>
          <br />
          Integração TEF/SDK futura: <Badge>{STATUS_HARDWARE.maquininha.tefSdkFuturo}</Badge>
          <p style={{ margin: '8px 0 0', fontSize: '.85rem' }}>
            Não existe comunicação entre esta página (ou o sistema) e a maquininha. O pagamento é
            feito nela separadamente; o operador só informa ao sistema qual forma foi usada — o
            sistema nunca recebe nem finge receber aprovação automática da adquirente.
          </p>
        </div>
      </details>
    </Secao>
  )
}

// ---------------------------------------------------------------------

export function DiagnosticoTela() {
  const [statusLeitor, setStatusLeitor] = useState<StatusSecao>('pendente')
  const [detalheLeitor, setDetalheLeitor] = useState('Nenhuma leitura registrada ainda.')
  const [statusImpressora, setStatusImpressora] = useState<StatusSecao>('pendente')
  const [detalheImpressora, setDetalheImpressora] = useState('Nenhum teste realizado ainda.')
  const [statusMaquininha, setStatusMaquininha] = useState<StatusSecao>('pendente')
  const [detalheMaquininha, setDetalheMaquininha] = useState(
    `0/${PASSOS_MAQUININHA.length} passos confirmados.`,
  )
  const [resumoCopiado, setResumoCopiado] = useState(false)

  useEffect(() => {
    document.title = 'Diagnóstico de Hardware — Adega Dois Irmãos'
  }, [])

  function atualizarLeitor(status: StatusSecao, detalhe: string) {
    setStatusLeitor(status)
    setDetalheLeitor(detalhe)
  }

  function atualizarImpressora(status: StatusSecao, detalhe: string) {
    setStatusImpressora(status)
    setDetalheImpressora(detalhe)
  }

  function atualizarMaquininha(status: StatusSecao, detalhe: string) {
    setStatusMaquininha(status)
    setDetalheMaquininha(detalhe)
  }

  /**
   * A pagina nao tem backend nenhum (ver comentario no topo do arquivo) --
   * entao "mandar o resultado" nao pode ser um envio automatico pra algum
   * servidor nosso. O que da pra fazer sem servidor nenhum: montar um
   * resumo de texto com tudo que foi observado e deixar um clique pra
   * copiar ou mandar direto por WhatsApp. Isso e o que fecha o loop:
   * "o cliente testa -> a pagina gera um resumo -> ele manda pra gente",
   * em vez de precisar descrever de memoria o que aconteceu.
   */
  function montarResumo(): string {
    const geradoEm = new Date().toLocaleString('pt-BR')
    return [
      'RESUMO — Diagnóstico de Hardware (Adega Dois Irmãos)',
      `Gerado em: ${geradoEm}`,
      '',
      `[${textoStatus(statusLeitor).toUpperCase()}] Leitor de código de barras — ${detalheLeitor}`,
      `[${textoStatus(statusImpressora).toUpperCase()}] Impressora térmica — ${detalheImpressora}`,
      `[${textoStatus(statusMaquininha).toUpperCase()}] Maquininha Itaú/Rede — ${detalheMaquininha}`,
    ].join('\n')
  }

  async function copiarResumo() {
    await navigator.clipboard?.writeText(montarResumo())
    setResumoCopiado(true)
    window.setTimeout(() => setResumoCopiado(false), 2000)
  }

  /** Link `mailto:` ja endereçado, pra quem esta testando so precisar
   * clicar -- sem precisar saber pra quem mandar nem copiar/colar nada. */
  function linkEmailResumo(): string {
    const assunto = 'Diagnóstico de Hardware — Adega Dois Irmãos'
    return (
      `mailto:${EMAIL_DESTINO_RESUMO}` +
      `?subject=${encodeURIComponent(assunto)}` +
      `&body=${encodeURIComponent(montarResumo())}`
    )
  }

  return (
    <div className="diag">
      <style>{ESTILOS}</style>

      <header className="diag-hero">
        <img src={logoAdega} alt="Adega Dois Irmãos" className="diag-logo" />
        <div>
          <p className="diag-eyebrow">Sistema da Adega</p>
          <h1>Diagnóstico de Hardware</h1>
          <p className="diag-sub">
            Página de teste da Adega Dois Irmãos: confira a pistola, a impressora e a maquininha
            antes de começarmos a usar o sistema de verdade. Nada aqui gera venda real.
          </p>
        </div>
      </header>

      <div className="diag-wrap">
        <div className="diag-resumo">
          <ChipResumo label="Leitor" status={statusLeitor} />
          <ChipResumo label="Impressora" status={statusImpressora} />
          <ChipResumo label="Maquininha" status={statusMaquininha} />
        </div>

        <SecaoLeitor onAtualizar={atualizarLeitor} />
        <SecaoImpressora onAtualizar={atualizarImpressora} />
        <SecaoMaquininha onAtualizar={atualizarMaquininha} />

        <section className="diag-card">
          <h2>
            <span className="diag-num">4</span>
            Resumo final
          </h2>
          <p className="diag-desc">
            Depois de testar tudo acima, copie este resumo ou mande direto por WhatsApp ou e-mail
            pra quem está acompanhando o diagnóstico — sem precisar descrever de memória o que
            aconteceu.
          </p>
          <pre className="diag-pre">{montarResumo()}</pre>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" className="diag-btn" onClick={() => void copiarResumo()}>
              {resumoCopiado ? 'Copiado!' : 'Copiar resumo'}
            </button>
            <a
              className="diag-btn-outline"
              href={`https://wa.me/?text=${encodeURIComponent(montarResumo())}`}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              Enviar por WhatsApp
            </a>
            <a
              className="diag-btn-outline"
              href={linkEmailResumo()}
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              Enviar por e-mail
            </a>
          </div>
        </section>

        <p className="diag-footer">
          Sistema da Adega — ambiente de diagnóstico, sem valor fiscal, sem venda real.
        </p>
      </div>
    </div>
  )
}
