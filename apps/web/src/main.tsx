import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DiagnosticoTela } from './DiagnosticoTela'
import './tema.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root nao encontrado.')

/**
 * Nao ha router nesta SPA (Fase 1 e um unico terminal fazendo uma coisa de
 * cada vez -- ver App.tsx). A pagina de diagnostico de hardware e a UNICA
 * excecao: precisa ser alcancavel em /diagnostico SEM login, entao e
 * resolvida aqui, antes da maquina de estados de autenticacao do <App/>.
 */
const ehPaginaDeDiagnostico = window.location.pathname.startsWith('/diagnostico')

createRoot(container).render(
  <StrictMode>{ehPaginaDeDiagnostico ? <DiagnosticoTela /> : <App />}</StrictMode>,
)
