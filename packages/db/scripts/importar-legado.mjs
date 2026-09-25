// ============================================================================
// Importa o HISTORICO do sistema antigo (Firebird/Nex) para o banco novo.
// Adega Dois Irmaos -- 25/09/2026.
//
// O que faz (numa transacao so):
//   1. vendas finalizadas do sistema antigo -> vendas (status 'paga'),
//      com itens (venda_itens) e pagamentos (pagamentos). NAO mexe em estoque
//      (a recontagem resolve o estoque).
//   2. custo dos produtos: copia o custo do sistema antigo para os produtos
//      do sistema novo que estao SEM custo (custo_medio = 0).
//   3. registra tudo em importacao_legado (tipo, codigo_antigo, novo_id) --
//      auditoria e protecao contra importar duas vezes.
//
// Produto: vale a BASE NOVA. Cada item e ligado ao produto novo por
//   (a) codigo_interno = codigo do produto no sistema antigo,
//   (b) codigo de barras (EAN-13 / UPC-A), ou (c) descricao igual.
//   Item sem produto correspondente NAO cria produto: fica fora da lista de
//   produtos (o total da venda e os pagamentos entram mesmo assim).
//
// Uso (na pasta D:\adega, com a URL PUBLICA do Postgres do Railway):
//   simular : railway run node packages/db/scripts/importar-legado.mjs
//   gravar  : railway run node packages/db/scripts/importar-legado.mjs --gravar
// (ou defina DATABASE_PUBLIC_URL / DATABASE_URL no ambiente)
// ============================================================================
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const aqui = dirname(fileURLToPath(import.meta.url))
const GRAVAR = process.argv.includes('--gravar')
const arquivo =
  process.argv.find((a) => a.endsWith('.json')) ??
  resolve(aqui, '../../../legado/importacao-legado-2026-09-25.json')
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL
if (!url) {
  console.error('Defina DATABASE_PUBLIC_URL (ou rode com "railway run").')
  process.exit(1)
}

const dados = JSON.parse(readFileSync(arquivo, 'utf8'))
const sql = postgres(url, { max: 1, ssl: url.includes('railway') ? 'require' : undefined })

