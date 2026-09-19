import { sql, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import * as schema from '../schema'

type Schema = typeof schema
type Relacoes = ExtractTablesWithRelations<Schema>

/**
 * Tipo minimo de "algo que fala Drizzle Postgres" aceito pelos repositorios:
 * tanto `criarDb()` (postgres-js, producao) quanto `bancoDeTeste()` (pglite,
 * testes) sao `PgDatabase<...>` por baixo -- so o driver concreto
 * (`PostgresJsQueryResultHKT` vs `PgliteQueryResultHKT`) difere, e nenhuma
 * operacao usada aqui (insert/update/select/transaction) depende disso.
 * Usar o HKT generico (`PgQueryResultHKT`) em vez do driver concreto e o que
 * permite a MESMA funcao de repositorio rodar contra os dois -- sem isso,
 * `packages/db` teria que duplicar cada funcao uma vez por driver.
 */
export type Executor =
  PgDatabase<PgQueryResultHKT, Schema, Relacoes> | PgTransaction<PgQueryResultHKT, Schema, Relacoes>

export interface EntradaMovimentoEstoque {
  readonly id: string
  readonly produtoId: string
  readonly tipo: 'entrada' | 'venda' | 'ajuste' | 'perda' | 'devolucao'
  /** Assinada: negativa em venda/perda. Numero, nao string -- a conversao pro
   * tipo `numeric` do Postgres e responsabilidade deste repositorio. */
  readonly quantidade: number
  readonly custoUnitario?: number
  readonly origemTipo?: string
  readonly origemId?: string
  readonly usuarioId?: string
  readonly observacao?: string
  readonly ocorridoEm: Date
}

/**
 * Aplica UM movimento de estoque exatamente como a arquitetura exige
 * (arquitetura.md secao 3.1): insere a linha no ledger (append-only) e
 * atualiza o cache `estoque_saldos` por soma comutativa, na MESMA transacao.
 *
 * `quantidade = quantidade + delta` e order-independent -- funciona tanto
 * numa venda em ordem cronologica quanto num sync fora de ordem. Esta e a
 * UNICA funcao do repositorio que escreve nessas duas tabelas: seed, venda
 * e qualquer ajuste futuro devem chamar isto em vez de duplicar o SQL
 * (evita a divergencia que a invariante de packages/db/src/invariantes.test.ts
 * prova nao poder existir).
 *
 * Pressupoe que ja existe uma linha em `estoque_saldos` para o produto
 * (criada junto com o cadastro do produto) -- nao faz upsert de saldo aqui
 * para manter o `ON CONFLICT` simples e auditavel.
 */
export async function aplicarMovimentoEstoque(
  executor: Executor,
  entrada: EntradaMovimentoEstoque,
): Promise<void> {
  await executor.insert(schema.estoqueMovimentos).values({
    id: entrada.id,
    produtoId: entrada.produtoId,
    tipo: entrada.tipo,
    quantidade: String(entrada.quantidade),
    custoUnitario: entrada.custoUnitario,
    origemTipo: entrada.origemTipo,
    origemId: entrada.origemId,
    usuarioId: entrada.usuarioId,
    observacao: entrada.observacao,
    ocorridoEm: entrada.ocorridoEm,
  })

  await executor
    .update(schema.estoqueSaldos)
    .set({
      quantidade: sql`${schema.estoqueSaldos.quantidade} + ${entrada.quantidade}`,
      versao: sql`${schema.estoqueSaldos.versao} + 1`,
      atualizadoEm: sql`now()`,
    })
    .where(sql`${schema.estoqueSaldos.produtoId} = ${entrada.produtoId}`)
}

/** Saldo atual (cache) de um produto. Usado por leitura de UI/API, nunca para decidir se uma venda pode ocorrer -- arquitetura §2 tolera estoque negativo. */
export async function obterSaldo(executor: Executor, produtoId: string): Promise<number> {
  const [linha] = await executor
    .select({ quantidade: schema.estoqueSaldos.quantidade })
    .from(schema.estoqueSaldos)
    .where(sql`${schema.estoqueSaldos.produtoId} = ${produtoId}`)
  return Number(linha?.quantidade ?? 0)
}
