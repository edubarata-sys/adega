// Classifica a via (adega / outros / espetinho) dos produtos pelo nome
// (02/10/2026). Uso UNICO, logo depois da migracao 0003 -- depois disso a via
// de cada produto e mantida no cadastro.
//
// Uso: DATABASE_PUBLIC_URL=... npx tsx packages/db/scripts/classificar-vias.mts [--gravar]
// Sem --gravar so gera legado/vias-produtos.csv pra conferir.
// Com --gravar so atualiza quem esta diferente da sugestao.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { classificarVia } from '../../core/src/via-produto'

const GRAVAR = process.argv.includes('--gravar')
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
if (!url) throw new Error('Defina DATABASE_PUBLIC_URL')
const sql = postgres(url, {
  max: 1,
  ssl: url.includes('railway') || url.includes('rlwy') ? 'require' : undefined,
})

try {
  const produtos = await sql<{ id: string; descricao: string; via: string; ativo: boolean }[]>`
    select id, descricao, via::text as via, ativo from produtos order by descricao`
  const linhas = ['via;descricao;ativo']
  const mudar: { id: string; via: string }[] = []
  const contagem: Record<string, number> = {}
  for (const p of produtos) {
    const via = classificarVia(p.descricao)
    contagem[via] = (contagem[via] ?? 0) + 1
    linhas.push(`${via};${p.descricao.replace(/;/g, ',')};${p.ativo ? 'sim' : 'nao'}`)
    if (via !== p.via) mudar.push({ id: p.id, via })
  }
  writeFileSync(
    resolve(import.meta.dirname, '../../../legado/vias-produtos.csv'),
    '﻿' + linhas.join('\n'),
  )
  console.log('produtos:', produtos.length, contagem, 'a mudar:', mudar.length)
  if (GRAVAR) {
    for (const via of ['adega', 'outros', 'espetinho']) {
      const ids = mudar.filter((m) => m.via === via).map((m) => m.id)
      if (ids.length)
        await sql`update produtos set via = ${via}::via_produto, atualizado_em = now() where id in ${sql(ids)}`
    }
    console.log('gravado.')
  } else {
    console.log('so conferencia (use --gravar pra aplicar).')
  }
} finally {
  await sql.end()
}