/** UUID deterministico: rodar de novo gera os mesmos ids (idempotente). */
function uuidDe(texto) {
  const h = createHash('md5').update(`adega-legado:${texto}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const norm = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
function variantesEan(e) {
  const d = (e ?? '').replace(/\D/g, '')
  if (!d) return []
  const v = new Set([d])
  if (d.length === 13 && d.startsWith('0')) v.add(d.slice(1))
  if (d.length === 12) v.add(`0${d}`)
  return [...v]
}
const FORMA = {
  dinheiro: ['dinheiro', null],
  pix: ['pix', null],
  debito: ['debito', null],
  credito: ['credito', null],
  a_prazo: ['voucher', 'A PRAZO (sistema antigo)'],
  tef: ['credito', 'TEF (sistema antigo)'],
  troca: ['voucher', 'TROCA (sistema antigo)'],
  outro: ['voucher', 'OUTRO (sistema antigo)'],
}
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function main() {
  const produtos = await sql`
    select id, ean, codigo_interno, descricao, custo_medio, ativo from produtos`
  const porCodInterno = new Map()
  const porEan = new Map()
  const porDesc = new Map()
  for (const p of produtos) {
    if (p.codigo_interno) porCodInterno.set(String(p.codigo_interno).trim(), p)
    if (p.ean) for (const v of variantesEan(p.ean)) if (!porEan.has(v) || p.ativo) porEan.set(v, p)
    const n = norm(p.descricao)
    if (n && (!porDesc.has(n) || p.ativo)) porDesc.set(n, p)
  }
  const acharProduto = (pid, ean, desc) => {
    const a = porCodInterno.get(String(pid))
    if (a) return [a, 'codigo']
    for (const e of variantesEan(ean)) if (porEan.has(e)) return [porEan.get(e), 'ean']
    const d = porDesc.get(norm(desc))
    if (d) return [d, 'descricao']
    return [null, null]
  }

  const [admin] = await sql`
    select id from usuarios where perfil = 'admin' and ativo = true order by criado_em limit 1`
  if (!admin) throw new Error('Nenhum usuario admin ativo no banco novo.')

  await sql`
    create table if not exists importacao_legado (
      tipo text not null,
      codigo_antigo integer not null,
      novo_id uuid,
      detalhe text,
      importado_em timestamptz not null default now(),
      primary key (tipo, codigo_antigo)
    )`
  const jaImportadas = new Set(
    (await sql`select codigo_antigo from importacao_legado where tipo = 'venda'`).map(
      (r) => r.codigo_antigo,
    ),
  )

  // ---------- vendas
  const vendas = dados.vendas.filter((v) => !jaImportadas.has(v.c))
  const idsVenda = new Set(vendas.map((v) => v.c))
  const linhasVenda = vendas.map((v) => ({
    id: uuidDe(`venda:${v.c}`),
    usuario_id: admin.id,
    status: 'paga',
    subtotal: v.subtotal || v.total,
    desconto: v.desconto,
    total: v.total,
    ocorrido_em: new Date(`${v.data}T12:00:00-03:00`),
  }))

  // ---------- itens
  const ligacao = { codigo: 0, ean: 0, descricao: 0 }
  const semProduto = new Map()
  const linhasItem = []
  // Itens de TODAS as vendas (novas e ja importadas): se um produto que
  // estava sem par ganhar par depois (mapa-legado.json), rodar de novo
  // completa os itens que faltavam -- ids deterministicos, sem duplicar.
  const mapa = (() => {
    try {
      return JSON.parse(readFileSync(resolve(dirname(arquivo), 'mapa-legado.json'), 'utf8'))
    } catch {
      return {}
    }
  })()
  const porId = new Map(produtos.map((p) => [p.id, p]))
  const idsTodas = new Set([...idsVenda, ...jaImportadas])
  for (const i of dados.itens) {
    if (!idsTodas.has(i.v)) continue
    if (mapa[i.desc] && porId.has(mapa[i.desc])) {
      const p = porId.get(mapa[i.desc])
      ligacao.mapa = (ligacao.mapa ?? 0) + 1
      linhasItem.push({
        id: uuidDe(`item:${i.c}`),
        venda_id: uuidDe(`venda:${i.v}`),
        produto_id: p.id,
        quantidade: String(i.qtd),
        preco_unitario: i.preco,
        custo_unitario: Number(p.custo_medio) > 0 ? Number(p.custo_medio) : i.custo,
        desconto_item: i.desconto,
        total_item: i.total,
      })
      continue
    }
    const [p, como] = acharProduto(i.pid, i.ean || i.ean_cad, i.desc)
    if (!p) {
      const s = semProduto.get(i.desc) ?? { qtd: 0, total: 0 }
      s.qtd += i.qtd
      s.total += i.total
      semProduto.set(i.desc, s)
      continue
    }
    ligacao[como]++
    linhasItem.push({
      id: uuidDe(`item:${i.c}`),
      venda_id: uuidDe(`venda:${i.v}`),
      produto_id: p.id,
      quantidade: String(i.qtd),
      preco_unitario: i.preco,
      custo_unitario: Number(p.custo_medio) > 0 ? Number(p.custo_medio) : i.custo,
      desconto_item: i.desconto,
      total_item: i.total,
    })
  }

  // ---------- pagamentos
  const linhasPag = dados.pagamentos
    .filter((p) => idsVenda.has(p.v))
    .map((p) => {
      const [forma, apelido] = FORMA[p.forma] ?? FORMA.outro
      return {
        id: uuidDe(`pag:${p.c}`),
        venda_id: uuidDe(`venda:${p.v}`),
        forma,
        valor: p.valor,
        troco: forma === 'dinheiro' ? p.troco : 0,
        terminal_apelido: apelido,
      }
    })

  // ---------- custos (so produtos novos SEM custo)
  const custos = []
  const vistos = new Set()
  for (const c of dados.custos) {
    const [p] = acharProduto(c.pid, c.ean, c.desc)
    if (!p || vistos.has(p.id) || Number(p.custo_medio) > 0) continue
    vistos.add(p.id)
    custos.push({ id: p.id, custo: c.custo, pid: c.pid, desc: p.descricao })
  }
  const semCustoDepois = produtos.filter(
    (p) => p.ativo && Number(p.custo_medio) === 0 && !vistos.has(p.id),
  )

  // ---------- resumo
  const totalVendas = linhasVenda.reduce((s, v) => s + v.total, 0)
  const totalFora = [...semProduto.values()].reduce((s, x) => s + x.total, 0)
  console.log('==================== RESUMO ====================')
  console.log(`Modo: ${GRAVAR ? 'GRAVAR' : 'SIMULACAO (nada gravado)'}`)
  console.log(`Vendas a importar: ${linhasVenda.length} (ja importadas antes: ${jaImportadas.size})`)
  console.log(`Total dessas vendas: ${brl(totalVendas)}`)
  console.log(`Pagamentos: ${linhasPag.length}`)
  console.log(
    `Itens ligados a produto novo: ${linhasItem.length} (codigo antigo ${ligacao.codigo}, codigo de barras ${ligacao.ean}, descricao ${ligacao.descricao}, mapa manual ${ligacao.mapa ?? 0})`,
  )
  console.log(`Itens SEM produto no sistema novo: ${[...semProduto.values()].reduce((s, x) => s + 1, 0)} produtos, ${brl(totalFora)} (ficam fora da lista de produtos)`)
  for (const [d, s] of [...semProduto.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 40))
    console.log(`   - ${d}: qtd ${s.qtd}, ${brl(s.total)}`)
  console.log(`Custos a copiar do sistema antigo: ${custos.length} produtos`)
  console.log(`Produtos ativos que continuam SEM custo depois: ${semCustoDepois.length}`)
  for (const p of semCustoDepois.slice(0, 60)) console.log(`   - ${p.descricao}${p.ean ? ` (${p.ean})` : ''}`)

  if (!GRAVAR) {
    console.log('\nNada foi gravado. Para gravar, rode de novo com --gravar.')
    return
  }

  await sql.begin(async (tx) => {
    const lote = async (tabela, linhas) => {
      for (let i = 0; i < linhas.length; i += 2000)
        await tx`insert into ${tx(tabela)} ${tx(linhas.slice(i, i + 2000))} on conflict (id) do nothing`
    }
    await lote('vendas', linhasVenda)
    await lote('venda_itens', linhasItem)
    await lote('pagamentos', linhasPag)
    const reg = vendas.map((v) => ({
      tipo: 'venda',
      codigo_antigo: v.c,
      novo_id: uuidDe(`venda:${v.c}`),
      detalhe: v.data,
    }))
    for (let i = 0; i < reg.length; i += 1000)
      await tx`insert into importacao_legado ${tx(reg.slice(i, i + 1000))} on conflict do nothing`
    if (custos.length) {
      const valores = custos.map((c) => [c.id, String(c.custo)])
      await tx`
        update produtos set custo_medio = v.custo::bigint
        from (values ${tx(valores)}) as v (id, custo)
        where produtos.id = v.id::uuid and produtos.custo_medio = 0`
      const regCusto = custos.map((c) => ({
        tipo: 'custo',
        codigo_antigo: c.pid,
        novo_id: c.id,
        detalhe: String(c.custo),
      }))
      await tx`insert into importacao_legado ${tx(regCusto)} on conflict do nothing`
    }
  })
  const [conf] = await sql`
    select count(*)::int as vendas, coalesce(sum(v.total),0)::bigint as total
    from vendas v join importacao_legado l on l.novo_id = v.id and l.tipo = 'venda'`
  console.log(`\nGRAVADO. Conferencia: ${conf.vendas} vendas importadas no banco, ${brl(Number(conf.total))}.`)
}

main()
  .catch((e) => {
    console.error('ERRO -- nada foi gravado (transacao desfeita):', e.message)
    process.exitCode = 1
  })
  .finally(() => sql.end())
