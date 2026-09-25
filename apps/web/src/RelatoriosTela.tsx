import { centavos, dataLojaIso, formatarBRL } from '@adega/core'
import { useEffect, useMemo, useState } from 'react'
import { buscarRelatorioResumo, ErroRequisicao, type RelatorioResumoApi } from './api'
import { TopoApp } from './TopoApp'

interface Props {
  readonly aoVoltar: () => void
}

type Atalho = 'hoje' | 'ontem' | 'semana' | 'mes' | 'personalizado'
type OrdemProdutos = 'quantidade' | 'faturamento' | 'lucro' | 'margem'

const NOMES_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  debito: 'Debito',
  credito: 'Credito',
  voucher: 'Voucher',
}
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

function brl(valor: number): string {
  return formatarBRL(centavos(Math.round(valor)))
}

/** Soma dias numa data AAAA-MM-DD (meio-dia UTC: sem risco de virar o dia). */
function somarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function diaDaSemana(dataIso: string): number {
  return new Date(`${dataIso}T12:00:00Z`).getUTCDay()
}

function periodoDoAtalho(atalho: Exclude<Atalho, 'personalizado'>): [string, string] {
  const hoje = dataLojaIso()
  if (atalho === 'hoje') return [hoje, hoje]
  if (atalho === 'ontem') {
    const ontem = somarDias(hoje, -1)
    return [ontem, ontem]
  }
  if (atalho === 'semana') {
    // Semana comercial: segunda ate hoje.
    const recuo = (diaDaSemana(hoje) + 6) % 7
    return [somarDias(hoje, -recuo), hoje]
  }
  return [`${hoje.slice(0, 8)}01`, hoje]
}

function formatarData(dataIso: string): string {
  const [a, m, d] = dataIso.split('-')
  return `${d}/${m}/${a}`
}

