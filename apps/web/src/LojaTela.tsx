import { centavos, formatarBRL } from '@adega/core'
import { useEffect, useMemo, useState } from 'react'
import logoAdega from './assets/logo-adega-dois-irmaos.jpg'
import { buscarFotoProduto, eanPodeTerFoto } from './fotoProduto'

/**
 * Loja online da Adega Dois Irmaos (pedido do cliente 25/09).
 * Vitrine publica em /loja: o cliente monta o carrinho e o pedido e enviado
 * pelo WhatsApp da loja (sem pagamento online por enquanto). Retirada na loja
 * ou entrega por Uber Flash / 99 Entrega, com a corrida paga junto com a compra.
 *
 * Layout "Versao 3" do designer (25/09):
 * - HOME: no computador e a arte fixa (/loja/home.webp) com os links marcados
 *   por cima (areas em % da imagem); no celular e a mesma home refeita em CSS.
 * - INTERNO (/loja#produtos): grade de produtos + painel "Seu pedido".
 *   Foto real pelo codigo de barras quando existe; senao, a arte da categoria.
 */

// ---------------- configuracao da loja ----------------
const WHATSAPP = '5512996859407'
const WHATSAPP_EXIBICAO = '(12) 99685-9407'
const ENDERECO = 'Rua Euclides Ribeiro, 21 - Residencial San Marino, Taubaté/SP'
const MAPA = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  'Rua Euclides Ribeiro, 21, Taubaté - SP',
)}`
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

/** Filtro "Bebidas" (link da home): todas as categorias de bebida. */
const BEBIDAS = new Set([
  'Cervejas',
  'Destilados',
  'Drinks e ices',
  'Energéticos',
  'Vinhos e espumantes',
  'Refrigerantes, água e sucos',
])

const ICONE_CATEGORIA: Record<string, string> = {
  Bebidas: '🍾',
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

/** Arte de cada categoria (designer, Versao 3) -- capa quando o produto nao tem foto. */
const CAPA_CATEGORIA: Record<string, string> = {
  Espetinhos: '/loja/cat/espetinhos.webp',
  Cervejas: '/loja/cat/cervejas.webp',
  Destilados: '/loja/cat/destilados.webp',
  'Drinks e ices': '/loja/cat/drinks-e-ices.webp',
  Energéticos: '/loja/cat/energeticos.webp',
  'Vinhos e espumantes': '/loja/cat/vinhos-e-espumantes.webp',
  'Refrigerantes, água e sucos': '/loja/cat/refrigerantes-agua-sucos.webp',
  Gelo: '/loja/cat/gelo.webp',
  'Petiscos, doces e outros': '/loja/cat/petiscos-doces-e-outros.webp',
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

/** Fonte condensada dos titulos (Oswald), so na loja. */
function useFonteLoja() {
  useEffect(() => {
    const id = 'fonte-loja'
    if (document.getElementById(id)) return
    const l = document.createElement('link')
    l.id = id
    l.rel = 'stylesheet'
    l.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap'
    document.head.appendChild(l)
  }, [])
}

function Foto({
  ean,
  nome,
  categoria,
  pequena = false,
}: {
  readonly ean: string | null
  readonly nome: string
  readonly categoria: string
  readonly pequena?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    if (eanPodeTerFoto(ean)) void buscarFotoProduto(ean).then((u) => vivo && setUrl(u))
    return () => {
      vivo = false
    }
  }, [ean])
  const capa = CAPA_CATEGORIA[categoria]
  return (
    <div className={`loja-foto${pequena ? ' loja-foto-peq' : ''}${url ? ' loja-foto-real' : ''}`}>
      {url ? (
        <img src={url} alt={nome} loading="lazy" />
      ) : capa ? (
        <img src={capa} alt="" loading="lazy" className="loja-foto-capa" />
      ) : (
        <span className="loja-foto-vazia" aria-hidden="true">
          {ICONE_CATEGORIA[categoria] ?? '🛒'}
        </span>
      )}
    </div>
  )
}

// ---------------- icones (traco dourado, como no layout) ----------------
function IconeCarrinho() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" />
      <circle cx="9.5" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </svg>
  )
}
function IconeBusca() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
function IconeLixo() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  )
}

// ---------------- HOME ----------------
type Destino =
  | { readonly tipo: 'categoria'; readonly categoria: string }
  | { readonly tipo: 'pedido' }
  | { readonly tipo: 'link'; readonly href: string }
  | { readonly tipo: 'inicio' }

/** Areas clicaveis da arte da home, em % (x, y, largura, altura) da imagem 16:9. */
const AREAS_HOME: readonly {
  rotulo: string
  x: number
  y: number
  w: number
  h: number
  destino: Destino
}[] = [
  { rotulo: 'Início', x: 4, y: 1.5, w: 30, h: 16, destino: { tipo: 'inicio' } },
  { rotulo: 'Início', x: 51, y: 3, w: 6, h: 6, destino: { tipo: 'inicio' } },
  {
    rotulo: 'Bebidas',
    x: 58,
    y: 3,
    w: 7,
    h: 6,
    destino: { tipo: 'categoria', categoria: 'Bebidas' },
  },
  {
    rotulo: 'Espetinhos',
    x: 65.5,
    y: 3,
    w: 8.5,
    h: 6,
    destino: { tipo: 'categoria', categoria: 'Espetinhos' },
  },
  {
    rotulo: 'Gelo e acessórios',
    x: 75,
    y: 3,
    w: 12.5,
    h: 6,
    destino: { tipo: 'categoria', categoria: 'Gelo' },
  },
  { rotulo: 'Meu pedido', x: 88.5, y: 3, w: 9.5, h: 6, destino: { tipo: 'pedido' } },
  {
    rotulo: 'Faça sua compra',
    x: 4.9,
    y: 50.4,
    w: 24.8,
    h: 6.5,
    destino: { tipo: 'categoria', categoria: 'Todos' },
  },
  {
    rotulo: 'Pedir pelo WhatsApp',
    x: 4.9,
    y: 57.6,
    w: 27.2,
    h: 3.4,
    destino: { tipo: 'link', href: `https://wa.me/${WHATSAPP}` },
  },
  {
    rotulo: 'Bebidas geladas',
    x: 2.4,
    y: 62.2,
    w: 22.9,
    h: 21.4,
    destino: { tipo: 'categoria', categoria: 'Bebidas' },
  },
  {
    rotulo: 'Espetinhos',
    x: 26.5,
    y: 62.2,
    w: 22.9,
    h: 21.4,
    destino: { tipo: 'categoria', categoria: 'Espetinhos' },
  },
  {
    rotulo: 'Drinks e Nusakinho',
    x: 50.4,
    y: 62.2,
    w: 21.7,
    h: 21.4,
    destino: { tipo: 'categoria', categoria: 'Drinks e ices' },
  },
  {
    rotulo: 'Gelo e acompanhamentos',
    x: 73.4,
    y: 62.2,
    w: 24.2,
    h: 21.4,
    destino: { tipo: 'categoria', categoria: 'Gelo' },
  },
  {
    rotulo: 'Retirada na loja',
    x: 54,
    y: 85.5,
    w: 17,
    h: 6,
    destino: { tipo: 'categoria', categoria: 'Todos' },
  },
  {
    rotulo: 'Entrega por Uber/99',
    x: 72,
    y: 85.5,
    w: 19,
    h: 6,
    destino: { tipo: 'categoria', categoria: 'Todos' },
  },
  { rotulo: 'Ver no mapa', x: 2, y: 93.5, w: 38, h: 5.5, destino: { tipo: 'link', href: MAPA } },
  {
    rotulo: 'WhatsApp (12) 99685-9407',
    x: 43.5,
    y: 93.5,
    w: 15.5,
    h: 5.5,
    destino: { tipo: 'link', href: `https://wa.me/${WHATSAPP}` },
  },
]

