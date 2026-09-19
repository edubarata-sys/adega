/**
 * Ponto de entrada SEPARADO (`@adega/db/teste`) para o harness de teste
 * contra pglite. Fica fora de `index.ts` de proposito: o entrypoint
 * principal e o que `apps/api` importa pra RODAR em producao, e ele nao deve
 * puxar `@electric-sql/pglite` (WASM, so faz sentido em teste) pra dentro do
 * bundle de producao. Pacotes que consomem isto em teste (ex.: apps/api)
 * precisam declarar `@electric-sql/pglite` como devDependency propria --
 * o mesmo padrao ja usado para `drizzle-orm` no dependencies do apps/api,
 * porque o tsup deste pacote externaliza dependencias de node_modules.
 */
export * from './test-helpers'
export { seedDados, SEED_IDS, SEED_CREDENCIAIS_DEV } from './seed'
