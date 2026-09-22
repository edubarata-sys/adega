import { formatarBRL, centavos } from '@adega/core'
import { useEffect, useState } from 'react'
import {
  ajustarEstoque,
  atualizarProduto,
  criarCategoria,
  criarProduto,
  ErroRequisicao,
  listarCategorias,
  listarProdutosCadastro,
  type CategoriaApi,
  type DadosProdutoForm,
  type ProdutoCadastroApi,
} from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly aoVoltar: () => void
}

function reaisParaCentavos(texto: string): number {
  const normalizado = texto.trim().replace(',', '.')
  if (normalizado === '') return 0
  const valor = Number(normalizado)
  if (!Number.isFinite(valor)) return NaN
  return Math.round(valor * 100)
}

function centavosParaTexto(valor: number): string {
  return (valor / 100).toFixed(2).replace('.', ',')
}

interface FormularioProduto {
  readonly descricao: string
  readonly ean: string
  readonly descricaoPdv: string
  readonly unidade: 'UN' | 'KG' | 'L'
  readonly categoriaId: string
  readonly precoVendaTexto: string
  readonly custoMedioTexto: string
  readonly estoqueMinimoTexto: string
  readonly estoqueInicialTexto: string
  readonly ativo: boolean
}

const FORMULARIO_VAZIO: FormularioProduto = {
  descricao: '',
  ean: '',
  descricaoPdv: '',
  unidade: 'UN',
  categoriaId: '',
  precoVendaTexto: '',
  custoMedioTexto: '',
  estoqueMinimoTexto: '',
  estoqueInicialTexto: '',
  ativo: true,
}

/**
 * PASSO 10: tela de cadastro/estoque de produtos -- o gap que existia desde
 * a Fase 1 (so tinha baixa automatica na venda, nenhuma forma de cadastrar
 * ou editar um produto pela interface).
 */
