import { centavos, formatarBRL } from '@adega/core'
import { useRef, useState } from 'react'
import {
  buscarProdutosPorDescricao,
  confirmarEntradaNota,
  criarProduto,
  ErroRequisicao,
  lerNotaPorFoto,
  type ItemNotaLidoApi,
  type NotaLidaApi,
  type ProdutoResumoNota,
} from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly aoVoltar: () => void
}

interface LinhaConferencia {
  readonly item: ItemNotaLidoApi
  produto: ProdutoResumoNota | null
  quantidadeTexto: string
  custoTexto: string
  ignorar: boolean
}

function centavosParaTexto(v: number | null): string {
  return v === null ? '' : (v / 100).toFixed(2).replace('.', ',')
}

function textoParaCentavos(t: string): number | null {
  const limpo = t.trim().replace(/\./g, '').replace(',', '.')
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

function textoParaQtd(t: string): number {
  const n = Number(t.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function fmtEstoque(v: number | string | null): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : String(v)
}

/** Reduz a foto (celular tira 4000px+) pra no maximo 1600px em JPEG: sobe rapido e a IA le igual. */
async function prepararImagem(
  arquivo: File,
): Promise<{ base64: string; mime: string; url: string }> {
  const url = URL.createObjectURL(arquivo)
  const img = await new Promise<HTMLImageElement>((ok, falha) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => falha(new Error('Nao consegui abrir a imagem.'))
    i.src = url
  })
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * escala)
  canvas.height = Math.round(img.height * escala)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { base64: dataUrl.split(',')[1]!, mime: 'image/jpeg', url }
}

/**
 * Entrada de mercadoria por foto da nota (pedido do cliente 25/09):
 * foto -> IA le os itens -> conferencia (liga cada item a um produto;
 * nao cadastrados podem ser cadastrados aqui mesmo com a pistola) ->
 * entrada no estoque. Nada e gravado antes do "Dar entrada".
 */
export function EntradaNotaTela({ aoVoltar }: Props) {
  return (
    <div className="app">
      <TopoApp titulo="Entrada por nota">
        <button type="button" className="app-btn-outline" onClick={aoVoltar}>
          Voltar ao caixa
        </button>
      </TopoApp>
      <main className="app-shell" style={{ maxWidth: 1180 }}>
        <ConteudoEntradaNota />
      </main>
    </div>
  )
}

/**
 * Miolo da entrada por nota, sem cabecalho: usado na tela do PDV e na aba
 * "Nota" do painel mobile (`compacto` = uma coluna, foto pequena).
 * So estoque por enquanto -- financeiro vem depois (pedido do cliente 25/09).
 */
