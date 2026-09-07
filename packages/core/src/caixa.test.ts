import { describe, expect, it } from 'vitest'
import { calcularFechamento, podeFecharCaixa } from './caixa'
import { centavos } from './dinheiro'

const c = centavos

describe('calcularFechamento', () => {
  it('soma fundo de troco e vendas em dinheiro', () => {
    const f = calcularFechamento({
      fundoTroco: c(10000),
      vendasEmDinheiro: c(45000),
      movimentos: [],
      valorContado: c(55000),
    })
    expect(f.esperado).toBe(55000)
    expect(f.diferenca).toBe(0)
  })

  it('sangria e despesa reduzem o esperado; suprimento aumenta', () => {
    const f = calcularFechamento({
      fundoTroco: c(10000),
      vendasEmDinheiro: c(45000),
      movimentos: [
        { tipo: 'sangria', valor: c(30000) },
        { tipo: 'despesa', valor: c(2500) },
        { tipo: 'suprimento', valor: c(5000) },
        { tipo: 'entrada_avulsa', valor: c(1000) },
      ],
      valorContado: c(28500),
    })
    expect(f.esperado).toBe(28500)
    expect(f.diferenca).toBe(0)
  })

  it('diferenca negativa quando falta dinheiro na gaveta', () => {
    const f = calcularFechamento({
      fundoTroco: c(10000),
      vendasEmDinheiro: c(20000),
      movimentos: [],
      valorContado: c(29000),
    })
    expect(f.diferenca).toBe(-1000)
  })

  it('cartao e pix nao entram no esperado porque nao passam pela gaveta', () => {
    // Mesmo fechamento, com R$ 900 vendidos em cartao no periodo:
    // vendasEmDinheiro nao muda, logo o esperado nao muda.
    const base = {
      fundoTroco: c(10000),
      vendasEmDinheiro: c(20000),
      movimentos: [],
      valorContado: c(30000),
    } as const
    expect(calcularFechamento(base).esperado).toBe(30000)
    expect(calcularFechamento(base).diferenca).toBe(0)
  })

  it('recusa movimento com valor negativo', () => {
    expect(() =>
      calcularFechamento({
        fundoTroco: c(0),
        vendasEmDinheiro: c(0),
        movimentos: [{ tipo: 'sangria', valor: c(-1) }],
        valorContado: c(0),
      }),
    ).toThrow(RangeError)
  })
})

describe('podeFecharCaixa', () => {
  it('permite fechar com fila vazia', () => {
    expect(podeFecharCaixa({ status: 'aberta' }, { vendasPendentesNaFila: 0 }).ok).toBe(true)
  })

  it('RECUSA fechar com venda pendente na fila local', () => {
    const r = podeFecharCaixa({ status: 'aberta' }, { vendasPendentesNaFila: 3 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('CAIXA_COM_FILA_PENDENTE')
    expect(r.erro.mensagem).toContain('3')
  })

  it('recusa fechar sessao ja fechada', () => {
    const r = podeFecharCaixa({ status: 'fechada' }, { vendasPendentesNaFila: 0 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('CAIXA_JA_FECHADO')
  })

  it('trata contagem de fila invalida como erro de programacao', () => {
    expect(() => podeFecharCaixa({ status: 'aberta' }, { vendasPendentesNaFila: -1 })).toThrow(
      RangeError,
    )
  })
})
