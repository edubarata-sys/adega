import { centavos, type DadosRecibo } from '@adega/core'
import { schema } from '@adega/db'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { DependenciasApp } from '../dependencias'
import { FakePrinterAdapter } from '../impressao/fake-printer-adapter'
import { criarRequireAuth } from '../seguranca/autenticacao'

async function montarDadosRecibo(
  deps: DependenciasApp,
  vendaId: string,
): Promise<DadosRecibo | null> {
  const [venda] = await deps.db.select().from(schema.vendas).where(eq(schema.vendas.id, vendaId))
  if (!venda) return null

  const [operador] = await deps.db
    .select({ nome: schema.usuarios.nome })
    .from(schema.usuarios)
    .where(eq(schema.usuarios.id, venda.usuarioId))

  const linhasItens = await deps.db
    .select({
      quantidade: schema.vendaItens.quantidade,
      precoUnitario: schema.vendaItens.precoUnitario,
      totalItem: schema.vendaItens.totalItem,
      // Snapshot do nome no momento da venda nao existe no schema (venda_itens
      // so guarda produtoId + precos) -- o recibo mostra o nome ATUAL do
      // produto. Aceitavel na Fase 1 (sem historico de renomeacao a exibir).
      descricao: schema.produtos.descricao,
    })
    .from(schema.vendaItens)
    .innerJoin(schema.produtos, eq(schema.produtos.id, schema.vendaItens.produtoId))
    .where(eq(schema.vendaItens.vendaId, vendaId))

  const pagamentos = await deps.db
    .select({
      forma: schema.pagamentos.forma,
      valor: schema.pagamentos.valor,
      troco: schema.pagamentos.troco,
    })
    .from(schema.pagamentos)
    .where(eq(schema.pagamentos.vendaId, vendaId))

  return {
    vendaId: venda.id,
    numero: venda.numero,
    itens: linhasItens.map((i) => ({
      descricao: i.descricao,
      quantidade: Number(i.quantidade),
      precoUnitario: centavos(i.precoUnitario),
      total: centavos(i.totalItem),
    })),
    subtotal: centavos(venda.subtotal),
    desconto: centavos(venda.desconto),
    total: centavos(venda.total),
    pagamentos: pagamentos.map((p) => ({
      forma: p.forma,
      valor: centavos(p.valor),
      troco: centavos(p.troco),
    })),
    operadorNome: operador?.nome ?? 'Operador',
    ocorridoEm: venda.ocorridoEm,
  }
}

export function registrarRotasRecibo(app: FastifyInstance, deps: DependenciasApp): void {
  const requireAuth = criarRequireAuth(deps.sessionSecret)

  /**
   * PASSO 8: gera o comprovante de uma venda ja registrada. Devolve tanto o
   * texto pronto para exibir/guardar quanto os bytes ESC/POS (em base64,
   * para caber em JSON) -- window.print() no navegador e so uma opcao
   * AUXILIAR sobre o texto retornado aqui, nunca a unica forma de emitir
   * o comprovante (decisao congelada da Torre, secao 6).
   */
  app.get<{ Params: { id: string } }>(
    '/vendas/:id/recibo',
    { preHandler: requireAuth },
    async (request, reply) => {
      const dados = await montarDadosRecibo(deps, request.params.id)
      if (!dados) {
        return reply.code(404).send({ status: 'erro', motivo: 'Venda nao encontrada.' })
      }

      const resultado = await FakePrinterAdapter.imprimir(dados)
      return {
        linhas: resultado.linhas,
        escPosBase64: Buffer.from(resultado.comandosEscPos).toString('base64'),
      }
    },
  )
}
