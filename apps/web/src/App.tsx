import { useEffect, useState } from 'react'
import { AbrirCaixaTela } from './AbrirCaixaTela'
import { caixaAtual, eu, type SessaoCaixaApi, type UsuarioSessao } from './api'
import { FecharCaixaTela } from './FecharCaixaTela'
import { LoginTela } from './LoginTela'
import { PdvTela } from './PdvTela'
import { ProdutosTela } from './ProdutosTela'

type Estado =
  | { fase: 'carregando' }
  | { fase: 'login' }
  | { fase: 'abrindo-caixa'; usuario: UsuarioSessao }
  | { fase: 'pdv'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi }
  | { fase: 'fechando-caixa'; usuario: UsuarioSessao }
  | { fase: 'produtos'; usuario: UsuarioSessao; sessaoCaixa: SessaoCaixaApi }

/**
 * Orquestrador do fluxo ponta a ponta do PDV (PASSO 7 da missao):
 * login -> abertura de caixa (se ainda nao houver uma sessao aberta) -> PDV.
 *
 * Isto NAO e um roteador (nao ha URLs de tela) -- Fase 1 e um unico
 * terminal fazendo uma coisa de cada vez, entao uma maquina de estados
 * simples e suficiente e mais facil de auditar que uma lib de rotas.
 */
export function App() {
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

  if (estado.fase === 'produtos') {
    return (
      <ProdutosTela
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
      aoQuererGerenciarProdutos={() =>
        setEstado({ fase: 'produtos', usuario: estado.usuario, sessaoCaixa: estado.sessaoCaixa })
      }
    />
  )
}
