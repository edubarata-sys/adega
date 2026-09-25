// Recontagem de estoque (Adega, 25/09/2026).
// Uso: node packages/db/scripts/recontagem.mjs legado/recontagem/lista-1.json [--gravar]
// JSON: { "lista": "lista 1", "itens": [ { "produtoId": "...", "quantidade": 47, "linha": "texto da lista" } ] }
// Para cada produto: estoque passa a ser EXATAMENTE a quantidade contada (movimento 'ajuste'
// com a diferenca, origem 'recontagem' -- mantem SUM(movimentos) == saldo) e registra em
// recontagem_2026_09 (quem ja foi contado). No fim, quem NAO estiver nessa tabela e o que
// sobra pra zerar/apagar.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const arq = process.argv.find((a) => a.endsWith('.json'))
const GRAVAR = process.argv.includes('--gravar')
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
const dados = JSON.parse(readFileSync(arq, 'utf8'))
const sql = postgres(url, { max: 1, ssl: url.includes('railway') ? 'require' : undefined })

try {
  await sql`create table if not exists recontagem_2026_09 (
    produto_id uuid primary key references produtos(id),
    quantidade numeric(14,3) not null,
    lista text not null,
    linha text,
    atualizado_em timestamptz not null default now())`
  const ids = dados.itens.map((i) => i.produtoId)
  const atuais = await sql`
    select p.id, p.descricao, coalesce(s.quantidade, 0)::float as est
    from produtos p left join estoque_saldos s on s.produto_id = p.id
    where p.id in ${sql(ids)}`
  const porId = new Map(atuais.map((a) => [a.id, a]))
  const faltando = ids.filter((id) => !porId.has(id))
  if (faltando.length) throw new Error(`Produto(s) inexistente(s): ${faltando.join(', ')}`)
  console.log(`${GRAVAR ? 'GRAVANDO' : 'SIMULACAO'} -- ${dados.lista} -- ${dados.itens.length} produtos`)
  for (const i of dados.itens) {
    const a = porId.get(i.produtoId)
    console.log(`  ${a.descricao}: ${a.est} -> ${i.quantidade} (ajuste ${i.quantidade - a.est >= 0 ? '+' : ''}${i.quantidade - a.est})`)
  }
  if (GRAVAR) {
    await sql.begin(async (tx) => {
      for (const i of dados.itens) {
        const [{ est }] = await tx`
          select coalesce(quantidade, 0)::float as est from estoque_saldos
          where produto_id = ${i.produtoId} for update`
        const delta = i.quantidade - est
        if (delta !== 0) {
          await tx`insert into estoque_movimentos
            (id, produto_id, tipo, quantidade, origem_tipo, observacao, ocorrido_em)
            values (${randomUUID()}, ${i.produtoId}, 'ajuste', ${String(delta)}, 'recontagem',
                    ${'Recontagem 09/2026 - ' + dados.lista}, now())`
          await tx`update estoque_saldos set quantidade = quantidade + ${delta},
                   versao = versao + 1, atualizado_em = now() where produto_id = ${i.produtoId}`
        }
        await tx`insert into recontagem_2026_09 (produto_id, quantidade, lista, linha)
          values (${i.produtoId}, ${i.quantidade}, ${dados.lista}, ${i.linha ?? null})
          on conflict (produto_id) do update set quantidade = excluded.quantidade,
            lista = excluded.lista, linha = excluded.linha, atualizado_em = now()`
      }
    })
    const [c] = await sql`select count(*)::int n from recontagem_2026_09`
    console.log(`GRAVADO. Produtos ja recontados no total: ${c.n}`)
  }
} catch (e) {
  console.error('ERRO -- nada gravado:', e.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
