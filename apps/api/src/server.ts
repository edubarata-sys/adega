import { sql } from 'drizzle-orm'
import { criarDb } from '@adega/db'
import { buildApp } from './app'

const PORTA = Number(process.env.PORT ?? 3000)
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL nao definida. Copie .env.example para .env e ajuste.')
}

const db = criarDb(DATABASE_URL)

const app = buildApp({
  versao: process.env.npm_package_version ?? '0.0.0',
  db: {
    ping: async () => {
      await db.execute(sql`select 1`)
    },
  },
})

app
  .listen({ port: PORTA, host: '0.0.0.0' })
  .then(() => console.log(`api ouvindo na porta ${PORTA}`))
  .catch((erro: unknown) => {
    console.error(erro)
    process.exit(1)
  })