export function ConteudoEntradaNota({ compacto = false }: { readonly compacto?: boolean }) {
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [nota, setNota] = useState<NotaLidaApi | null>(null)
  const [fornecedor, setFornecedor] = useState('')
  const [numero, setNumero] = useState('')
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([])
  const [gravando, setGravando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  function atualizarLinha(indice: number, mudanca: Partial<LinhaConferencia>) {
    setLinhas((ls) => ls.map((l) => (l.item.indice === indice ? { ...l, ...mudanca } : l)))
  }

  async function aoEscolherFoto(arquivo: File | undefined) {
    if (!arquivo) return
    setErro(null)
    setResultado(null)
    setNota(null)
    setLinhas([])
    setLendo(true)
    try {
      const { base64, mime, url } = await prepararImagem(arquivo)
      setPrevia(url)
      const lida = await lerNotaPorFoto(base64, mime)
      setNota(lida)
      setFornecedor(lida.fornecedor ?? '')
      setNumero(lida.numero ?? '')
      setLinhas(
        lida.itens.map((item) => ({
          item,
          produto: item.produto,
          quantidadeTexto: String(item.quantidade).replace('.', ','),
          custoTexto: centavosParaTexto(item.custoUnitario),
          ignorar: false,
        })),
      )
      if (lida.itens.length === 0) setErro('A leitura nao encontrou itens. Tente outra foto.')
    } catch (e) {
      setErro(
        e instanceof ErroRequisicao || e instanceof Error ? e.message : 'Falha ao ler a nota.',
      )
    } finally {
      setLendo(false)
      if (inputArquivoRef.current) inputArquivoRef.current.value = ''
    }
  }

  const ativas = linhas.filter((l) => !l.ignorar)
  const semProduto = ativas.filter((l) => !l.produto)
  const prontas = ativas.filter((l) => l.produto && textoParaQtd(l.quantidadeTexto) > 0)
  const totalNota = prontas.reduce(
    (s, l) => s + (textoParaCentavos(l.custoTexto) ?? 0) * textoParaQtd(l.quantidadeTexto),
    0,
  )

  async function darEntrada() {
    if (semProduto.length > 0 || prontas.length === 0) return
    setGravando(true)
    setErro(null)
    try {
      const r = await confirmarEntradaNota({
        fornecedor: fornecedor.trim() || undefined,
        numero: numero.trim() || undefined,
        itens: prontas.map((l) => ({
          produtoId: l.produto!.id,
          quantidade: textoParaQtd(l.quantidadeTexto),
          custoUnitario: textoParaCentavos(l.custoTexto) ?? undefined,
        })),
      })
      setResultado(`Entrada feita: ${r.itensLancados} item(ns) lancado(s) no estoque.`)
      setNota(null)
      setLinhas([])
      setPrevia(null)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao dar entrada.')
    } finally {
      setGravando(false)
    }
  }

  return (
    <>
      <div className={compacto ? undefined : 'app-card'}>
        <p style={{ marginTop: 0 }}>
          Tire uma foto da nota (reta, com boa luz, pegando todos os itens). A leitura leva alguns
          segundos. Nada entra no estoque antes de voce conferir e apertar "Dar entrada".
        </p>
        <input
          ref={inputArquivoRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => void aoEscolherFoto(e.target.files?.[0])}
        />
        <button
          type="button"
          className="app-btn app-btn-grande"
          disabled={lendo}
          onClick={() => inputArquivoRef.current?.click()}
        >
          {lendo
            ? 'Lendo a nota...'
            : nota
              ? 'Ler outra nota'
              : 'Tirar foto / escolher imagem da nota'}
        </button>
        {erro && <p className="app-msg-erro">{erro}</p>}
        {resultado && <p className="app-msg-ok">{resultado}</p>}
      </div>

      {nota && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: previa && !compacto ? 'minmax(0, 1fr) minmax(0, 2.2fr)' : '1fr',
            gap: 12,
            marginTop: 12,
            alignItems: 'start',
          }}
        >
          {previa && !compacto && (
            <div className="app-card" style={{ margin: 0 }}>
              <p className="app-label" style={{ marginTop: 0 }}>
                Foto
              </p>
              <img src={previa} alt="Nota" style={{ width: '100%', borderRadius: 8 }} />
            </div>
          )}

          <div className="app-card" style={{ margin: 0 }}>
            <div className="app-grid-2">
              <label>
                <span className="app-label">Fornecedor</span>
                <input
                  className="app-input"
                  value={fornecedor}
                  onChange={(e) => setFornecedor(e.target.value)}
                />
              </label>
              <label>
                <span className="app-label">Numero da nota</span>
                <input
                  className="app-input"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </label>
            </div>

            <p style={{ margin: '12px 0' }}>
              <strong>{linhas.length}</strong> item(ns) lido(s) -{' '}
              <strong>{ativas.length - semProduto.length}</strong> ligado(s) a produto,{' '}
              <strong style={{ color: semProduto.length ? '#e0a100' : undefined }}>
                {semProduto.length}
              </strong>{' '}
              sem produto
            </p>

            {linhas.map((l) => (
              <LinhaItem
                key={l.item.indice}
                linha={l}
                aoMudar={(m) => atualizarLinha(l.item.indice, m)}
              />
            ))}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 12,
              }}
            >
              <span>
                Total dos itens: <strong>{formatarBRL(centavos(Math.round(totalNota)))}</strong>
              </span>
              <button
                type="button"
                className="app-btn app-btn-grande"
                disabled={gravando || semProduto.length > 0 || prontas.length === 0}
                onClick={() => void darEntrada()}
              >
                {gravando ? 'Gravando...' : `Dar entrada (${prontas.length})`}
              </button>
            </div>
            {semProduto.length > 0 && (
              <p className="app-aviso" style={{ marginTop: 8 }}>
                Ligue ou cadastre os {semProduto.length} item(ns) sem produto (ou marque "Ignorar")
                pra liberar a entrada.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function LinhaItem({
  linha,
  aoMudar,
}: {
  readonly linha: LinhaConferencia
  readonly aoMudar: (m: Partial<LinhaConferencia>) => void
}) {
  const { item } = linha
  const [modo, setModo] = useState<'nada' | 'buscar' | 'cadastrar'>('nada')
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ProdutoResumoNota[]>([])
  const [ean, setEan] = useState(item.ean ?? '')
  const [descricao, setDescricao] = useState(item.descricaoLida)
  const [precoTexto, setPrecoTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function buscar() {
    setErro(null)
    if (termo.trim().length < 2) return
    try {
      const { produtos } = await buscarProdutosPorDescricao(termo.trim())
      setResultados(produtos)
      if (produtos.length === 0) setErro('Nada encontrado com esse nome.')
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha na busca.')
    }
  }

  async function cadastrar() {
    setErro(null)
    const preco = textoParaCentavos(precoTexto)
    const eanLimpo = ean.replace(/\D/g, '')
    if (!descricao.trim()) return setErro('Informe a descricao.')
    if (preco === null) return setErro('Informe o preco de venda.')
    if (eanLimpo && !/^\d{8,14}$/.test(eanLimpo))
      return setErro('Codigo de barras precisa ter de 8 a 14 digitos.')
    setSalvando(true)
    try {
      const { produto } = await criarProduto({
        descricao: descricao.trim(),
        ean: eanLimpo || undefined,
        precoVenda: preco,
        custoMedio: textoParaCentavos(linha.custoTexto) ?? undefined,
      })
      escolher({
        id: produto.id,
        descricao: produto.descricao,
        ean: produto.ean ?? null,
        estoqueAtual: produto.estoqueAtual ?? 0,
      })
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao cadastrar.')
    } finally {
      setSalvando(false)
    }
  }

  function escolher(p: ProdutoResumoNota) {
    aoMudar({ produto: p })
    setModo('nada')
    setResultados([])
    setErro(null)
  }

  const ok = Boolean(linha.produto) && !linha.ignorar
  const cor = linha.ignorar ? 'var(--text-muted)' : ok ? '#4caf50' : '#e0a100'

  return (
    <div
      style={{
        borderLeft: `4px solid ${cor}`,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '8px 10px',
        opacity: linha.ignorar ? 0.5 : 1,
      }}
    >
      {/* Linha 1: produto do sistema (ou aviso) + qtd + custo */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          {linha.produto ? (
            <>
              <strong>{linha.produto.descricao}</strong>
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                estoque {fmtEstoque(linha.produto.estoqueAtual)} → entra +
                {fmtEstoque(textoParaQtd(linha.quantidadeTexto))}
              </div>
            </>
          ) : (
            <strong style={{ color: '#e0a100' }}>{item.descricaoLida || '(sem descricao)'}</strong>
          )}
          <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>
            na nota: {item.descricaoLida || '(sem descricao)'}
            {item.ean ? ` · cod. ${item.ean}` : ''}
          </div>
        </div>
        <input
          className="app-input"
          aria-label="Quantidade"
          inputMode="decimal"
          style={{ width: 70, textAlign: 'center' }}
          value={linha.quantidadeTexto}
          onChange={(e) => aoMudar({ quantidadeTexto: e.target.value })}
        />
        <input
          className="app-input"
          aria-label="Custo unitario"
          inputMode="decimal"
          style={{ width: 84, textAlign: 'right' }}
          placeholder="custo"
          value={linha.custoTexto}
          onChange={(e) => aoMudar({ custoTexto: e.target.value })}
        />
      </div>

      {/* Linha 2: acoes. Produto que ja existe entra direto; so o que NAO
          existe pede cadastro (pedido do cliente: sem lista de parecidos). */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 6,
          fontSize: '0.85em',
          alignItems: 'center',
        }}
      >
        {!linha.produto && !linha.ignorar && (
          <>
            <span style={{ color: '#e0a100' }}>Esse produto nao tem no sistema.</span>
            <button
              type="button"
              className="app-btn"
              style={{ padding: '4px 10px' }}
              onClick={() => setModo('cadastrar')}
            >
              Cadastrar
            </button>
            <button
              type="button"
              className="app-btn-ghost"
              style={{ padding: '2px 6px' }}
              onClick={() => setModo('buscar')}
            >
              Ja existe com outro nome
            </button>
          </>
        )}
        {linha.produto && (
          <button
            type="button"
            className="app-btn-ghost"
            style={{ padding: '2px 6px' }}
            onClick={() => setModo(modo === 'nada' ? 'buscar' : 'nada')}
          >
            Trocar produto
          </button>
        )}
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={linha.ignorar}
            onChange={(e) => aoMudar({ ignorar: e.target.checked })}
          />
          Ignorar
        </label>
      </div>

      {/* Painel de escolha: lista enxuta (select), buscar outro, ou cadastrar */}
      {modo !== 'nada' && !linha.ignorar && (
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {modo === 'buscar' && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="app-input"
                  autoFocus
                  placeholder="Nome do produto"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void buscar()}
                />
                <button type="button" className="app-btn-outline" onClick={() => void buscar()}>
                  Buscar
                </button>
              </div>
              {resultados.length > 0 && (
                <select
                  className="app-input"
                  value=""
                  onChange={(e) => {
                    const p = resultados.find((x) => x.id === e.target.value)
                    if (p) escolher(p)
                  }}
                >
                  <option value="" disabled>
                    {resultados.length} encontrado(s) — escolha:
                  </option>
                  {resultados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.descricao} (estoque {fmtEstoque(p.estoqueAtual)})
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {modo === 'cadastrar' && (
            <>
              <input
                className="app-input"
                autoFocus
                inputMode="numeric"
                placeholder="Codigo de barras (passe a pistola)"
                value={ean}
                onChange={(e) => setEan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault()
                }}
              />
              <input
                className="app-input"
                placeholder="Descricao"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
              <input
                className="app-input"
                inputMode="decimal"
                placeholder="Preco de venda (R$)"
                value={precoTexto}
                onChange={(e) => setPrecoTexto(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="app-btn"
                  disabled={salvando}
                  onClick={() => void cadastrar()}
                >
                  {salvando ? 'Salvando...' : 'Salvar produto novo'}
                </button>
                <button type="button" className="app-btn-ghost" onClick={() => setModo('nada')}>
                  Cancelar
                </button>
              </div>
            </>
          )}
          {erro && <p className="app-msg-erro">{erro}</p>}
        </div>
      )}
    </div>
  )
}
