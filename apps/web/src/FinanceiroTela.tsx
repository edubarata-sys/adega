import {
  centavos,
  dataLojaIso,
  formatarBRL,
  interpretarComandoFinanceiro,
  interpretarValorEmCentavos,
} from '@adega/core'
import { useCallback, useEffect, useState } from 'react'
import {
  apagarLancamentoFinanceiro,
  buscarResumoFinanceiro,
  criarContaFinanceira,
  ErroRequisicao,
  lancarFinanceiro,
  pagarContaFinanceira,
  removerContaFinanceira,
  type ContaPendenteApi,
  type GrupoFinanceiro,
  type ResumoFinanceiroApi,
} from './api'
import { TopoApp } from './TopoApp'
import { construtorReconhecimentoDeVoz, type ResultadoReconhecimentoVoz } from './voz'

type Aba = 'resumo' | 'lancar' | 'contas' | 'historico'

const ROTULO_GRUPO: Record<GrupoFinanceiro, string> = {
  adega: 'Adega',
  casa: 'Casa',
  outros: 'Outros',
}

const ROTULO_SITUACAO = {
  vencida: 'Vencida',
  'vence-hoje': 'Vence hoje',
  'a-vencer': 'A vencer',
} as const

function brl(valor: number): string {
  return formatarBRL(centavos(valor))
}

function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

function mensagemErro(e: unknown, padrao: string): string {
  return e instanceof ErroRequisicao ? e.message : padrao
}

/** Tela cheia (computador): cabecalho + voltar. */
export function FinanceiroTela({ aoVoltar }: { readonly aoVoltar: () => void }) {
  return (
    <div className="app">
      <TopoApp titulo="Financeiro pessoal">
        <button type="button" className="app-btn-ghost" onClick={aoVoltar}>
          Voltar
        </button>
      </TopoApp>
      <main className="app-shell" style={{ maxWidth: 760 }}>
        <div className="app-card">
          <ConteudoFinanceiro />
        </div>
      </main>
    </div>
  )
}

/**
 * Financeiro pessoal do dono (so admin). Entrada da adega chega sozinha a
 * cada caixa fechado; gastos sao Casa ou Adega; boletos e fixos ficam "a
 * pagar" ate ele tocar em Paguei. Mesmo conteudo no celular (aba do
 * /mobile) e no computador (tela cheia).
 */
