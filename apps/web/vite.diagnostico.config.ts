import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `type: module` -- sem __dirname nativo, precisa derivar de import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Build separada, standalone, so da pagina de diagnostico
 * (`diagnostico.html` -> `src/main-diagnostico.tsx` -> `DiagnosticoTela`).
 *
 * Gera UM UNICO arquivo `.html` autossuficiente (JS e CSS inlinados pelo
 * `vite-plugin-singlefile`; a logo ja vem embutida em base64 direto no JS,
 * via `?inline` no import -- ver DiagnosticoTela.tsx) em `dist-diagnostico/`.
 *
 * Pra que: o cliente pediu uma pagina que ele "joga" num servidor onde nao
 * tem acesso a configuracao nenhuma (hospedagem compartilhada, so FTP) --
 * sem Node, sem processo rodando, sem pastas de assets pra path quebrar.
 * `base: './'` garante que funciona em qualquer subpasta do servidor.
 *
 * Roda com: `pnpm --filter web build:diagnostico`
 */
export default defineConfig({
  root: __dirname,
  base: './',
  // Nada em public/ e usado por esta build (a logo ja vai embutida via
  // import `?inline`) -- desligar evita copiar um arquivo orfao pro
  // output, que deve ser mesmo UM arquivo so.
  publicDir: false,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-diagnostico',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'diagnostico.html'),
    },
  },
})
