import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // apps/web aponta pro arquivo de config explicito (nao so a pasta):
    // ela tem vite.config.ts (dev server) E vitest.config.ts (testes) lado
    // a lado, e a auto-descoberta por pasta priorizava o vite.config.ts,
    // perdendo `test.environment: 'jsdom'` e quebrando os testes de
    // componente ("document is not defined").
    projects: ['packages/core', 'packages/db', 'apps/api', 'apps/web/vitest.config.ts'],
  },
})
