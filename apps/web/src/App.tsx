import { useEffect, useState } from 'react'
import { AbrirCaixaTela } from './AbrirCaixaTela'
import { caixaAtual, eu, type SessaoCaixaApi, type UsuarioSessao } from './api'
import { FecharCaixaTela } from './FecharCaixaTela'
import { LoginTela } from './LoginTela'
import { PainelMobileTela } from './PainelMobileTela'
import { RelatoriosTela } from './RelatoriosTela'
import { EntradaNotaTela } from './EntradaNotaTela'
import { PdvTela } from './PdvTela'
import { ProdutosTela } from './ProdutosTela'

type Estado =
  | { fase: 'carregando' }
  | { fase: 'login' }
  | { fase: 'abrindo-caixa'; usuario: UsuarioSessao }
  | { fase: 'pdv'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi }
  | { fase: 'fechando-caixa'; usuario: UsuarioSessao }
  | { fase: 'entrada-nota'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi }
  | { fase: 'relatorios'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi }
  | { fase: 'produtos'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi; eanInicial?: string }

/**
 * Orquestrador do fluxo ponta a ponta do PDV (PASSO 7 da missao):
 * login -> abertura de caixa (se ainda nao houver uma sessao aberta) -> PDV.
 *
 * Isto NAO e um roteador (nao ha URLs de tela) -- Fase 1 e um unico
 * terminal fazendo uma coisa de cada vez, entao uma maquina de estados
 * simples e suficiente e mais facil de auditar que uma lib de rotas.
 */
/**
 * Painel mobile (HANDOFF.md secao 12): entrada separada em /mobile, fora da
 * maquina de estados do PDV de balcao -- login proprio (reaproveita
 * LoginTela) e depois direto pro painel, sem passar por abertura de caixa.
 * So um `if` de pathname, nao uma lib de router (mesmo raciocinio do
 * comentario da funcao App abaixo: uma unica rota extra nao justifica isso).
 */
function PainelMobileApp() {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    eu()
      .then((r) => {
        if (!cancelado) setUsuario(r.usuario)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (carregando) {
    return (
      <div className="app" style={{ padding: '2rem' }}>
        <p>Carregando...</p>
      </div>
    )
  }

  if (!usuario) {
    return <LoginTela aoAutenticar={setUsuario} />
  }

  return <PainelMobileTela usuario={usuario} aoSair={() => setUsuario(null)} />
}

export function App() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/mobile')) {
    return <PainelMobileApp />
  }
  return <AppPdv />
}

/**
 * Fluxo original do PDV de balcao, renomeado de `App` pra `AppPdv` na hora
 * de introduzir a rota /mobile acima -- precisa ser um componente proprio
 * (nao só um `if` dentro de `App`) porque ele usa hooks (`useState`), e
 * hooks nao podem vir depois de um `return` condicional no mesmo componente
 * (regra das Hooks do React).
 */
function AppPdv() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' })

  useEffect(() => {
    let cancelado = false

    async function iniciar() {
      try {
        const { usuario } = await eu()
        if (cancelado) return
        await avancarAposLogin(usuario)
      } catch {
        if (!cancelado) setEstado({ fase: 'login' })
      }
    }

    async function avancarAposLogin(usuario: UsuarioSessao) {
      const { sessao } = await caixaAtual()
      if (cancelado) return
      setEstado(
        sessao ? { fase: 'pdv', usuario, sessaoCaixa: sessao } : { fase: 'abrindo-caixa', usuario },
      )
    }

    void iniciar()
    return () => {
      cancelado = true
    }
  }, [])

  if (estado.fase === 'carregando') {
    return (
      <div className="app" style={{ padding: '2rem' }}>
        <p>Carregando...</p>
      </div>
    )
  }

  if (estado.fase === 'login') {
    return (
      <LoginTela
        aoAutenticar={(usuario) => {
          setEstado({ fase: 'abrindo-caixa', usuario })
          void caixaAtual().then(({ sessao }) => {
            if (sessao) setEstado({ fase: 'pdv', usuario, sessaoCaixa: sessao })
          })
        }}
      />
    )
  }

  if (estado.fase === 'abrindo-caixa') {
    return (
      <AbrirCaixaTela
        usuario={estado.usuario}
        aoAbrir={(sessaoCaixa) => setEstado({ fase: 'pdv', usuario: estado.usuario, sessaoCaixa })}
      />
    )
  }

  if (estado.fase === 'fechando-caixa') {
    return (
      <FecharCaixaTela
        aoFechar={() => setEstado({ fase: 'abrindo-caixa', usuario: estado.usuario })}
      />
    )
  }

  if (estado.fase === 'entrada-nota') {
    return (
      <EntradaNotaTela
        aoVoltar={() =>
          setEstado({ fase: 'pdv', usuario: estado.usuario, sessaoCaixa: estado.sessaoCaixa })
        }
      />
    )
  }

  if (estado.fase === 'relatorios') {
    return (
      <RelatoriosTela
        aoVoltar={() =>
          setEstado({ fase: 'pdv', usuario: estado.usuario, sessaoCaixa: estado.sessaoCaixa })
        }
      />
    )
  }

  if (estado.fase === 'produtos') {
    return (
      <ProdutosTela
        eanInicial={estado.eanInicial}
        aoVoltar={() =>
          setEstado({ fase: 'pdv', usuario: estado.usuario, sessaoCaixa: estado.sessaoCaixa })
        }
      />
    )
  }

  return (
    <PdvTela
      operadorNome={estado.usuario.nome}
      aoQuererFecharCaixa={() => setEstado({ fase: 'fechando-caixa', usuario: estado.usuario })}
      aoQuererEntradaNota={
        estado.usuario.perfil === 'admin'
          ? () =>
              setEstado({
                fase: 'entrada-nota',
                usuario: estado.usuario,
                sessaoCaixa: estado.sessaoCaixa,
              })
          : undefined
      }
      aoQuererRelatorios={
        estado.usuario.perfil === 'admin'
          ? () =>
              setEstado({
                fase: 'relatorios',
                usuario: estado.usuario,
                sessaoCaixa: estado.sessaoCaixa,
              })
          : undefined
      }
      aoQuererGerenciarProdutos={(eanInicial) =>
        setEstado({
          fase: 'produtos',
          usuario: estado.usuario,
          sessaoCaixa: estado.sessaoCaixa,
          eanInicial,
        })
      }
    />
  )
}
