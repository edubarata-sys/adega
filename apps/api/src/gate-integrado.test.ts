import { AVISO_SEM_VALOR_FISCAL } from '@adega/core'
import { schema, seedDados, SEED_IDS } from '@adega/db'
import { bancoDeTeste, limparTabelas } from '@adega/db/teste'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app'

/**
 * GATE AUTOMATICO da missao TESTE_SIMULADO_PONTA_A_PONTA_PRONTO.
 *
 * Um UNICO teste reproduzivel, de ponta a ponta, contra pglite (nunca
 * contra um Postgres real de verdade -- essa validacao e o subgate
 * separado de PostgreSQL Windows), demonstrando os 12 pontos exigidos
 * pela Torre na ordem exata em que foram listados. Cada bloco abaixo tem
 * o numero do checkpoint como comentario, para que a correspondencia com
 * a ordem seja auditavel linha a linha.
 */
describe('GATE — fluxo ponta a ponta (operador -> caixa -> produto -> venda -> pagamento -> estoque -> caixa -> comprovante -> consulta -> fechamento)', () => {
  let ctx: Awaited<ReturnType<typeof bancoDeTeste>>

  beforeAll(async () => {
    ctx = await bancoDeTeste()
  })

  afterEach(async () => {
    await limparTabelas(ctx.client)
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it('demonstra os 12 checkpoints do gate automatico em um unico fluxo real', async () => {
    await seedDados(ctx.db)
    const app = buildApp({ db: ctx.db, versao: 'gate', sessionSecret: 'segredo-gate-integrado' })

    // ---------------------------------------------------------------
    // 1. Operador identificado (login por PIN, nao admin -- e o caminho
    //    de "troca de turno no balcao" que a arquitetura descreve, e
    //    prova que a venda/caixa ficam atribuidos a um OPERADOR, nao a
    //    uma conta generica).
    // ---------------------------------------------------------------
    const loginPin = await app.inject({
      method: 'POST',
      url: '/auth/pin',
      payload: { usuarioId: SEED_IDS.usuarioOperador, pin: '135790' },
    })
    expect(loginPin.statusCode).toBe(200)
    const operador = loginPin.json().usuario as { usuarioId?: string; nome: string; perfil: string }
    expect(operador.perfil).toBe('caixa')
    const cookieSessao = loginPin.cookies.find((c) => c.name === 'adega_sessao')?.value ?? ''
    const cookies = { adega_sessao: cookieSessao }

    const eu = await app.inject({ method: 'GET', url: '/auth/eu', cookies })
    expect(eu.statusCode).toBe(200)
    const operadorId = (eu.json().usuario as { usuarioId: string }).usuarioId

    // ---------------------------------------------------------------
    // 2. Caixa aberto.
    // ---------------------------------------------------------------
    const abertura = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { fundoTroco: 10000 },
      cookies,
    })
    expect(abertura.statusCode).toBe(201)
    const sessaoCaixaId = abertura.json().sessao.id as string

    // ---------------------------------------------------------------
    // 3. Produto localizado por EAN.
    // ---------------------------------------------------------------
    const produtoRes = await app.inject({
      method: 'GET',
      url: '/produtos/ean/7891000100019', // Cerveja Pilsen Lata 350ml, preco 550, estoque inicial 120
      cookies,
    })
    expect(produtoRes.statusCode).toBe(200)
    const produto = produtoRes.json().produto as {
      id: string
      precoVenda: number
      estoqueAtual: string | number
    }
    expect(produto.id).toBe(SEED_IDS.produtos.cervejaLata)
    const saldoAntes = Number(produto.estoqueAtual)

    // Um suprimento antes da venda -- usado adiante para provar que o
    // movimento de caixa entra corretamente na conta do fechamento
    // (checkpoint 9), nao so a venda em dinheiro.
    const suprimento = await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { tipo: 'suprimento', valor: 2000, descricao: 'reforco de troco (gate)' },
      cookies,
    })
    expect(suprimento.statusCode).toBe(201)

    // ---------------------------------------------------------------
    // 4 e 5. Venda criada, com calculo correto: 3 unidades x R$5,50 =
    //    R$16,50, paga com R$20,00 em dinheiro -> troco de R$3,50.
    // ---------------------------------------------------------------
    const quantidade = 3
    const precoUnitario = produto.precoVenda
    const totalEsperado = quantidade * precoUnitario
    const valorPago = 2000

    const vendaRes = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        itens: [{ produtoId: produto.id, quantidade, precoUnitario }],
        pagamentos: [{ forma: 'dinheiro', valor: valorPago }],
      },
    })
    expect(vendaRes.statusCode).toBe(201)
    const vendaCriada = vendaRes.json() as {
      venda: { id: string; total: number; usuarioId: string; sessaoCaixaId: string }
      pagamentos: Array<{
        forma: string
        valor: number
        troco: number
        adquirente: string | null
        nsu: string | null
        autorizacao: string | null
        bandeira: string | null
      }>
    }
    const vendaId = vendaCriada.venda.id
    expect(vendaCriada.venda.total).toBe(totalEsperado) // checkpoint 5: calculo correto
    expect(vendaCriada.venda.usuarioId).toBe(operadorId)
    expect(vendaCriada.venda.sessaoCaixaId).toBe(sessaoCaixaId)

    // ---------------------------------------------------------------
    // 6. Pagamento via ManualAdapter: confirmado sem inventar dados de
    //    adquirente (nsu/autorizacao/bandeira permanecem nulos -- e a
    //    prova de que ninguem fingiu uma integracao real).
    // ---------------------------------------------------------------
    const pagamento = vendaCriada.pagamentos[0]!
    expect(pagamento.forma).toBe('dinheiro')
    expect(pagamento.valor).toBe(valorPago)
    expect(pagamento.troco).toBe(valorPago - totalEsperado)
    expect(pagamento.adquirente).toBeNull()
    expect(pagamento.nsu).toBeNull()
    expect(pagamento.autorizacao).toBeNull()
    expect(pagamento.bandeira).toBeNull()

    // ---------------------------------------------------------------
    // 7. Estoque reduzido EXATAMENTE UMA VEZ -- inclusive sob retentativa
    //    (idempotencia): reenviar a mesma venda (mesmo id) nao baixa
    //    estoque de novo.
    // ---------------------------------------------------------------
    async function saldoAtual() {
      const [linha] = await ctx.db
        .select({ quantidade: schema.estoqueSaldos.quantidade })
        .from(schema.estoqueSaldos)
        .where(eq(schema.estoqueSaldos.produtoId, produto.id))
      return Number(linha?.quantidade ?? 0)
    }
    expect(await saldoAtual()).toBe(saldoAntes - quantidade)

    const reenvio = await app.inject({
      method: 'POST',
      url: '/vendas',
      cookies,
      payload: {
        id: vendaId,
        itens: [{ produtoId: produto.id, quantidade, precoUnitario }],
        pagamentos: [{ forma: 'dinheiro', valor: valorPago }],
      },
    })
    expect(reenvio.statusCode).toBe(200)
    expect(reenvio.json().idempotente).toBe(true)
    expect(await saldoAtual()).toBe(saldoAntes - quantidade) // ainda uma unica baixa

    // ---------------------------------------------------------------
    // 8. Movimento de estoque existente (ledger append-only, nao so o
    //    saldo em cache).
    // ---------------------------------------------------------------
    const movimentosEstoque = await ctx.db
      .select()
      .from(schema.estoqueMovimentos)
      .where(
        and(
          eq(schema.estoqueMovimentos.produtoId, produto.id),
          eq(schema.estoqueMovimentos.origemId, vendaId),
        ),
      )
    expect(movimentosEstoque).toHaveLength(1) // um so, mesmo com o reenvio idempotente acima
    expect(movimentosEstoque[0]?.tipo).toBe('venda')
    expect(Number(movimentosEstoque[0]?.quantidade)).toBe(-quantidade)

    // ---------------------------------------------------------------
    // 10. Comprovante com o aviso obrigatorio, gerado a partir da venda
    //     real (nao um texto fixo desconectado do que foi vendido).
    // ---------------------------------------------------------------
    const reciboRes = await app.inject({ method: 'GET', url: `/vendas/${vendaId}/recibo`, cookies })
    expect(reciboRes.statusCode).toBe(200)
    const recibo = reciboRes.json() as { linhas: string[]; escPosBase64: string }
    expect(recibo.linhas.filter((l) => l.includes(AVISO_SEM_VALOR_FISCAL))).toHaveLength(2)
    expect(recibo.linhas.some((l) => l.includes('Cerveja Pilsen'))).toBe(true)
    const bytesEscPos = Buffer.from(recibo.escPosBase64, 'base64')
    expect(bytesEscPos[0]).toBe(0x1b) // ESC -- contrato ESC/POS de verdade, nao so texto solto
    expect(bytesEscPos[1]).toBe(0x40)

    // ---------------------------------------------------------------
    // 11. Venda consultavel (localizar + inspecionar).
    // ---------------------------------------------------------------
    const listaRes = await app.inject({ method: 'GET', url: '/vendas', cookies })
    expect(listaRes.statusCode).toBe(200)
    expect((listaRes.json().vendas as Array<{ id: string }>).map((v) => v.id)).toContain(vendaId)

    const detalheRes = await app.inject({ method: 'GET', url: `/vendas/${vendaId}`, cookies })
    expect(detalheRes.statusCode).toBe(200)
    const detalhe = detalheRes.json() as {
      operador: { nome: string } | null
      caixaSessao: { id: string } | null
      itens: Array<{ descricao: string }>
    }
    expect(detalhe.operador?.nome).toBe('Operador Teste')
    expect(detalhe.caixaSessao?.id).toBe(sessaoCaixaId)
    expect(detalhe.itens[0]?.descricao).toBe('Cerveja Pilsen Lata 350ml')

    // ---------------------------------------------------------------
    // 9. Movimento de caixa coerente: o fechamento (checkpoint 12) tem
    //    que refletir fundo + venda em dinheiro (liquida de troco) +
    //    suprimento -- e aqui que a coerencia e provada de verdade, com
    //    numeros, nao so "existe uma linha na tabela".
    //    esperado = 10000 (fundo) + 1650 (venda liquida, sem o troco) +
    //               2000 (suprimento) = 13650
    // ---------------------------------------------------------------
    const valorContado = 13650

    // ---------------------------------------------------------------
    // 12. Caixa fechavel conforme as regras existentes (fechamento cego:
    //     o valor contado e enviado ANTES de qualquer leitura de
    //     "esperado" pelo teste, exatamente como a UI e obrigada a
    //     fazer) -- e a trava de terminal unico continua valendo depois.
    // ---------------------------------------------------------------
    const fechamentoRes = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { valorContado },
      cookies,
    })
    expect(fechamentoRes.statusCode).toBe(200)
    const fechamento = fechamentoRes.json().fechamento as {
      esperado: number
      contado: number
      diferenca: number
    }
    expect(fechamento.esperado).toBe(valorContado) // prova a coerencia numerica do checkpoint 9
    expect(fechamento.contado).toBe(valorContado)
    expect(fechamento.diferenca).toBe(0)

    const caixaAposFechar = await app.inject({ method: 'GET', url: '/caixa/atual', cookies })
    expect(caixaAposFechar.json().sessao).toBeNull() // terminal unico: nenhuma sessao aberta agora
  })
})
