# Sistema da Adega

Sistema de PDV, estoque e caixa sob medida, com PWA offline no balcao e
integracao com a Laranjinha Itau/Rede. Contexto de negocio em
[`projeto-sistema-adega.md`](./projeto-sistema-adega.md); decisoes de
arquitetura e o porque de cada uma em [`arquitetura.md`](./arquitetura.md)
-- comece por la antes de mexer no schema ou no fluxo de venda/caixa.

## Status

Fase 1 em scaffold. `packages/core`, `packages/db` e os healthchecks de
`apps/api`/`apps/web` estao escritos e testados. O spike do bridge
(`apps/bridge`) esta com o servidor validado por protocolo, mas o
veredito real contra o Chrome do cliente ainda depende de acesso fisico
a uma maquina Windows -- ver [`apps/bridge/README.md`](./apps/bridge/README.md).

## Pre-requisitos

- Node 22+
- pnpm 9 (`corepack enable pnpm` ativa a versao fixada em `package.json`)
- Docker (para o Postgres local via `docker-compose`)
- Go 1.18+ (so para compilar `apps/bridge`, opcional no dia a dia)

## Subindo o ambiente local

```bash
cp .env.example .env          # ajuste se necessario
pnpm install

pnpm db:up                    # sobe o Postgres (docker compose)
pnpm db:migrate                # aplica as migrations em packages/db/drizzle

pnpm dev                       # sobe api (porta 3000) e web (porta 5173) em paralelo
```

Abra `http://localhost:5173` -- a tela mostra se web -> api -> banco estao
respondendo. `http://localhost:3000/health` e `/health/ready` respondem
direto, sem passar pelo front.

## Comandos

| Comando                        | O que faz                                                                   |
| ------------------------------ | --------------------------------------------------------------------------- |
| `pnpm dev`                     | Sobe `api` e `web` em modo desenvolvimento                                  |
| `pnpm test`                    | Roda toda a suite (Vitest) uma vez                                          |
| `pnpm test:watch`              | Suite em modo watch                                                         |
| `pnpm typecheck`               | `tsc --noEmit` em todos os pacotes                                          |
| `pnpm lint` / `lint:fix`       | ESLint                                                                      |
| `pnpm format` / `format:check` | Prettier                                                                    |
| `pnpm check`                   | format:check + lint + typecheck + test, nessa ordem -- o que a CI roda      |
| `pnpm build`                   | Build de producao de todos os pacotes                                       |
| `pnpm db:up` / `db:down`       | Sobe/derruba o Postgres do docker-compose                                   |
| `pnpm db:generate`             | Gera uma nova migration a partir de mudancas em `packages/db/src/schema.ts` |
| `pnpm db:migrate`              | Aplica as migrations pendentes                                              |

## Estrutura

```
apps/
  web/       React + Vite + TS -- PDV e admin (mesma SPA, rotas por perfil)
  api/       Fastify + Zod
  bridge/    Agente local Windows (impressora, gaveta; TEF na Fase 2)
packages/
  core/      Regras de negocio puras. ZERO I/O -- lint quebra se importar
             banco, HTTP, filesystem ou framework (ver eslint.config.js).
  db/        Schema Drizzle, migrations, client de producao
```

`packages/core` e testado sem banco (Vitest puro). `packages/db` e testado
contra Postgres real via `pglite`, aplicando as migrations geradas de
verdade -- nao e um mock de schema. Prioridade de teste documentada em
`arquitetura.md`: core > contrato de API > invariantes de banco > smoke
de UI.

## Dinheiro, IDs e tempo -- convencoes que nao mudam

- Dinheiro e sempre `bigint` em **centavos**. Nunca float, em lugar nenhum.
- IDs sao **UUIDv7**, gerados na aplicacao (nao no banco) -- o cliente
  offline do PDV precisa gerar um id valido sem falar com o servidor.
- Tempo e sempre `timestamptz` em UTC. Eventos com origem no dispositivo
  (venda, movimento de estoque) guardam `ocorrido_em` (relogio do
  cliente) separado de `registrado_em` (quando chegou no servidor) --
  os dois sao dados diferentes sob sync offline.

Detalhe e justificativa de cada uma dessas escolhas: `arquitetura.md`.
