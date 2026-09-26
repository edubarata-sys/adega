import { centavos, formatarBRL } from '@adega/core'
import { useEffect, useMemo, useState } from 'react'
import logoAdega from './assets/logo-adega-dois-irmaos.jpg'
import { buscarFotoProduto, eanPodeTerFoto } from './fotoProduto'

/**
 * Loja online da Adega Dois Irmaos (pedido do cliente 25/09).
 * Vitrine publica em /loja: o cliente monta o carrinho e o pedido e enviado
 * pelo WhatsApp da loja (sem pagamento online por enquanto). Retirada na loja
 * ou entrega por Uber Flash / 99 Entrega, com a corrida paga a parte.
 */

// ---------------- configuracao da loja ----------------
const WHATSAPP = '5512996859407'
const WHATSAPP_EXIBICAO = '(12) 99685-9407'
const ENDERECO = 'Rua Euclides Ribeiro, 21 - Residencial San Marino, Taubaté/SP'
/** [abre, fecha] em minutos desde 00:00, por dia da semana (0 = domingo). null = fechado. */
const HORARIOS: readonly ([number, number] | null)[] = [
  [10 * 60, 22 * 60 + 30], // domingo 10:00-22:30
  null, // segunda fechado
  [13 * 60, 23 * 60], // terca 13:00-23:00
  [10 * 60 + 30, 23 * 60], // quarta 10:30-23:00
  [10 * 60 + 30, 23 * 60], // quinta 10:30-23:00
  [0, 24 * 60], // sexta (no WhatsApp: 00:00-00:00 -- CONFIRMAR)
  [0, 24 * 60], // sabado (no WhatsApp: 00:00-00:00 -- CONFIRMAR)
]
const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const CHAVE_IDADE = 'adega-loja-18'
const CHAVE_CARRINHO = 'adega-loja-carrinho'

interface ProdutoLoja {
  readonly id: string
  readonly ean: string | null
  readonly nome: string
  /** Centavos. */
  readonly preco: number
  readonly categoria: string
  readonly emEstoque: boolean
}

const ORDEM_CATEGORIAS = [
  'Espetinhos',
  'Cervejas',
  'Destilados',
  'Drinks e ices',
  'Energéticos',
  'Vinhos e espumantes',
  'Refrigerantes, água e sucos',
  'Gelo',
  'Petiscos, doces e outros',
]

const ICONE_CATEGORIA: Record<string, string> = {
  Espetinhos: '🍢',
  Cervejas: '🍺',
  Destilados: '🥃',
  'Drinks e ices': '🍹',
  Energéticos: '⚡',
  'Vinhos e espumantes': '🍷',
  'Refrigerantes, água e sucos': '🥤',
  Gelo: '🧊',
  'Petiscos, doces e outros': '🍿',
}

const MINUSCULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'e',
  'ou',
  'sem',
  'no',
  'na',
  'em',
  'por',
  'a',
  'o',
])
const SIGLAS = new Set(['IPA', 'GLT', 'H2O', 'KS', 'LM', 'JC', 'TNT', 'XL', 'UN', 'BR', 'X'])

/** "BALY LATA TRADICIONAL 473 ML" -> "Baly Lata Tradicional 473 ml". */
function nomeBonito(nome: string): string {
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      const up = p.toUpperCase()
      if (SIGLAS.has(up)) return up
      if (/^\d/.test(p))
        return p.replace(
          /(\d)(ml|l|kg|g|lts?)$/i,
          (_m, d: string, u: string) => d + u.toLowerCase(),
        )
      if (/^(ml|l|kg|g|lts?|un|und)$/.test(p)) return p
      if (/^c\/\d+/.test(p)) return p.toUpperCase()
      if (i > 0 && MINUSCULAS.has(p)) return p
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join(' ')
}

const brl = (c: number) => formatarBRL(centavos(Math.round(c)))
const hm = (m: number) =>
  m >= 24 * 60
    ? '24:00'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function horaDaLoja(): { dia: number; minutos: number } {
  // Horario de Brasilia (UTC-3, sem horario de verao), independente do celular.
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return { dia: agora.getUTCDay(), minutos: agora.getUTCHours() * 60 + agora.getUTCMinutes() }
}

