import { schema } from '@adega/db'
import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DependenciasApp } from '../dependencias'
import { criarRequireAuth } from '../seguranca/autenticacao'

const CategoriaBodySchema = z.object({
  nome: z.string().trim().min(1, 'Nome e obrigatorio.'),
})

/**
 * Categorias sao so um agrupamento pra organizar o cadastro de produtos
 * (PASSO 10) -- nao tem regra de negocio nenhuma alem de nome unico
 * implicito por bom senso (nao validado aqui: duplicar nome nao quebra
 * nada, so polui o dropdown).
 */
export function registrarRotasCategorias(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  app.get('/categorias', { preHandler: requireAuth }, async () => {
    const categorias = await deps.db
      .select({ id: schema.categorias.id, nome: schema.categorias.nome })
      .from(schema.categorias)
      .where(eq(schema.categorias.ativo, true))
      .orderBy(asc(schema.categorias.nome))
    return { categorias }
  })

  app.post<{ Body: z.infer<typeof CategoriaBodySchema> }>(
    '/categorias',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parse = CategoriaBodySchema.safeParse(request.body)
      if (!parse.success) {
        return reply
          .code(400)
          .send({ status: 'erro', motivo: 'Corpo invalido.', detalhes: parse.error.flatten() })
      }
      const id = crypto.randomUUID()
      await deps.db.insert(schema.categorias).values({ id, nome: parse.data.nome })
      return reply.code(201).send({ categoria: { id, nome: parse.data.nome } })
    },
  )
}