export function ConteudoFinanceiro() {
  const [aba, setAba] = useState<Aba>('resumo')
  const [mes, setMes] = useState(() => dataLojaIso().slice(0, 7))
  const [resumo, setResumo] = useState<ResumoFinanceiroApi | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setResumo(await buscarResumoFinanceiro(mes))
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao carregar o financeiro.'))
    } finally {
      setCarregando(false)
    }
  }, [mes])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: '1 1 auto' }}>Financeiro pessoal</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="app-label">Mes</span>
          <input
            type="month"
            className="app-input"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
          />
        </label>
      </div>

      <div className="app-pill-group" role="group" aria-label="Secao do financeiro">
        {(
          [
            ['resumo', 'Resumo'],
            ['lancar', 'Lancar'],
            ['contas', 'Contas'],
            ['historico', 'Historico'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className="app-pill-btn"
            aria-pressed={aba === chave}
            onClick={() => setAba(chave)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {erro && <p className="app-msg-erro">{erro}</p>}
      {carregando && !resumo && <p>Carregando...</p>}

      {resumo && aba === 'resumo' && <AbaResumo resumo={resumo} aoMudar={recarregar} />}
      {aba === 'lancar' && <AbaLancar aoLancar={recarregar} />}
      {resumo && aba === 'contas' && <AbaContas resumo={resumo} aoMudar={recarregar} />}
      {resumo && aba === 'historico' && <AbaHistorico resumo={resumo} aoMudar={recarregar} />}
    </div>
  )
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  readonly rotulo: string
  readonly valor: number
  readonly detalhe?: string
  readonly destaque?: boolean
}) {
  return (
    <div className="app-card app-card-compacto" style={{ margin: 0 }}>
      <p className="app-label" style={{ margin: 0 }}>
        {rotulo}
      </p>
      <p
        style={{
          margin: '4px 0 0',
          fontSize: destaque ? 26 : 20,
          fontWeight: 700,
          color: valor < 0 ? 'var(--danger, #c0392b)' : undefined,
        }}
      >
        {brl(valor)}
      </p>
      {detalhe && (
        <p className="app-label" style={{ margin: '4px 0 0' }}>
          {detalhe}
        </p>
      )}
    </div>
  )
}

function AbaResumo({
  resumo,
  aoMudar,
}: {
  readonly resumo: ResumoFinanceiroApi
  readonly aoMudar: () => Promise<void>
}) {
  const t = resumo.totais
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="app-grid-2">
        <Cartao
          rotulo="Entrou"
          valor={t.entradas}
          detalhe={`Adega ${brl(t.entradaAdega)} · Outros ${brl(t.entradaOutros)}`}
        />
        <Cartao rotulo="Saldo do mes" valor={t.saldo} destaque />
        <Cartao rotulo="Gastos da adega" valor={t.saidaAdega} />
        <Cartao rotulo="Gastos de casa" valor={t.saidaCasa} />
      </div>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Contas a pagar</h3>
        {resumo.contasPendentes.length === 0 ? (
          <p className="app-aviso">Nenhuma conta pendente neste mes.</p>
        ) : (
          resumo.contasPendentes.map((c) => (
            <ContaPendenteLinha key={`${c.contaId}-${c.competencia}`} conta={c} aoPagar={aoMudar} />
          ))
        )}
      </section>
    </div>
  )
}

function ContaPendenteLinha({
  conta,
  aoPagar,
}: {
  readonly conta: ContaPendenteApi
  readonly aoPagar: () => Promise<void>
}) {
  const [valorTexto, setValorTexto] = useState((conta.valor / 100).toFixed(2).replace('.', ','))
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function pagar() {
    const valor = interpretarValorEmCentavos(valorTexto)
    if (!valor) {
      setErro('Valor invalido.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      await pagarContaFinanceira(conta.contaId, {
        competencia: conta.competencia,
        valor,
        data: dataLojaIso(),
      })
      await aoPagar()
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao marcar como pago.'))
    } finally {
      setEnviando(false)
    }
  }

  const cor =
    conta.situacao === 'vencida'
      ? 'var(--danger, #c0392b)'
      : conta.situacao === 'vence-hoje'
        ? 'var(--gold-dark, #8a6d00)'
        : 'var(--text-muted)'

  return (
    <div
      className="app-card app-card-compacto"
      style={{ margin: 0, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <strong>{conta.descricao}</strong>
        <p className="app-label" style={{ margin: '2px 0 0' }}>
          {ROTULO_GRUPO[conta.grupo]} · {conta.tipo === 'boleto' ? 'Boleto' : 'Fixo'} · vence{' '}
          {dataBr(conta.vencimento)} ·{' '}
          <span style={{ color: cor, fontWeight: 700 }}>{ROTULO_SITUACAO[conta.situacao]}</span>
        </p>
        {erro && <p className="app-msg-erro">{erro}</p>}
      </div>
      <label style={{ display: 'grid', gap: 2, width: 110 }}>
        <span className="app-label">Valor R$</span>
        <input
          className="app-input"
          inputMode="decimal"
          value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)}
        />
      </label>
      <button type="button" className="app-btn" disabled={enviando} onClick={() => void pagar()}>
        {enviando ? 'Salvando...' : 'Paguei'}
      </button>
    </div>
  )
}