const CARDS_HOME: readonly { titulo: string; icone: string; img: string; categoria: string }[] = [
  { titulo: 'Bebidas geladas', icone: '🍾', img: '/loja/home-bebidas.webp', categoria: 'Bebidas' },
  { titulo: 'Espetinhos', icone: '🍢', img: '/loja/home-espetinhos.webp', categoria: 'Espetinhos' },
  {
    titulo: 'Drinks e Nusakinho',
    icone: '🍹',
    img: '/loja/home-drinks.webp',
    categoria: 'Drinks e ices',
  },
  { titulo: 'Gelo e acompanhamentos', icone: '🧊', img: '/loja/home-gelo.webp', categoria: 'Gelo' },
]

function Home({
  totalItens,
  aoIr,
}: {
  readonly totalItens: number
  readonly aoIr: (d: Destino) => void
}) {
  return (
    <div className="loja-home">
      {/* Computador: a arte fixa do designer, com os links marcados por cima. */}
      <div className="loja-home-arte">
        <img
          src="/loja/home.webp"
          alt="Adega Dois Irmãos — sua adega do bairro, agora na palma da mão"
        />
        {AREAS_HOME.map((a, i) => {
          const estilo = { left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }
          if (a.destino.tipo === 'link')
            return (
              <a
                key={i}
                className="loja-area"
                style={estilo}
                href={a.destino.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={a.rotulo}
                title={a.rotulo}
              />
            )
          const d = a.destino
          return (
            <button
              key={i}
              type="button"
              className="loja-area"
              style={estilo}
              aria-label={a.rotulo}
              title={a.rotulo}
              onClick={() => aoIr(d)}
            >
              {d.tipo === 'pedido' && totalItens > 0 && (
                <span className="loja-area-badge">{totalItens}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Celular: a mesma home, feita em CSS. */}
      <div className="loja-home-movel">
        <header className="loja-hm-topo">
          <img src={logoAdega} alt="" className="loja-logo" />
          <span className="loja-marca">
            ADEGA <em>DOIS IRMÃOS</em>
          </span>
          <button
            type="button"
            className="loja-btn-pedido"
            onClick={() => aoIr({ tipo: 'pedido' })}
            aria-label="Meu pedido"
          >
            <IconeCarrinho />
            {totalItens > 0 && <span className="loja-badge">{totalItens}</span>}
          </button>
        </header>
        <section className="loja-hm-hero">
          <h1>
            <span>ADEGA</span>
            <em>DOIS IRMÃOS</em>
          </h1>
          <p>Sua adega do bairro, agora na palma da mão.</p>
          <button
            type="button"
            className="loja-cta"
            onClick={() => aoIr({ tipo: 'categoria', categoria: 'Todos' })}
          >
            <IconeCarrinho /> FAÇA SUA COMPRA
          </button>
          <p className="loja-hm-whats">
            Escolha, monte seu pedido e envie pelo <strong>WhatsApp</strong>.
          </p>
        </section>
        <section className="loja-hm-cards">
          {CARDS_HOME.map((c) => (
            <button
              key={c.titulo}
              type="button"
              className="loja-hm-card"
              onClick={() => aoIr({ tipo: 'categoria', categoria: c.categoria })}
            >
              <img src={c.img} alt="" loading="lazy" />
              <span>
                <i aria-hidden="true">{c.icone}</i> {c.titulo}
              </span>
            </button>
          ))}
        </section>
        <ul className="loja-hm-selos">
          <li>❄️ Produtos gelados</li>
          <li>🍢 Espetinho feito na hora</li>
          <li>🏪 Retirada na loja</li>
          <li>🛵 Entrega por Uber/99</li>
        </ul>
        <footer className="loja-hm-rodape">
          <a href={MAPA} target="_blank" rel="noopener noreferrer">
            📍 {ENDERECO}
          </a>
          <a
            href={`https://wa.me/${WHATSAPP}`}
            target="_blank"
            rel="noopener noreferrer"
            className="loja-hm-fone"
          >
            WhatsApp {WHATSAPP_EXIBICAO}
          </a>
          <p className="loja-letra-miuda">
            <strong className="loja-selo18">18</strong> Proibida a venda de bebidas alcoólicas para
            menores de 18 anos. Se beber, não dirija.
          </p>
        </footer>
      </div>
    </div>
  )
}

// ---------------- LOJA ----------------
function telaDaUrl(): 'home' | 'produtos' {
  return window.location.hash.startsWith('#produtos') ? 'produtos' : 'home'
}

export function LojaTela() {
  useFonteLoja()
  const [maior, setMaior] = useState<boolean>(() => lerJson(CHAVE_IDADE, false))
  const [tela, setTela] = useState<'home' | 'produtos'>(telaDaUrl)
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

  // Botao "voltar" do celular: #produtos <-> home.
  useEffect(() => {
    const f = () => setTela(telaDaUrl())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
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
    return ['Todos', 'Bebidas', ...ORDEM_CATEGORIAS.filter((c) => presentes.has(c))]
  }, [produtos])

  const visiveis = useMemo(() => {
    const termo = busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
    return (produtos ?? []).filter((p) => {
      if (categoriaAtiva === 'Bebidas') {
        if (!BEBIDAS.has(p.categoria)) return false
      } else if (categoriaAtiva !== 'Todos' && p.categoria !== categoriaAtiva) return false
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
  function remover(id: string) {
    setCarrinho((c) => {
      const novo = { ...c }
      delete novo[id]
      return novo
    })
  }

  function irParaProdutos() {
    if (window.location.hash !== '#produtos') window.location.hash = 'produtos'
    setTela('produtos')
    window.scrollTo(0, 0)
  }
  function irParaHome() {
    if (window.location.hash) history.pushState(null, '', window.location.pathname)
    setTela('home')
    setAberto(false)
    window.scrollTo(0, 0)
  }
  function aoIr(d: Destino) {
    if (d.tipo === 'inicio') return irParaHome()
    if (d.tipo === 'link') return
    irParaProdutos()
    if (d.tipo === 'categoria') {
      setBusca('')
      setCategoriaAtiva(d.categoria)
    } else setAberto(true)
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
          <h1 className="loja-marca loja-marca-grande">
            ADEGA <em>DOIS IRMÃOS</em>
          </h1>
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

  const painel = aberto && (
    <div
      className="loja-painel-fundo"
      onClick={(e) => e.target === e.currentTarget && setAberto(false)}
    >
      <aside className="loja-painel" aria-label="Seu pedido">
        <div className="loja-painel-topo">
          <h2>
            <IconeCarrinho /> SEU PEDIDO
          </h2>
          <button
            type="button"
            className="loja-fechar"
            onClick={() => setAberto(false)}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {itens.length === 0 && (
          <p className="loja-vazio">
            Seu pedido está vazio.{' '}
            <button type="button" className="loja-link" onClick={() => setAberto(false)}>
              Escolher produtos
            </button>
          </p>
        )}
        {itens.map((x) => (
          <div key={x.p.id} className="loja-linha">
            <Foto ean={x.p.ean} nome={x.p.nome} categoria={x.p.categoria} pequena />
            <div className="loja-linha-info">
              <span className="loja-linha-nome">{nomeBonito(x.p.nome)}</span>
              <strong>{brl(x.q * x.p.preco)}</strong>
            </div>
            <div className="loja-qtd loja-qtd-peq">
              <button type="button" onClick={() => mudar(x.p.id, -1)} aria-label="Menos">
                −
              </button>
              <span>{x.q}</span>
              <button type="button" onClick={() => mudar(x.p.id, 1)} aria-label="Mais">
                +
              </button>
            </div>
            <button
              type="button"
              className="loja-lixo"
              onClick={() => remover(x.p.id)}
              aria-label="Remover"
            >
              <IconeLixo />
            </button>
          </div>
        ))}
        {itens.length > 0 && (
          <p className="loja-total">
            Total dos produtos <strong>{brl(total)}</strong>
          </p>
        )}

        <h3 className="loja-subtitulo">COMO VOCÊ QUER RECEBER?</h3>
        <div className="loja-opcoes">
          <button
            type="button"
            className={modo === 'retirada' ? 'ativo' : ''}
            onClick={() => setModo('retirada')}
          >
            <i aria-hidden="true">🏪</i>
            <strong>Retirar na loja</strong>
            <small>Busque seu pedido no nosso endereço.</small>
          </button>
          <button
            type="button"
            className={modo === 'entrega' ? 'ativo' : ''}
            onClick={() => setModo('entrega')}
          >
            <i aria-hidden="true">🛵</i>
            <strong>
              Quero entrega <span>(Uber / 99)</span>
            </strong>
            <small>Entregamos até você via Uber ou 99.</small>
          </button>
        </div>
        {modo === 'entrega' && (
          <div className="loja-aviso-entrega">
            <span className="loja-aviso-i" aria-hidden="true">
              i
            </span>
            <p>
              <strong>A corrida não está no total acima.</strong> O valor aparece no aplicativo na
              hora de chamar e <strong>é pago junto com a sua compra</strong>. Enviamos o valor da
              corrida e o total final pelo WhatsApp.
            </p>
          </div>
        )}

        <label className="loja-campo">
          Seu nome
          <input
            className="app-input"
            placeholder="Digite seu nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        {modo === 'entrega' && (
          <>
            <label className="loja-campo">
              Endereço completo
              <input
                className="app-input"
                placeholder="Rua, número, bairro"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
              />
            </label>
            <label className="loja-campo">
              <span>
                Ponto de referência <small>(opcional)</small>
              </span>
              <input
                className="app-input"
                placeholder="Ex.: perto da padaria"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="loja-campo">
          Pagamento {modo === 'retirada' ? 'na retirada' : 'na entrega'}
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
        </label>
        <label className="loja-campo">
          <span>
            Observação <small>(opcional)</small>
          </span>
          <input
            className="app-input"
            placeholder="Ex.: troco pra R$ 100, bem gelada..."
            value={obs}
            onChange={(e) => setObs(e.target.value)}
          />
        </label>

        {!status.aberta && (
          <p className="app-aviso">
            A loja está fechada agora ({status.texto.replace('Fechado · ', '')}). Você pode mandar o
            pedido e respondemos assim que abrirmos.
          </p>
        )}
        <button type="button" className="loja-btn-whats" disabled={!podeEnviar} onClick={enviar}>
          Enviar pedido pelo WhatsApp
        </button>
        {!podeEnviar && itens.length > 0 && (
          <p className="loja-letra-miuda">
            Preencha seu nome{modo === 'entrega' ? ' e o endereço' : ''} pra enviar.
          </p>
        )}
        <p className="loja-seguro">
          🔒 O pagamento é feito na retirada ou na entrega. Nada é cobrado pelo site.
        </p>
      </aside>
    </div>
  )

  if (tela === 'home') {
    return (
      <div className="app loja loja-v3">
        <Home totalItens={totalItens} aoIr={aoIr} />
        {painel}
      </div>
    )
  }

  const tituloSecao =
    busca.trim() !== ''
      ? 'RESULTADO DA BUSCA'
      : categoriaAtiva === 'Todos'
        ? 'NOSSOS PRODUTOS'
        : categoriaAtiva.toUpperCase()

  return (
    <div className="app loja loja-v3">
      <header className="loja-topo">
        <button type="button" className="loja-topo-marca" onClick={irParaHome} aria-label="Início">
          <img src={logoAdega} alt="" className="loja-logo" />
          <span>
            <span className="loja-marca">
              ADEGA <em>DOIS IRMÃOS</em>
            </span>
            <small className={status.aberta ? 'loja-aberta' : 'loja-fechada'}>
              ● {status.texto}
            </small>
          </span>
        </button>
        <label className="loja-busca">
          <input
            type="search"
            placeholder="Buscar produtos..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <IconeBusca />
        </label>
        <button type="button" className="loja-btn-pedido" onClick={() => setAberto(true)}>
          <IconeCarrinho />
          <span className="loja-btn-pedido-txt">Meu pedido</span>
          {totalItens > 0 && <span className="loja-badge">{totalItens}</span>}
        </button>
      </header>

      <nav className="loja-categorias" aria-label="Categorias">
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            className="loja-pill"
            aria-pressed={categoriaAtiva === c}
            onClick={() => setCategoriaAtiva(c)}
          >
            {ICONE_CATEGORIA[c] && <i aria-hidden="true">{ICONE_CATEGORIA[c]}</i>}
            {c}
          </button>
        ))}
      </nav>

      {categoriaAtiva !== 'Todos' &&
        categoriaAtiva !== 'Bebidas' &&
        CAPA_CATEGORIA[categoriaAtiva] &&
        !busca.trim() && (
          <section className="loja-capa">
            <img src={CAPA_CATEGORIA[categoriaAtiva]} alt="" />
          </section>
        )}

      <div className="loja-secao">
        <h2>
          <span aria-hidden="true">🍺</span> {tituloSecao}
        </h2>
        <p>Tudo gelado, preparado com capricho e pronto para você.</p>
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
              <div className="loja-card-corpo">
                <h3>{nomeBonito(p.nome)}</h3>
                <p className="loja-preco">{brl(p.preco)}</p>
                {q === 0 ? (
                  <button type="button" className="loja-add" onClick={() => mudar(p.id, 1)}>
                    <IconeCarrinho /> Adicionar
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
              </div>
            </article>
          )
        })}
      </main>

      <footer className="loja-rodape">
        <a href={MAPA} target="_blank" rel="noopener noreferrer">
          📍 {ENDERECO}
        </a>
        <a href={`https://wa.me/${WHATSAPP}`} target="_blank" rel="noopener noreferrer">
          WhatsApp {WHATSAPP_EXIBICAO}
        </a>
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
            <IconeCarrinho /> {totalItens} {totalItens === 1 ? 'item' : 'itens'}
          </span>
          <strong>Ver pedido · {brl(total)}</strong>
        </button>
      )}

      {painel}
    </div>
  )
}
