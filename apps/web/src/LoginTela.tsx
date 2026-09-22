import { useEffect, useState } from 'react'
import logoAdega from './assets/logo-adega-dois-irmaos.jpg'
import { ErroRequisicao, listarOperadores, login, loginComPin, type UsuarioSessao } from './api'

interface Props {
  readonly aoAutenticar: (usuario: UsuarioSessao) => void
}

/**
 * Duas formas de entrar (arquitetura §4): admin com email/senha (sessao
 * longa, 30 dias) ou operador com PIN sobre a lista de operadores ativos
 * (troca de turno rapida no balcao, sem digitar email). Nao ha cadastro de
 * usuario aqui -- isso e tarefa do admin, fora do escopo desta tela de PDV.
 */
export function LoginTela({ aoAutenticar }: Props) {
  const [modo, setModo] = useState<'admin' | 'operador'>('operador')

  return (
    <main className="app app-shell-estreito">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <img
          src={logoAdega}
          alt="Adega Dois Irmaos"
          style={{
            width: 88,
            height: 88,
            borderRadius: 16,
            boxShadow: '0 0 0 3px var(--gold), 0 8px 24px rgba(0,0,0,.5)',
            objectFit: 'cover',
          }}
        />
        <p className="app-eyebrow" style={{ marginTop: 14 }}>
          Adega Dois Irmaos
        </p>
        <h1 style={{ margin: '4px 0 0', fontSize: '1.4rem' }}>Sistema da Adega</h1>
      </div>

      <div className="app-toggle-grupo">
        <button
          type="button"
          className="app-toggle"
          aria-pressed={modo === 'operador'}
          onClick={() => setModo('operador')}
        >
          Operador (PIN)
        </button>
        <button
          type="button"
          className="app-toggle"
          aria-pressed={modo === 'admin'}
          onClick={() => setModo('admin')}
        >
          Admin (email/senha)
        </button>
      </div>

      <div className="app-card">
        {modo === 'admin' ? (
          <LoginAdmin aoAutenticar={aoAutenticar} />
        ) : (
          <LoginOperador aoAutenticar={aoAutenticar} />
        )}
      </div>
    </main>
  )
}

function LoginAdmin({ aoAutenticar }: Props) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const { usuario } = await login(email, senha)
      aoAutenticar(usuario)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao entrar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 14 }}>
      <label>
        <span className="app-label">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="app-input"
        />
      </label>
      <label>
        <span className="app-label">Senha</span>
        <input
          type="password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="app-input"
        />
      </label>
      <button type="submit" disabled={enviando} className="app-btn app-btn-grande">
        {enviando ? 'Entrando...' : 'Entrar'}
      </button>
      {erro && <p className="app-msg-erro">{erro}</p>}
    </form>
  )
}

function LoginOperador({ aoAutenticar }: Props) {
  const [operadores, setOperadores] = useState<Array<{ id: string; nome: string }> | null>(null)
  const [usuarioId, setUsuarioId] = useState('')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let cancelado = false
    void listarOperadores().then((r) => {
      if (cancelado) return
      setOperadores(r.operadores)
      if (r.operadores.length > 0) setUsuarioId(r.operadores[0]!.id)
    })
    return () => {
      cancelado = true
    }
  }, [])

  if (operadores === null) {
    return <p>Carregando operadores...</p>
  }

  async function enviar(pinFinal: string) {
    setErro(null)
    setEnviando(true)
    try {
      const { usuario } = await loginComPin(usuarioId, pinFinal)
      aoAutenticar(usuario)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao entrar.')
      setPin('')
    } finally {
      setEnviando(false)
    }
  }

  function apertarTecla(tecla: string) {
    if (enviando) return
    setErro(null)
    setPin((atual) => (atual.length >= 8 ? atual : atual + tecla))
  }

  function apagar() {
    if (enviando) return
    setPin((atual) => atual.slice(0, -1))
  }

  if (operadores.length === 0) {
    return <p>Nenhum operador cadastrado ainda -- peca ao admin para cadastrar um.</p>
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void enviar(pin)
      }}
      style={{ display: 'grid', gap: 14 }}
    >
      <div>
        <span className="app-label">Operador</span>
        <div className="app-pill-group">
          {operadores.map((o) => (
            <button
              key={o.id}
              type="button"
              className="app-pill-btn"
              aria-pressed={usuarioId === o.id}
              onClick={() => setUsuarioId(o.id)}
            >
              {o.nome}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="app-label">PIN</span>
        {/* Input real mantido (acessibilidade, colar PIN, teclado fisico) --
            o teclado abaixo e um atalho visual, nao a unica forma de digitar. */}
        <input
          type="password"
          inputMode="numeric"
          required
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="app-input app-pin-display"
          style={{ color: 'var(--gold)' }}
        />
        <div className="app-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <button key={n} type="button" onClick={() => apertarTecla(n)}>
              {n}
            </button>
          ))}
          <button type="button" onClick={apagar}>
            ⌫
          </button>
          <button type="button" onClick={() => apertarTecla('0')}>
            0
          </button>
          <button type="button" onClick={() => setPin('')}>
            C
          </button>
        </div>
      </div>

      <button type="submit" disabled={enviando} className="app-btn app-btn-grande">
        {enviando ? 'Entrando...' : 'Entrar'}
      </button>
      {erro && <p className="app-msg-erro">{erro}</p>}
    </form>
  )
}
