import { criarDb } from '@adega/db'
import { buildApp } from './app'

const PORTA = Number(process.env.PORT ?? 3000)
const DATABASE_URL = process.env.DATABASE_URL
const SESSION_SECRET = process.env.SESSION_SECRET

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL nao definida. Copie .env.example para .env e ajuste.')
}
if (!SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET nao definida. Defina uma string aleatoria longa em .env -- ' +
      'e o segredo que assina o cookie de sessao (ver src/seguranca/sessao.ts).',
  )
}

const db = criarDb(DATABASE_URL)

const app = buildApp({
  versao: process.env.npm_package_version ?? '0.0.0',
  db,
  sessionSecret: SESSION_SECRET,
})

app
  .listen({ port: PORTA, host: '0.0.0.0' })
  .then(() => console.log(`api ouvindo na porta ${PORTA}`))
  .catch((erro: unknown) => {
    console.error(erro)
    process.exit(1)
  })