export function ProdutosTela({ aoVoltar }: Props) {
  const [termo, setTermo] = useState('')
  const [produtos, setProdutos] = useState<ProdutoCadastroApi[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erroLista, setErroLista] = useState<string | null>(null)

  const [categorias, setCategorias] = useState<CategoriaApi[]>([])
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('')

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState<FormularioProduto>(FORMULARIO_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [mensagemOk, setMensagemOk] = useState<string | null>(null)

  const [ajusteTipo, setAjusteTipo] = useState<'entrada' | 'perda' | 'ajuste'>('entrada')
  const [ajusteQuantidadeTexto, setAjusteQuantidadeTexto] = useState('')
  const [ajusteObservacao, setAjusteObservacao] = useState('')
  const [ajustando, setAjustando] = useState(false)
  const [erroAjuste, setErroAjuste] = useState<string | null>(null)

  async function carregarProdutos(termoBusca?: string) {
    setCarregando(true)
    setErroLista(null)
    try {
      const { produtos: lista } = await listarProdutosCadastro(termoBusca)
      setProdutos(lista)
    } catch (e) {
      setErroLista(e instanceof ErroRequisicao ? e.message : 'Falha ao carregar produtos.')
    } finally {
      setCarregando(false)
    }
  }

  async function carregarCategorias() {
    try {
      const { categorias: lista } = await listarCategorias()
      setCategorias(lista)
    } catch {
      // Nao trava a tela por causa das categorias -- o dropdown so fica vazio.
    }
  }

  useEffect(() => {
    void carregarProdutos()
    void carregarCategorias()
  }, [])

  function iniciarNovo() {
    setEditandoId(null)
    setForm(FORMULARIO_VAZIO)
    setErroForm(null)
    setMensagemOk(null)
  }

  function selecionarParaEditar(produto: ProdutoCadastroApi) {
    setEditandoId(produto.id)
    setForm({
      descricao: produto.descricao,
      ean: produto.ean ?? '',
      descricaoPdv: produto.descricaoPdv ?? '',
      unidade: produto.unidade,
      categoriaId: produto.categoriaId ?? '',
      precoVendaTexto: centavosParaTexto(produto.precoVenda),
      custoMedioTexto: centavosParaTexto(produto.custoMedio),
      estoqueMinimoTexto: String(produto.estoqueMinimo ?? 0),
      estoqueInicialTexto: '',
      ativo: produto.ativo,
    })
    setErroForm(null)
    setMensagemOk(null)
    setErroAjuste(null)
  }

  async function salvar() {
    setErroForm(null)
    setMensagemOk(null)
    if (form.descricao.trim().length === 0) {
      setErroForm('Descricao e obrigatoria.')
      return
    }
    const precoVenda = reaisParaCentavos(form.precoVendaTexto)
    if (!Number.isFinite(precoVenda) || precoVenda < 0) {
      setErroForm('Preco de venda invalido.')
      return
    }
    const custoMedio =
      form.custoMedioTexto.trim() === '' ? 0 : reaisParaCentavos(form.custoMedioTexto)
    if (!Number.isFinite(custoMedio) || custoMedio < 0) {
      setErroForm('Custo medio invalido.')
      return
    }
    const estoqueMinimo =
      form.estoqueMinimoTexto.trim() === '' ? 0 : Number(form.estoqueMinimoTexto.replace(',', '.'))
    if (!Number.isFinite(estoqueMinimo) || estoqueMinimo < 0) {
      setErroForm('Estoque minimo invalido.')
      return
    }

    const dados: DadosProdutoForm = {
      descricao: form.descricao.trim(),
      ean: form.ean.trim() || undefined,
      descricaoPdv: form.descricaoPdv.trim() || undefined,
      unidade: form.unidade,
      categoriaId: form.categoriaId || undefined,
      precoVenda,
      custoMedio,
      estoqueMinimo,
      ativo: form.ativo,
    }

    setSalvando(true)
    try {
      if (editandoId) {
        await atualizarProduto(editandoId, dados)
        setMensagemOk('Produto atualizado.')
      } else {
        const estoqueInicialTexto = form.estoqueInicialTexto.trim()
        const estoqueInicial =
          estoqueInicialTexto === '' ? 0 : Number(estoqueInicialTexto.replace(',', '.'))
        if (!Number.isFinite(estoqueInicial) || estoqueInicial < 0) {
          setErroForm('Estoque inicial invalido.')
          setSalvando(false)
          return
        }
        await criarProduto({ ...dados, estoqueInicial })
        setMensagemOk('Produto criado.')
        iniciarNovo()
      }
      await carregarProdutos(termo)
    } catch (e) {
      setErroForm(e instanceof ErroRequisicao ? e.message : 'Falha ao salvar produto.')
    } finally {
      setSalvando(false)
    }
  }

  async function enviarAjusteEstoque() {
    if (!editandoId) return
    setErroAjuste(null)
    const quantidade = Number(ajusteQuantidadeTexto.trim().replace(',', '.'))
    if (!Number.isFinite(quantidade) || quantidade === 0) {
      setErroAjuste('Informe uma quantidade diferente de zero.')
      return
    }
    setAjustando(true)
    try {
      const { produto } = await ajustarEstoque(
        editandoId,
        ajusteTipo,
        quantidade,
        ajusteObservacao.trim() || undefined,
      )
      setAjusteQuantidadeTexto('')
      setAjusteObservacao('')
      setProdutos((atual) => atual.map((p) => (p.id === produto.id ? produto : p)))
    } catch (e) {
      setErroAjuste(
        e instanceof ErroRequisicao ? e.message : 'Falha ao lancar movimento de estoque.',
      )
    } finally {
      setAjustando(false)
    }
  }

  async function adicionarCategoria() {
    const nome = novaCategoriaNome.trim()
    if (nome.length === 0) return
    try {
      const { categoria } = await criarCategoria(nome)
      setCategorias((atual) => [...atual, categoria].sort((a, b) => a.nome.localeCompare(b.nome)))
      setForm((atual) => ({ ...atual, categoriaId: categoria.id }))
      setNovaCategoriaNome('')
    } catch (e) {
      setErroForm(e instanceof ErroRequisicao ? e.message : 'Falha ao criar categoria.')
    }
  }

  const produtoEmEdicao = editandoId ? produtos.find((p) => p.id === editandoId) : null

  return (
    <div className="app">
      <TopoApp titulo="Cadastro de produtos">
        <button type="button" className="app-btn-outline" onClick={aoVoltar}>
          Voltar ao PDV
        </button>
      </TopoApp>

      <main className="app-shell" style={{ maxWidth: 1080 }}>
        <div className="app-grid-2 app-grid-2col" style={{ alignItems: 'start' }}>
          <div className="app-card">
            <h2>Produtos</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Buscar por descricao"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void carregarProdutos(termo)
                }}
                className="app-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="app-btn-outline"
                onClick={() => void carregarProdutos(termo)}
              >
                Buscar
              </button>
              <button type="button" className="app-btn" onClick={iniciarNovo}>
                + Novo
              </button>
            </div>
            {carregando && <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>}
            {erroLista && <p className="app-msg-erro">{erroLista}</p>}

            <table className="app-table">
              <thead>
                <tr>
                  <th>Descricao</th>
                  <th>EAN</th>
                  <th>Preco</th>
                  <th>Estoque</th>
                  <th>Ativo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr
                    key={p.id}
                    className={
                      [
                        p.id === editandoId ? 'app-linha-destaque' : '',
                        !p.ativo ? 'app-linha-inativa' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                  >
                    <td>{p.descricao}</td>
                    <td>{p.ean ?? '-'}</td>
                    <td>{formatarBRL(centavos(p.precoVenda))}</td>
                    <td>{Number(p.estoqueAtual ?? 0)}</td>
                    <td>
                      <span className={`app-badge ${p.ativo ? 'app-badge-ok' : 'app-badge-erro'}`}>
                        {p.ativo ? 'sim' : 'nao'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="app-btn-ghost"
                        onClick={() => selecionarParaEditar(p)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
                {produtos.length === 0 && !carregando && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--text-muted)', paddingTop: 8 }}>
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="app-card">
            <h2>{editandoId ? 'Editar produto' : 'Novo produto'}</h2>

            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                <span className="app-label">Descricao *</span>
                <input
                  type="text"
                  value={form.descricao}
                  onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                  className="app-input"
                />
              </label>

              <label>
                <span className="app-label">Descricao curta (PDV, opcional)</span>
                <input
                  type="text"
                  value={form.descricaoPdv}
                  onChange={(e) => setForm((f) => ({ ...f, descricaoPdv: e.target.value }))}
                  className="app-input"
                />
              </label>

              <label>
                <span className="app-label">EAN (codigo de barras, opcional)</span>
                <input
                  type="text"
                  value={form.ean}
                  onChange={(e) => setForm((f) => ({ ...f, ean: e.target.value }))}
                  className="app-input"
                />
              </label>

              <div className="app-grid-2">
                <label>
                  <span className="app-label">Unidade</span>
                  <select
                    value={form.unidade}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, unidade: e.target.value as 'UN' | 'KG' | 'L' }))
                    }
                    className="app-input"
                  >
                    <option value="UN">UN</option>
                    <option value="KG">KG</option>
                    <option value="L">L</option>
                  </select>
                </label>
                <label>
                  <span className="app-label">Categoria</span>
                  <select
                    value={form.categoriaId}
                    onChange={(e) => setForm((f) => ({ ...f, categoriaId: e.target.value }))}
                    className="app-input"
                  >
                    <option value="">Sem categoria</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Nova categoria"
                  value={novaCategoriaNome}
                  onChange={(e) => setNovaCategoriaNome(e.target.value)}
                  className="app-input"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="app-btn-outline"
                  onClick={() => void adicionarCategoria()}
                >
                  Adicionar
                </button>
              </div>

              <div className="app-grid-2">
                <label>
                  <span className="app-label">Preco de venda (R$) *</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.precoVendaTexto}
                    onChange={(e) => setForm((f) => ({ ...f, precoVendaTexto: e.target.value }))}
                    className="app-input"
                  />
                </label>
                <label>
                  <span className="app-label">Custo medio (R$)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.custoMedioTexto}
                    onChange={(e) => setForm((f) => ({ ...f, custoMedioTexto: e.target.value }))}
                    className="app-input"
                  />
                </label>
              </div>

              <div className="app-grid-2">
                <label>
                  <span className="app-label">Estoque minimo</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.estoqueMinimoTexto}
                    onChange={(e) => setForm((f) => ({ ...f, estoqueMinimoTexto: e.target.value }))}
                    className="app-input"
                  />
                </label>
                {!editandoId && (
                  <label>
                    <span className="app-label">Estoque inicial</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.estoqueInicialTexto}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, estoqueInicialTexto: e.target.value }))
                      }
                      className="app-input"
                    />
                  </label>
                )}
              </div>

              {editandoId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                    style={{ width: 18, height: 18, accentColor: 'var(--gold)' }}
                  />
                  Produto ativo
                </label>
              )}

              {erroForm && <p className="app-msg-erro">{erroForm}</p>}
              {mensagemOk && <p className="app-msg-ok">{mensagemOk}</p>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void salvar()}
                  disabled={salvando}
                  className="app-btn"
                >
                  {editandoId ? 'Salvar alteracoes' : 'Criar produto'}
                </button>
                {editandoId && (
                  <button type="button" className="app-btn-ghost" onClick={iniciarNovo}>
                    Cancelar edicao
                  </button>
                )}
              </div>
            </div>

            {editandoId && produtoEmEdicao && (
              <div style={{ marginTop: 20, borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                <h2 style={{ fontSize: '.95rem' }}>Movimentar estoque</h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  Saldo atual:{' '}
                  <strong style={{ color: 'var(--text)' }}>
                    {Number(produtoEmEdicao.estoqueAtual ?? 0)}
                  </strong>
                </p>
                <div className="app-pill-group" style={{ marginBottom: 10 }}>
                  {(['entrada', 'perda', 'ajuste'] as const).map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      className="app-pill-btn"
                      aria-pressed={ajusteTipo === tipo}
                      onClick={() => setAjusteTipo(tipo)}
                    >
                      {tipo === 'entrada'
                        ? 'Entrada (recebi mercadoria)'
                        : tipo === 'perda'
                          ? 'Perda/quebra'
                          : 'Ajuste de contagem (+ ou -)'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                  <label style={{ width: 120 }}>
                    <span className="app-label">Quantidade</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ajusteQuantidadeTexto}
                      onChange={(e) => setAjusteQuantidadeTexto(e.target.value)}
                      className="app-input"
                    />
                  </label>
                  <button
                    type="button"
                    className="app-btn"
                    onClick={() => void enviarAjusteEstoque()}
                    disabled={ajustando}
                  >
                    Lancar
                  </button>
                </div>
                <label style={{ display: 'block', marginTop: 10 }}>
                  <span className="app-label">Observacao (opcional)</span>
                  <input
                    type="text"
                    value={ajusteObservacao}
                    onChange={(e) => setAjusteObservacao(e.target.value)}
                    className="app-input"
                  />
                </label>
                {erroAjuste && <p className="app-msg-erro">{erroAjuste}</p>}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
