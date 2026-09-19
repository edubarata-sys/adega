import { eq, ilike } from 'drizzle-orm'
import { schema } from '@adega/db'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

const LIMITE_BUSCA_DESCRICAO = 20

/**
 * Forma comum devolvida por todas as rotas de produto: dados de cadastro +
 * saldo de estoque (leitura do cache `estoque_saldos`, nunca usado aqui pra
 * decidir se a venda pode ocorrer -- arquitetura §2 tolera negativo, essa
 * decisao fica em routes/vendas.ts).
 */
function selecaoProdutoComSaldo() {
  return {
    id: schema.produtos.id,
    ean: schema.produtos.ean,
    descricao: schema.produtos.descricao,
    descricaoPdv: schema.produtos.descricaoPdv,
    unidade: schema.produtos.unidade,
    precoVenda: schema.produtos.precoVenda,
    ativo: schema.produtos.ativo,
    estoqueAtual: schema.estoqueSaldos.quantidade,
  } as const
}

export function registrarRotasProdutos(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  /**
   * Busca EXATA por EAN -- e o caminho da pistola: le o codigo de barras,
   * o PDV chama isto direto (sem digitacao de texto no meio).
   */
  app.get<{ Params: { ean: string } }>(
    '/produtos/ean/:ean',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.ean, request.params.ean))

      if (!produto || !produto.ativo) {
        return reply
          .code(404)
          .send({ status: 'erro', motivo: 'Produto nao encontrado para este EAN.' })
      }
      return { produto }
    },
  )

  /**
   * Busca por descricao (parcial, case-insensitive) -- caminho manual quando
   * o operador digita em vez de passar a pistola (produto sem etiqueta legivel,
   * granel, etc.). Limitada a 20 resultados: e busca de PDV, nao relatorio.
   */
  app.get<{ Querystring: { q?: string } }>(
    '/produtos',
    { preHandler: requireAuth },
    async (request, reply) => {
      const termo = (request.query.q ?? '').trim()
      if (termo.length < 2) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Informe ao menos 2 caracteres em "q" para buscar.' })
      }

      const produtos = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(ilike(schema.produtos.descricao, `%${termo}%`))
        .limit(LIMITE_BUSCA_DESCRICAO)

      return { produtos: produtos.filter((p) => p.ativo) }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/produtos/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [produto] = await deps.db
        .select(selecaoProdutoComSaldo())
        .from(schema.produtos)
        .leftJoin(schema.estoqueSaldos, eq(schema.estoqueSaldos.produtoId, schema.produtos.id))
        .where(eq(schema.produtos.id, request.params.id))

      if (!produto) {
        return reply.code(404).send({ status: 'erro', motivo: 'Produto nao encontrado.' })
      }
      return { produto }
    },
  )
}
