import { useEffect, useState } from 'react'
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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 420 }}>
      <h1>Sistema da Adega</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" disabled={modo === 'operador'} onClick={() => setModo('operador')}>
          Operador (PIN)
        </button>
        <button type="button" disabled={modo === 'admin'} onClick={() => setModo('admin')}>
          Admin (email/senha)
        </button>
      </div>
      {modo === 'admin' ? (
        <LoginAdmin aoAutenticar={aoAutenticar} />
      ) : (
        <LoginOperador aoAutenticar={aoAutenticar} />
      )}
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
    <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 8 }}>
      <label>
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ display: 'block', width: '100%' }}
        />
      </label>
      <label>
        Senha
        <input
          type="password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={{ display: 'block', width: '100%' }}
        />
      </label>
      <button type="submit" disabled={enviando}>
        {enviando ? 'Entrando...' : 'Entrar'}
      </button>
      {erro && <p style={{ color: '#dc2626' }}>{erro}</p>}
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

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const { usuario } = await loginComPin(usuarioId, pin)
      aoAutenticar(usuario)
    } catch (e) {
      setErro(e instanceof ErroRequisicao ? e.message : 'Falha ao entrar.')
    } finally {
      setEnviando(false)
    }
  }

  if (operadores.length === 0) {
    return <p>Nenhum operador cadastrado ainda -- peca ao admin para cadastrar um.</p>
  }

  return (
    <form onSubmit={(e) => void enviar(e)} style={{ display: 'grid', gap: 8 }}>
      <label>
        Operador
        <select
          value={usuarioId}
          onChange={(e) => setUsuarioId(e.target.value)}
          style={{ display: 'block', width: '100%' }}
        >
          {operadores.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        PIN
        <input
          type="password"
          inputMode="numeric"
          required
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={{ display: 'block', width: '100%' }}
        />
      </label>
      <button type="submit" disabled={enviando}>
        {enviando ? 'Entrando...' : 'Entrar'}
      </button>
      {erro && <p style={{ color: '#dc2626' }}>{erro}</p>}
    </form>
  )
}
