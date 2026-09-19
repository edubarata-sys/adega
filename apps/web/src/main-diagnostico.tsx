import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DiagnosticoTela } from './DiagnosticoTela'

/**
 * Ponto de entrada dedicado, separado de `main.tsx`, para a build ESTATICA
 * standalone da pagina de diagnostico (ver `vite.diagnostico.config.ts`).
 * So renderiza <DiagnosticoTela />, sem nenhuma logica de roteamento nem
 * dependencia do resto do sistema (App.tsx, api.ts) -- essa build nao tem
 * backend nenhum por tras.
 */

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root nao encontrado.')

createRoot(container).render(
  <StrictMode>
    <DiagnosticoTela />
  </StrictMode>,
)
