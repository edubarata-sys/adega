import { criarDb } from './client'
import { seedDados, SEED_CREDENCIAIS_DEV } from './seed'

/**
 * Ponto de entrada de linha de comando do seed. NUNCA roda so por importar
 * este arquivo -- so quando executado diretamente (`pnpm db:seed`) e com a
 * trava abaixo satisfeita. Isso e deliberado: dado ficticio nunca deve entrar
 * silenciosamente num banco de producao.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Recusado: NODE_ENV=production. Seed de dados de teste nunca roda em producao.')
  }
  if (process.env.ALLOW_DEV_SEED !== 'true') {
    throw new Error(
      'Recusado: defina ALLOW_DEV_SEED=true explicitamente para confirmar que este e ' +
        'um banco de desenvolvimento/teste (nunca produção) antes de rodar o seed.',
    )
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL nao definida. Copie .env.example para .env e ajuste.')
  }

  console.log(`Rodando seed de dev contra: ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`)
  const db = criarDb(databaseUrl)
  await seedDados(db)
  console.log('Seed concluido.')
  console.log(
    `Login admin: ${SEED_CREDENCIAIS_DEV.adminEmail} / ${SEED_CREDENCIAIS_DEV.adminSenha}`,
  )
  console.log(`PIN operador: ${SEED_CREDENCIAIS_DEV.operadorPin}`)
  process.exit(0)
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