function AbaLancar({ aoLancar }: { readonly aoLancar: () => Promise<void> }) {
  const [tipo, setTipo] = useState<'saida' | 'entrada'>('saida')
  const [grupo, setGrupo] = useState<'casa' | 'adega'>('casa')
  const [valorTexto, setValorTexto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [data, setData] = useState(dataLojaIso())
  const [porVoz, setPorVoz] = useState(false)
  const [suportaVoz] = useState(() => construtorReconhecimentoDeVoz() !== null)
  const [ouvindo, setOuvindo] = useState(false)
  const [falado, setFalado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function aplicarComando(texto: string) {
    const r = interpretarComandoFinanceiro(texto)
    setTipo('saida')
    if (r.grupo) setGrupo(r.grupo)
    if (r.valor) setValorTexto((r.valor / 100).toFixed(2).replace('.', ','))
    if (r.descricao) setDescricao(r.descricao)
    setPorVoz(true)
    setOk(null)
    if (!r.grupo || !r.valor) {
      setErro('Confira os campos: fale "casa, 80, mercado" ou "adega, 300, gelo".')
    } else {
      setErro(null)
    }
  }

  function falar() {
    const Construtor = construtorReconhecimentoDeVoz()
    if (!Construtor) return
    setErro(null)
    setOk(null)
    const rec = new Construtor()
    rec.lang = 'pt-BR'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (evento: ResultadoReconhecimentoVoz) => {
      const texto = String(evento.results[0]?.[0]?.transcript ?? '')
      setFalado(texto)
      aplicarComando(texto)
    }
    rec.onerror = () => {
      setOuvindo(false)
      setErro('Nao consegui ouvir -- tenta de novo ou digita abaixo.')
    }
    rec.onend = () => setOuvindo(false)
    setOuvindo(true)
    rec.start()
  }

  async function salvar() {
    const valor = interpretarValorEmCentavos(valorTexto)
    if (!valor) {
      setErro('Informe o valor (ex.: 80 ou 12,50).')
      return
    }
    if (!descricao.trim()) {
      setErro('Informe a descricao.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const grupoFinal: GrupoFinanceiro = tipo === 'entrada' ? 'outros' : grupo
      await lancarFinanceiro({
        tipo,
        grupo: grupoFinal,
        valor,
        descricao: descricao.trim(),
        data,
        origem: porVoz ? 'voz' : 'manual',
      })
      setOk(
        `${tipo === 'entrada' ? 'Entrada' : `Gasto (${ROTULO_GRUPO[grupoFinal]})`} de ${brl(valor)} salvo.`,
      )
      setValorTexto('')
      setDescricao('')
      setFalado('')
      setPorVoz(false)
      await aoLancar()
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao salvar.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="app-toggle-grupo" style={{ marginBottom: 0 }}>
        <button
          type="button"
          className="app-toggle"
          aria-pressed={tipo === 'saida'}
          onClick={() => setTipo('saida')}
        >
          Gasto
        </button>
        <button
          type="button"
          className="app-toggle"
          aria-pressed={tipo === 'entrada'}
          onClick={() => setTipo('entrada')}
        >
          Entrada de fora
        </button>
      </div>

      {tipo === 'saida' && suportaVoz && (
        <>
          <button
            type="button"
            className={`mobile-mic-btn${ouvindo ? ' ouvindo' : ''}`}
            onClick={falar}
            disabled={ouvindo}
          >
            <span className="mobile-mic-icone">{'\u{1F3A4}'}</span>
            {ouvindo ? 'Ouvindo...' : 'Falar o gasto'}
          </button>
          <p className="app-label" style={{ margin: 0 }}>
            Fale assim: <strong>casa, 80, mercado</strong> ou <strong>adega, 300, gelo</strong>.
            {falado && <> Ouvi: "{falado}"</>}
          </p>
        </>
      )}

      {tipo === 'saida' && (
        <div className="app-toggle-grupo" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={grupo === 'casa'}
            onClick={() => setGrupo('casa')}
          >
            Casa
          </button>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={grupo === 'adega'}
            onClick={() => setGrupo('adega')}
          >
            Adega
          </button>
        </div>
      )}

      <div className="app-grid-2">
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="app-label">Valor (R$)</span>
          <input
            className="app-input app-input-lg"
            inputMode="decimal"
            placeholder="0,00"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="app-label">Data</span>
          <input
            type="date"
            className="app-input"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="app-label">Descricao</span>
        <input
          className="app-input"
          placeholder={tipo === 'entrada' ? 'Ex.: seguro-desemprego' : 'Ex.: mercado'}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </label>

      {erro && <p className="app-msg-erro">{erro}</p>}
      {ok && <p className="app-msg-ok">{ok}</p>}

      <button
        type="button"
        className="app-btn app-btn-grande"
        disabled={enviando}
        onClick={() => void salvar()}
      >
        {enviando ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  )
}

function AbaContas({
  resumo,
  aoMudar,
}: {
  readonly resumo: ResumoFinanceiroApi
  readonly aoMudar: () => Promise<void>
}) {
  const [tipo, setTipo] = useState<'fixo' | 'boleto'>('fixo')
  const [grupo, setGrupo] = useState<'casa' | 'adega'>('casa')
  const [descricao, setDescricao] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [dia, setDia] = useState('10')
  const [vencimento, setVencimento] = useState(dataLojaIso())
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function cadastrar() {
    const valor = interpretarValorEmCentavos(valorTexto)
    if (!descricao.trim() || !valor) {
      setErro('Informe descricao e valor.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      await criarContaFinanceira({
        tipo,
        grupo,
        descricao: descricao.trim(),
        valor,
        ...(tipo === 'fixo' ? { diaVencimento: Number(dia) } : { vencimento }),
        ...(codigo.trim() ? { codigoBarras: codigo.trim() } : {}),
      })
      setOk(`${tipo === 'fixo' ? 'Gasto fixo' : 'Boleto'} "${descricao.trim()}" cadastrado.`)
      setDescricao('')
      setValorTexto('')
      setCodigo('')
      await aoMudar()
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao cadastrar.'))
    } finally {
      setEnviando(false)
    }
  }

  async function remover(id: string) {
    try {
      await removerContaFinanceira(id)
      await aoMudar()
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao remover.'))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Nova conta</h3>
        <div className="app-toggle-grupo" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={tipo === 'fixo'}
            onClick={() => setTipo('fixo')}
          >
            Fixo mensal
          </button>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={tipo === 'boleto'}
            onClick={() => setTipo('boleto')}
          >
            Boleto
          </button>
        </div>
        <div className="app-toggle-grupo" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={grupo === 'casa'}
            onClick={() => setGrupo('casa')}
          >
            Casa
          </button>
          <button
            type="button"
            className="app-toggle"
            aria-pressed={grupo === 'adega'}
            onClick={() => setGrupo('adega')}
          >
            Adega
          </button>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="app-label">Descricao</span>
          <input
            className="app-input"
            placeholder={tipo === 'fixo' ? 'Ex.: aluguel, luz, internet' : 'Ex.: Ambev'}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </label>
        <div className="app-grid-2">
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="app-label">Valor (R$)</span>
            <input
              className="app-input"
              inputMode="decimal"
              placeholder="0,00"
              value={valorTexto}
              onChange={(e) => setValorTexto(e.target.value)}
            />
          </label>
          {tipo === 'fixo' ? (
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="app-label">Vence todo dia</span>
              <input
                className="app-input"
                type="number"
                min={1}
                max={31}
                value={dia}
                onChange={(e) => setDia(e.target.value)}
              />
            </label>
          ) : (
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="app-label">Vencimento</span>
              <input
                className="app-input"
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </label>
          )}
        </div>
        {tipo === 'boleto' && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="app-label">Codigo de barras (opcional)</span>
            <input
              className="app-input"
              inputMode="numeric"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          </label>
        )}
        {erro && <p className="app-msg-erro">{erro}</p>}
        {ok && <p className="app-msg-ok">{ok}</p>}
        <button
          type="button"
          className="app-btn"
          disabled={enviando}
          onClick={() => void cadastrar()}
        >
          {enviando ? 'Salvando...' : 'Cadastrar'}
        </button>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Contas cadastradas</h3>
        {resumo.contas.length === 0 && <p className="app-aviso">Nenhuma conta cadastrada.</p>}
        {resumo.contas.map((c) => (
          <div
            key={c.id}
            className="app-card app-card-compacto"
            style={{ margin: 0, display: 'flex', gap: 12, alignItems: 'center' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{c.descricao}</strong>
              <p className="app-label" style={{ margin: '2px 0 0' }}>
                {ROTULO_GRUPO[c.grupo]} · {brl(c.valor)} ·{' '}
                {c.tipo === 'fixo'
                  ? `todo dia ${c.diaVencimento}`
                  : `boleto vence ${c.vencimento ? dataBr(c.vencimento) : '?'}`}
              </p>
            </div>
            <button
              type="button"
              className="app-btn-ghost"
              aria-label={`Remover ${c.descricao}`}
              onClick={() => void remover(c.id)}
            >
              Remover
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}

function AbaHistorico({
  resumo,
  aoMudar,
}: {
  readonly resumo: ResumoFinanceiroApi
  readonly aoMudar: () => Promise<void>
}) {
  const [filtro, setFiltro] = useState<'todos' | GrupoFinanceiro>('todos')
  const [erro, setErro] = useState<string | null>(null)
  const lista = resumo.lancamentos.filter((l) => filtro === 'todos' || l.grupo === filtro)

  async function apagar(id: string) {
    setErro(null)
    try {
      await apagarLancamentoFinanceiro(id)
      await aoMudar()
    } catch (e) {
      setErro(mensagemErro(e, 'Falha ao apagar.'))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="app-pill-group" role="group" aria-label="Filtrar por grupo">
        {(['todos', 'adega', 'casa', 'outros'] as const).map((g) => (
          <button
            key={g}
            type="button"
            className="app-pill-btn"
            aria-pressed={filtro === g}
            onClick={() => setFiltro(g)}
          >
            {g === 'todos' ? 'Todos' : ROTULO_GRUPO[g]}
          </button>
        ))}
      </div>
      {erro && <p className="app-msg-erro">{erro}</p>}
      {lista.length === 0 && <p className="app-aviso">Nada lancado neste mes.</p>}
      {lista.map((l) => (
        <div
          key={l.id}
          className="app-card app-card-compacto"
          style={{ margin: 0, display: 'flex', gap: 12, alignItems: 'center' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{l.descricao}</strong>
            <p className="app-label" style={{ margin: '2px 0 0' }}>
              {dataBr(l.data)} · {ROTULO_GRUPO[l.grupo]}
              {l.origem === 'caixa' ? ' · automatico do caixa' : ''}
              {l.origem === 'voz' ? ' · por voz' : ''}
            </p>
          </div>
          <strong style={{ color: l.tipo === 'saida' ? 'var(--danger, #c0392b)' : undefined }}>
            {l.tipo === 'saida' ? '- ' : '+ '}
            {brl(l.valor)}
          </strong>
          {l.origem !== 'caixa' && (
            <button
              type="button"
              className="app-btn-ghost"
              aria-label={`Apagar ${l.descricao}`}
              onClick={() => void apagar(l.id)}
            >
              Apagar
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
