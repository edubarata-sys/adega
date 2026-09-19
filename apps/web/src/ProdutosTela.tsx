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
 * ou editar um produto pela interface). Layout deliberadamente simples por
 * enquanto (combinado com o dono: ajustar visual depois, na segunda) --
 * o que importa agora e a operacao funcionar: buscar, criar, editar,
 * ativar/desativar, e lancar entrada/perda/ajuste de estoque.
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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 900 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Cadastro de produtos</h1>
        <button type="button" onClick={aoVoltar}>
          Voltar ao PDV
        </button>
      </header>
      <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
        Layout provisorio -- vamos ajustar o visual depois. O que importa agora e cadastrar, editar
        e mexer no estoque funcionando.
      </p>

      <section style={{ display: 'flex', gap: 32, marginTop: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <h2>Produtos</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Buscar por descricao"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void carregarProdutos(termo)
              }}
              style={{ flex: 1 }}
            />
            <button type="button" onClick={() => void carregarProdutos(termo)}>
              Buscar
            </button>
            <button type="button" onClick={iniciarNovo}>
              + Novo produto
            </button>
          </div>
          {carregando && <p>Carregando...</p>}
          {erroLista && <p style={{ color: '#dc2626' }}>{erroLista}</p>}

          <table
            style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: '0.9rem' }}
          >
            <thead>
              <tr style={{ textAlign: 'left' }}>
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
                  style={{
                    borderTop: '1px solid #e5e7eb',
                    opacity: p.ativo ? 1 : 0.5,
                    background: p.id === editandoId ? '#f0fdf4' : undefined,
                  }}
                >
                  <td>{p.descricao}</td>
                  <td>{p.ean ?? '-'}</td>
                  <td>{formatarBRL(centavos(p.precoVenda))}</td>
                  <td>{Number(p.estoqueAtual ?? 0)}</td>
                  <td>{p.ativo ? 'sim' : 'nao'}</td>
                  <td>
                    <button type="button" onClick={() => selecionarParaEditar(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {produtos.length === 0 && !carregando && (
                <tr>
                  <td colSpan={6} style={{ color: '#6b7280', paddingTop: 8 }}>
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ flex: 1, minWidth: 320 }}>
          <h2>{editandoId ? 'Editar produto' : 'Novo produto'}</h2>

          <label>
            Descricao *
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <label>
            Descricao curta (PDV, opcional)
            <input
              type="text"
              value={form.descricaoPdv}
              onChange={(e) => setForm((f) => ({ ...f, descricaoPdv: e.target.value }))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <label>
            EAN (codigo de barras, opcional)
            <input
              type="text"
              value={form.ean}
              onChange={(e) => setForm((f) => ({ ...f, ean: e.target.value }))}
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1 }}>
              Unidade
              <select
                value={form.unidade}
                onChange={(e) =>
                  setForm((f) => ({ ...f, unidade: e.target.value as 'UN' | 'KG' | 'L' }))
                }
                style={{ display: 'block', width: '100%' }}
              >
                <option value="UN">UN</option>
                <option value="KG">KG</option>
                <option value="L">L</option>
              </select>
            </label>
            <label style={{ flex: 2 }}>
              Categoria
              <select
                value={form.categoriaId}
                onChange={(e) => setForm((f) => ({ ...f, categoriaId: e.target.value }))}
                style={{ display: 'block', width: '100%' }}
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
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              type="text"
              placeholder="Nova categoria"
              value={novaCategoriaNome}
              onChange={(e) => setNovaCategoriaNome(e.target.value)}
              style={{ flex: 1, fontSize: '0.85rem' }}
            />
            <button
              type="button"
              onClick={() => void adicionarCategoria()}
              style={{ fontSize: '0.85rem' }}
            >
              Adicionar categoria
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label style={{ flex: 1 }}>
              Preco de venda (R$) *
              <input
                type="text"
                inputMode="decimal"
                value={form.precoVendaTexto}
                onChange={(e) => setForm((f) => ({ ...f, precoVendaTexto: e.target.value }))}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
            <label style={{ flex: 1 }}>
              Custo medio (R$)
              <input
                type="text"
                inputMode="decimal"
                value={form.custoMedioTexto}
                onChange={(e) => setForm((f) => ({ ...f, custoMedioTexto: e.target.value }))}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label style={{ flex: 1 }}>
              Estoque minimo
              <input
                type="text"
                inputMode="decimal"
                value={form.estoqueMinimoTexto}
                onChange={(e) => setForm((f) => ({ ...f, estoqueMinimoTexto: e.target.value }))}
                style={{ display: 'block', width: '100%' }}
              />
            </label>
            {!editandoId && (
              <label style={{ flex: 1 }}>
                Estoque inicial
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.estoqueInicialTexto}
                  onChange={(e) => setForm((f) => ({ ...f, estoqueInicialTexto: e.target.value }))}
                  style={{ display: 'block', width: '100%' }}
                />
              </label>
            )}
          </div>

          {editandoId && (
            <label style={{ display: 'block', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              />{' '}
              Produto ativo
            </label>
          )}

          {erroForm && <p style={{ color: '#dc2626' }}>{erroForm}</p>}
          {mensagemOk && <p style={{ color: '#16a34a' }}>{mensagemOk}</p>}

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void salvar()} disabled={salvando}>
              {editandoId ? 'Salvar alteracoes' : 'Criar produto'}
            </button>
            {editandoId && (
              <button type="button" onClick={iniciarNovo}>
                Cancelar edicao
              </button>
            )}
          </div>

          {editandoId && produtoEmEdicao && (
            <div style={{ marginTop: 24, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <h3>Movimentar estoque</h3>
              <p>
                Saldo atual: <strong>{Number(produtoEmEdicao.estoqueAtual ?? 0)}</strong>
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <label>
                  Tipo
                  <select
                    value={ajusteTipo}
                    onChange={(e) =>
                      setAjusteTipo(e.target.value as 'entrada' | 'perda' | 'ajuste')
                    }
                    style={{ display: 'block' }}
                  >
                    <option value="entrada">Entrada (recebi mercadoria)</option>
                    <option value="perda">Perda/quebra</option>
                    <option value="ajuste">Ajuste de contagem (+ ou -)</option>
                  </select>
                </label>
                <label>
                  Quantidade
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ajusteQuantidadeTexto}
                    onChange={(e) => setAjusteQuantidadeTexto(e.target.value)}
                    style={{ display: 'block', width: 100 }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void enviarAjusteEstoque()}
                  disabled={ajustando}
                >
                  Lancar
                </button>
              </div>
              <label>
                Observacao (opcional)
                <input
                  type="text"
                  value={ajusteObservacao}
                  onChange={(e) => setAjusteObservacao(e.target.value)}
                  style={{ display: 'block', width: '100%' }}
                />
              </label>
              {erroAjuste && <p style={{ color: '#dc2626' }}>{erroAjuste}</p>}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