function formatarQtd(q: number): string {
  return q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

/**
 * Relatorios gerenciais do PDV (pedido do cliente 25/09): periodo livre ou
 * atalhos (hoje, ontem, semana, mes), resumo com lucro/margem, caixa por dia,
 * por forma de pagamento/maquininha e ranking de produtos.
 * Lucro usa o custo cadastrado do produto (ver /relatorios/resumo).
 */
export function RelatoriosTela({ aoVoltar }: Props) {
  const [atalho, setAtalho] = useState<Atalho>('hoje')
  const [inicio, setInicio] = useState(() => periodoDoAtalho('hoje')[0])
  const [fim, setFim] = useState(() => periodoDoAtalho('hoje')[1])
  const [dados, setDados] = useState<RelatorioResumoApi | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<OrdemProdutos>('quantidade')
  const [filtroProduto, setFiltroProduto] = useState('')

  async function carregar(de: string, ate: string) {
    setCarregando(true)
    setErro(null)
    try {
      setDados(await buscarRelatorioResumo(de, ate))
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao carregar o relatorio.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar(inicio, fim)
    // So no primeiro carregamento; depois, pelos botoes.
  }, [])

  function escolherAtalho(a: Exclude<Atalho, 'personalizado'>) {
    const [de, ate] = periodoDoAtalho(a)
    setAtalho(a)
    setInicio(de)
    setFim(ate)
    void carregar(de, ate)
  }

  const produtosOrdenados = useMemo(() => {
    if (!dados) return []
    const termo = filtroProduto.trim().toLowerCase()
    const lista = dados.produtos.filter((p) => !termo || p.descricao.toLowerCase().includes(termo))
    const valor = (p: RelatorioResumoApi['produtos'][number]) =>
      ordem === 'quantidade'
        ? p.quantidade
        : ordem === 'faturamento'
          ? p.faturamento
          : ordem === 'lucro'
            ? (p.lucro ?? -Infinity)
            : (p.margem ?? -Infinity)
    return [...lista].sort((a, b) => valor(b) - valor(a))
  }, [dados, ordem, filtroProduto])

  const maiorDia = dados ? Math.max(1, ...dados.porDia.map((d) => d.total)) : 1
  const totalPagamentos = dados ? dados.porPagamento.reduce((s, p) => s + p.valor, 0) : 0
  const r = dados?.resumo

  return (
    <div className="app">
      <TopoApp titulo="Relatorios">
        <button type="button" className="app-btn-outline" onClick={aoVoltar}>
          Voltar ao caixa
        </button>
      </TopoApp>

      <main className="app-shell" style={{ maxWidth: 1180 }}>
        {/* Periodo */}
        <div className="app-card">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            <div className="app-pill-group">
              {(
                [
                  ['hoje', 'Hoje'],
                  ['ontem', 'Ontem'],
                  ['semana', 'Esta semana'],
                  ['mes', 'Este mes'],
                ] as const
              ).map(([chave, rotulo]) => (
                <button
                  key={chave}
                  type="button"
                  className="app-pill-btn"
                  aria-pressed={atalho === chave}
                  onClick={() => escolherAtalho(chave)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <label>
              <span className="app-label">De</span>
              <input
                type="date"
                className="app-input"
                value={inicio}
                onChange={(e) => {
                  setInicio(e.target.value)
                  setAtalho('personalizado')
                }}
              />
            </label>
            <label>
              <span className="app-label">Ate</span>
              <input
                type="date"
                className="app-input"
                value={fim}
                onChange={(e) => {
                  setFim(e.target.value)
                  setAtalho('personalizado')
                }}
              />
            </label>
            <button
              type="button"
              className="app-btn"
              disabled={carregando || !inicio || !fim}
              onClick={() => void carregar(inicio, fim)}
            >
              {carregando ? 'Carregando...' : 'Ver relatorio'}
            </button>
          </div>
          {dados && (
            <p style={{ color: 'var(--text-muted)', margin: '10px 0 0' }}>
              Periodo: {formatarData(dados.inicio)}
              {dados.fim !== dados.inicio ? ` a ${formatarData(dados.fim)}` : ''}
            </p>
          )}
          {erro && <p className="app-msg-erro">{erro}</p>}
        </div>

        {r && dados && (
          <>
            {/* Resumo */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 12,
                marginTop: 12,
              }}
            >
              <Cartao rotulo="Total vendido" valor={brl(r.totalVendido)} destaque />
              <Cartao rotulo="Vendas" valor={String(r.quantidadeVendas)} />
              <Cartao rotulo="Ticket medio" valor={brl(r.ticketMedio)} />
              <Cartao rotulo="Custo (produtos com custo)" valor={brl(r.custoTotal)} />
              <Cartao rotulo="Lucro estimado" valor={brl(r.lucro)} destaque />
              <Cartao
                rotulo="Margem media"
                valor={r.margem === null ? '-' : `${r.margem.toLocaleString('pt-BR')}%`}
              />
            </div>
            {(r.produtosSemCusto > 0 || dados.cadastro.produtosAtivosSemCusto > 0) && (
              <p className="app-aviso" style={{ marginTop: 12 }}>
                Lucro e margem contam so os produtos com custo cadastrado.
                {r.produtosSemCusto > 0 &&
                  ` Neste periodo, ${r.produtosSemCusto} produto(s) vendido(s) sem custo somaram ${brl(r.faturamentoSemCusto)} e ficaram fora da conta.`}
                {` No cadastro, ${dados.cadastro.produtosAtivosSemCusto} de ${dados.cadastro.produtosAtivos} produtos ativos ainda estao sem custo.`}
              </p>
            )}

            <div
              className="app-grid-2 app-grid-2col"
              style={{ alignItems: 'start', marginTop: 12 }}
            >
              {/* Caixa por dia */}
              <div className="app-card">
                <h2 style={{ marginTop: 0 }}>Caixa por dia</h2>
                {dados.porDia.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>Nenhuma venda no periodo.</p>
                ) : (
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Dia</th>
                        <th style={{ textAlign: 'right' }}>Vendas</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.porDia.map((d) => (
                        <tr key={d.data}>
                          <td>
                            {DIAS_SEMANA[diaDaSemana(d.data)]} {formatarData(d.data).slice(0, 5)}
                            <div
                              style={{
                                height: 6,
                                marginTop: 4,
                                borderRadius: 3,
                                background: 'var(--gold, #f2b705)',
                                width: `${Math.max(3, (d.total / maiorDia) * 100)}%`,
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>{d.vendas}</td>
                          <td style={{ textAlign: 'right' }}>{brl(d.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Por forma de pagamento */}
              <div className="app-card">
                <h2 style={{ marginTop: 0 }}>Por forma de pagamento</h2>
                {dados.porPagamento.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>Nenhum pagamento no periodo.</p>
                ) : (
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Forma</th>
                        <th style={{ textAlign: 'right' }}>Qtd</th>
                        <th style={{ textAlign: 'right' }}>Valor</th>
                        <th style={{ textAlign: 'right' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.porPagamento.map((p) => (
                        <tr key={`${p.forma}|${p.maquininha ?? ''}`}>
                          <td>
                            {NOMES_FORMA[p.forma] ?? p.forma}
                            {p.maquininha ? ` - ${p.maquininha}` : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>{p.quantidade}</td>
                          <td style={{ textAlign: 'right' }}>{brl(p.valor)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {totalPagamentos
                              ? `${Math.round((p.valor / totalPagamentos) * 100)}%`
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Produtos */}
            <div className="app-card" style={{ marginTop: 12 }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <h2 style={{ margin: 0 }}>Produtos vendidos ({dados.produtos.length})</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    className="app-input"
                    placeholder="Filtrar produto"
                    value={filtroProduto}
                    onChange={(e) => setFiltroProduto(e.target.value)}
                    style={{ width: 200 }}
                  />
                  <div className="app-pill-group">
                    {(
                      [
                        ['quantidade', 'Mais vendidos'],
                        ['faturamento', 'Faturamento'],
                        ['lucro', 'Lucro'],
                        ['margem', 'Margem'],
                      ] as const
                    ).map(([chave, rotulo]) => (
                      <button
                        key={chave}
                        type="button"
                        className="app-pill-btn"
                        aria-pressed={ordem === chave}
                        onClick={() => setOrdem(chave)}
                      >
                        {rotulo}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {produtosOrdenados.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Nenhum produto vendido no periodo.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="app-table" style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Produto</th>
                        <th style={{ textAlign: 'right' }}>Qtd</th>
                        <th style={{ textAlign: 'right' }}>Faturamento</th>
                        <th style={{ textAlign: 'right' }}>Custo</th>
                        <th style={{ textAlign: 'right' }}>Lucro</th>
                        <th style={{ textAlign: 'right' }}>Margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosOrdenados.map((p, i) => (
                        <tr key={p.produtoId}>
                          <td>{i + 1}</td>
                          <td>{p.descricao}</td>
                          <td style={{ textAlign: 'right' }}>{formatarQtd(p.quantidade)}</td>
                          <td style={{ textAlign: 'right' }}>{brl(p.faturamento)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {p.custo === null ? (
                              <span style={{ color: 'var(--text-muted)' }}>sem custo</span>
                            ) : (
                              brl(p.custo)
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {p.lucro === null ? '-' : brl(p.lucro)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {p.margem === null ? '-' : `${p.margem.toLocaleString('pt-BR')}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Cartao({
  rotulo,
  valor,
  destaque,
}: {
  readonly rotulo: string
  readonly valor: string
  readonly destaque?: boolean
}) {
  return (
    <div className="app-card" style={{ margin: 0 }}>
      <p className="app-label" style={{ margin: 0 }}>
        {rotulo}
      </p>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: destaque ? 26 : 22,
          fontWeight: 700,
          color: destaque ? 'var(--gold, #f2b705)' : undefined,
        }}
      >
        {valor}
      </p>
    </div>
  )
}
