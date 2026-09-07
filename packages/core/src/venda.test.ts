import { describe, expect, it } from 'vitest'
import { centavos } from './dinheiro'
import { calcularItem, calcularVenda, conferirPagamentos } from './venda'

const c = centavos

describe('calcularItem', () => {
  it('calcula bruto e total com desconto', () => {
    const r = calcularItem({ quantidade: 2, precoUnitario: c(1250), descontoItem: c(100) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.bruto).toBe(2500)
    expect(r.valor.total).toBe(2400)
  })

  it('recusa quantidade zero ou negativa', () => {
    expect(calcularItem({ quantidade: 0, precoUnitario: c(100) }).ok).toBe(false)
    expect(calcularItem({ quantidade: -1, precoUnitario: c(100) }).ok).toBe(false)
  })

  it('recusa desconto maior que o proprio item', () => {
    const r = calcularItem({ quantidade: 1, precoUnitario: c(500), descontoItem: c(501) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('ITEM_DESCONTO_MAIOR_QUE_ITEM')
  })
})

describe('calcularVenda', () => {
  it('soma itens e aplica desconto geral', () => {
    const r = calcularVenda(
      [
        { quantidade: 2, precoUnitario: c(1250) },
        { quantidade: 1, precoUnitario: c(890) },
      ],
      c(140),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.subtotal).toBe(3390)
    expect(r.valor.total).toBe(3250)
  })

  it('recusa venda sem itens', () => {
    const r = calcularVenda([])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('VENDA_SEM_ITENS')
  })

  it('recusa desconto maior que o subtotal, para o total nunca ficar negativo', () => {
    const r = calcularVenda([{ quantidade: 1, precoUnitario: c(1000) }], c(1001))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('VENDA_DESCONTO_MAIOR_QUE_TOTAL')
  })

  it('propaga erro do item', () => {
    const r = calcularVenda([{ quantidade: 0, precoUnitario: c(100) }])
    expect(r.ok).toBe(false)
  })
})

describe('conferirPagamentos', () => {
  it('aceita pagamento exato', () => {
    const r = conferirPagamentos(c(3250), [{ forma: 'debito', valor: c(3250) }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.troco).toBe(0)
  })

  it('devolve troco quando o excedente e em dinheiro', () => {
    const r = conferirPagamentos(c(3250), [{ forma: 'dinheiro', valor: c(5000) }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.troco).toBe(1750)
  })

  it('aceita venda dividida entre dinheiro e cartao', () => {
    const r = conferirPagamentos(c(10000), [
      { forma: 'dinheiro', valor: c(4000) },
      { forma: 'credito', valor: c(6000) },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.troco).toBe(0)
  })

  it('recusa cartao acima do total: maquininha nao devolve troco', () => {
    const r = conferirPagamentos(c(3250), [{ forma: 'credito', valor: c(4000) }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('PAGAMENTO_SEM_TROCO_EXCEDE')
  })

  it('recusa pix acima do total', () => {
    const r = conferirPagamentos(c(1000), [
      { forma: 'pix', valor: c(900) },
      { forma: 'pix', valor: c(200) },
    ])
    expect(r.ok).toBe(false)
  })

  it('recusa pagamento insuficiente e diz quanto falta', () => {
    const r = conferirPagamentos(c(3250), [{ forma: 'dinheiro', valor: c(3000) }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.codigo).toBe('PAGAMENTO_INSUFICIENTE')
    expect(r.erro.mensagem).toContain('R$ 2,50')
  })

  it('recusa venda sem pagamento', () => {
    expect(conferirPagamentos(c(100), []).ok).toBe(false)
  })
})