function statusLoja(): { aberta: boolean; texto: string } {
  const { dia, minutos } = horaDaLoja()
  const hoje = HORARIOS[dia]
  if (hoje && minutos >= hoje[0] && minutos < hoje[1])
    return {
      aberta: true,
      texto: hoje[1] >= 24 * 60 ? 'Aberto agora' : `Aberto até ${hm(hoje[1])}`,
    }
  for (let i = 0; i < 7; i++) {
    const d = (dia + i) % 7
    const h = HORARIOS[d]
    if (!h) continue
    if (i === 0 && minutos < h[0])
      return { aberta: false, texto: `Fechado · abre hoje às ${hm(h[0])}` }
    if (i > 0)
      return {
        aberta: false,
        texto: `Fechado · abre ${NOMES_DIA[d]!.toLowerCase()} às ${hm(h[0])}`,
      }
  }
  return { aberta: false, texto: 'Fechado' }
}

function lerJson<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave)
    return v ? (JSON.parse(v) as T) : padrao
  } catch {
    return padrao
  }
}
function gravarJson(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    // navegador sem armazenamento: segue sem lembrar
  }
}

function Foto({
  ean,
  nome,
  categoria,
}: {
  readonly ean: string | null
  readonly nome: string
  readonly categoria: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    if (eanPodeTerFoto(ean)) void buscarFotoProduto(ean).then((u) => vivo && setUrl(u))
    return () => {
      vivo = false
    }
  }, [ean])
  return (
    <div className="loja-foto">
      {url ? (
        <img src={url} alt={nome} loading="lazy" />
      ) : (
        <span className="loja-foto-vazia" aria-hidden="true">
          <span className="loja-foto-icone">{ICONE_CATEGORIA[categoria] ?? '🛒'}</span>
          <small>{categoria}</small>
        </span>
      )}
    </div>
  )
}

export function LojaTela() {
  const [maior, setMaior] = useState<boolean>(() => lerJson(CHAVE_IDADE, false))
  const [produtos, setProdutos] = useState<ProdutoLoja[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [categoriaAtiva, setCategoriaAtiva] = useState<string>('Todos')
  const [carrinho, setCarrinho] = useState<Record<string, number>>(() =>
    lerJson(CHAVE_CARRINHO, {}),
  )
  const [aberto, setAberto] = useState(false)
  const [modo, setModo] = useState<'retirada' | 'entrega'>('retirada')
  const [nome, setNome] = useState('')
  const [endereco, setEndereco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [pagamento, setPagamento] = useState('Pix')
  const [obs, setObs] = useState('')
  const [status, setStatus] = useState(statusLoja)

  useEffect(() => {
    const t = window.setInterval(() => setStatus(statusLoja()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    fetch('/api/loja/produtos')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { produtos: ProdutoLoja[] }) => setProdutos(j.produtos))
      .catch(() => setErro('Não foi possível carregar os produtos. Tente de novo em instantes.'))
  }, [])

  useEffect(() => gravarJson(CHAVE_CARRINHO, carrinho), [carrinho])

  const porId = useMemo(() => new Map((produtos ?? []).map((p) => [p.id, p])), [produtos])
  const categorias = useMemo(() => {
    const presentes = new Set((produtos ?? []).map((p) => p.categoria))
    return ['Todos', ...ORDEM_CATEGORIAS.filter((c) => presentes.has(c))]
  }, [produtos])

  const visiveis = useMemo(() => {
    const termo = busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
    return (produtos ?? []).filter((p) => {
      if (categoriaAtiva !== 'Todos' && p.categoria !== categoriaAtiva) return false
      if (!termo) return true
      const n = p.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      return termo.split(/\s+/).every((t) => n.includes(t))
    })
  }, [produtos, busca, categoriaAtiva])

  const itens = Object.entries(carrinho)
    .map(([id, q]) => ({ p: porId.get(id), q }))
    .filter((x): x is { p: ProdutoLoja; q: number } => Boolean(x.p) && x.q > 0)
  const totalItens = itens.reduce((s, x) => s + x.q, 0)
  const total = itens.reduce((s, x) => s + x.q * x.p.preco, 0)

  function mudar(id: string, delta: number) {
    setCarrinho((c) => {
      const q = Math.max(0, (c[id] ?? 0) + delta)
      const novo = { ...c }
      if (q === 0) delete novo[id]
      else novo[id] = q
      return novo
    })
  }

  const podeEnviar =
    itens.length > 0 &&
    nome.trim().length >= 2 &&
    (modo === 'retirada' || endereco.trim().length >= 5)

  function enviar() {
    if (!podeEnviar) return
    const linhas = [
      '*NOVO PEDIDO - SITE* 🛒',
      '',
      ...itens.map((x) => `• ${x.q}x ${nomeBonito(x.p.nome)} — ${brl(x.q * x.p.preco)}`),
      '',
      `*Total dos produtos: ${brl(total)}*`,
      '',
      `*Nome:* ${nome.trim()}`,
      modo === 'retirada'
        ? '*Retirada na loja* 🏪'
        : `*Entrega por Uber/99* 🛵 (valor da corrida a confirmar, pago junto com a compra)\n*Endereço:* ${endereco.trim()}${referencia.trim() ? `\n*Referência:* ${referencia.trim()}` : ''}`,
      `*Pagamento:* ${pagamento}`,
      ...(obs.trim() ? [`*Observação:* ${obs.trim()}`] : []),
    ]
    window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(linhas.join('\n'))}`, '_blank')
  }

  if (!maior) {
    return (
      <div className="app loja">
        <div className="loja-idade">
          <img src={logoAdega} alt="Adega Dois Irmãos" className="loja-logo-grande" />
          <h1>Adega Dois Irmãos</h1>
          <p>Este site vende bebidas alcoólicas.</p>
          <p>
            <strong>Você tem 18 anos ou mais?</strong>
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              className="app-btn app-btn-grande"
              onClick={() => {
                gravarJson(CHAVE_IDADE, true)
                setMaior(true)
              }}
            >
              Sim, tenho 18+
            </button>
            <button
              type="button"
              className="app-btn-outline"
              onClick={() => {
                window.location.href = 'https://www.google.com'
              }}
            >
              Não
            </button>
          </div>
          <p className="loja-letra-miuda">
            Venda de bebida alcoólica proibida para menores de 18 anos.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app loja">
      <header className="loja-topo">
        <img src={logoAdega} alt="" className="loja-logo" />
        <div style={{ minWidth: 0 }}>
          <h1>Adega Dois Irmãos</h1>
          <p className={status.aberta ? 'loja-aberta' : 'loja-fechada'}>● {status.texto}</p>
        </div>
      </header>

      <section className="loja-hero">
        <p>
          Monte seu pedido e envie pelo <strong>WhatsApp</strong>. <strong>Retire na loja</strong>{' '}
          ou peça <strong>entrega por Uber/99</strong>.
        </p>
      </section>

      {(categoriaAtiva === 'Todos' || categoriaAtiva === 'Espetinhos') && !busca.trim() && (
        <section className="loja-espetinho">
          <img src="/loja/espetinhos-brasa.jpg" alt="Espetinhos na brasa" loading="lazy" />
          <div className="loja-espetinho-texto">
            <h2>🔥 Espetinho Dois Irmãos</h2>
            <p>O verdadeiro sabor do churrasco, feito na hora na nossa churrasqueira.</p>
            {categoriaAtiva !== 'Espetinhos' && (
              <button
                type="button"
                className="app-btn"
                onClick={() => setCategoriaAtiva('Espetinhos')}
              >
                Ver espetinhos
              </button>
            )}
          </div>
        </section>
      )}

      <div className="loja-filtros">
        <input
          className="app-input"
          type="search"
          placeholder="🔎 Buscar bebida, gelo, petisco..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="loja-categorias">
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className="app-pill-btn"
              aria-pressed={categoriaAtiva === c}
              onClick={() => setCategoriaAtiva(c)}
            >
              {c !== 'Todos' && ICONE_CATEGORIA[c] ? `${ICONE_CATEGORIA[c]} ` : ''}
              {c}
            </button>
          ))}
        </div>
      </div>

      <main className="loja-grade">
        {erro && <p className="app-msg-erro">{erro}</p>}
        {!produtos && !erro && <p style={{ color: 'var(--text-muted)' }}>Carregando produtos...</p>}
        {produtos && visiveis.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>Nenhum produto encontrado.</p>
        )}
        {visiveis.map((p) => {
          const q = carrinho[p.id] ?? 0
          return (
            <article key={p.id} className="loja-card">
              <Foto ean={p.ean} nome={p.nome} categoria={p.categoria} />
              <h3>{nomeBonito(p.nome)}</h3>
              <p className="loja-preco">{brl(p.preco)}</p>
              {q === 0 ? (
                <button type="button" className="app-btn loja-add" onClick={() => mudar(p.id, 1)}>
                  Adicionar
                </button>
              ) : (
                <div className="loja-qtd">
                  <button type="button" onClick={() => mudar(p.id, -1)} aria-label="Menos">
                    −
                  </button>
                  <span>{q}</span>
                  <button type="button" onClick={() => mudar(p.id, 1)} aria-label="Mais">
                    +
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </main>

      <footer className="loja-rodape">
        <p>
          <strong>Adega Dois Irmãos</strong> · {ENDERECO}
        </p>
        <p>
          WhatsApp: <a href={`https://wa.me/${WHATSAPP}`}>{WHATSAPP_EXIBICAO}</a>
        </p>
        <p className="loja-letra-miuda">
          {HORARIOS.map(
            (h, d) =>
              `${NOMES_DIA[d]}: ${h ? (h[0] === 0 && h[1] >= 1440 ? 'aberto' : `${hm(h[0])}–${hm(h[1])}`) : 'fechado'}`,
          ).join(' · ')}
        </p>
        <p className="loja-letra-miuda">
          Proibida a venda de bebidas alcoólicas para menores de 18 anos. Se beber, não dirija.
        </p>
      </footer>

      {totalItens > 0 && !aberto && (
        <button type="button" className="loja-barra-carrinho" onClick={() => setAberto(true)}>
          <span>
            🛒 {totalItens} {totalItens === 1 ? 'item' : 'itens'}
          </span>
          <strong>Ver pedido · {brl(total)}</strong>
        </button>
      )}

      {aberto && (
        <div
          className="loja-painel-fundo"
          onClick={(e) => e.target === e.currentTarget && setAberto(false)}
        >
          <div className="loja-painel">
            <div className="loja-painel-topo">
              <h2>Seu pedido</h2>
              <button type="button" className="app-btn-ghost" onClick={() => setAberto(false)}>
                Fechar
              </button>
            </div>

            {itens.length === 0 && <p>Carrinho vazio.</p>}
            {itens.map((x) => (
              <div key={x.p.id} className="loja-linha">
                <span className="loja-linha-nome">{nomeBonito(x.p.nome)}</span>
                <div className="loja-qtd loja-qtd-peq">
                  <button type="button" onClick={() => mudar(x.p.id, -1)}>
                    −
                  </button>
                  <span>{x.q}</span>
                  <button type="button" onClick={() => mudar(x.p.id, 1)}>
                    +
                  </button>
                </div>
                <strong>{brl(x.q * x.p.preco)}</strong>
              </div>
            ))}
            <p className="loja-total">
              Total dos produtos: <strong>{brl(total)}</strong>
            </p>

            <h3>Como você quer receber?</h3>
            <div className="loja-opcoes">
              <label className={modo === 'retirada' ? 'ativo' : ''}>
                <input
                  type="radio"
                  checked={modo === 'retirada'}
                  onChange={() => setModo('retirada')}
                />
                🏪 <strong>Retirar na loja</strong>
                <small>{ENDERECO}</small>
              </label>
              <label className={modo === 'entrega' ? 'ativo' : ''}>
                <input
                  type="radio"
                  checked={modo === 'entrega'}
                  onChange={() => setModo('entrega')}
                />
                🛵 <strong>Quero entrega (Uber / 99)</strong>
              </label>
            </div>
            {modo === 'entrega' && (
              <div className="loja-aviso-entrega">
                <p>
                  <strong>Entrega por aplicativo:</strong> a Adega chama um{' '}
                  <strong>Uber Flash</strong> ou <strong>99 Entrega</strong> até o seu endereço.
                </p>
                <p>
                  O valor da corrida <strong>não está incluso</strong> no total. Ele aparece no
                  aplicativo na hora da solicitação e{' '}
                  <strong>deve ser pago junto com a sua compra</strong>.
                </p>
                <p>
                  Assim que o pedido for confirmado, enviamos pelo WhatsApp o valor da corrida e o
                  total final.
                </p>
                <input
                  className="app-input"
                  placeholder="Endereço completo (rua, número, bairro)"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                />
                <input
                  className="app-input"
                  placeholder="Ponto de referência (opcional)"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                />
              </div>
            )}

            <h3>Seus dados</h3>
            <input
              className="app-input"
              placeholder="Seu nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <select
              className="app-input"
              value={pagamento}
              onChange={(e) => setPagamento(e.target.value)}
            >
              <option>Pix</option>
              <option>Dinheiro</option>
              <option>Cartão de débito</option>
              <option>Cartão de crédito</option>
            </select>
            <input
              className="app-input"
              placeholder="Observação (ex.: trocar pra R$ 100, bem gelada...)"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />

            {!status.aberta && (
              <p className="app-aviso">
                A loja está fechada agora ({status.texto.replace('Fechado · ', '')}). Você pode
                mandar o pedido e respondemos assim que abrirmos.
              </p>
            )}
            <button
              type="button"
              className="loja-btn-whats"
              disabled={!podeEnviar}
              onClick={enviar}
            >
              Enviar pedido pelo WhatsApp
            </button>
            {!podeEnviar && itens.length > 0 && (
              <p className="loja-letra-miuda">
                Preencha seu nome{modo === 'entrega' ? ' e o endereço' : ''} pra enviar.
              </p>
            )}
            <p className="loja-letra-miuda">
              O pagamento é feito na retirada ou na entrega. Nada é cobrado pelo site.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
