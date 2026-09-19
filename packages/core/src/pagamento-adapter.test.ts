import { describe, expect, it } from 'vitest'
import { centavos } from './dinheiro'
import { ManualAdapter } from './pagamento-adapter'
import { FORMAS_PAGAMENTO } from './venda'

describe('ManualAdapter', () => {
  it.each(FORMAS_PAGAMENTO)('confirma pagamento em %s sem chamar nenhuma adquirente', (forma) => {
    const resultado = ManualAdapter.processar({ forma, valor: centavos(1000) })
    expect(resultado.confirmado).toBe(true)
    expect(resultado.observacao).toContain(forma)
  })

  it('nunca inventa dados de adquirente (nsu, autorizacao, bandeira, parcelas)', () => {
    const resultado = ManualAdapter.processar({ forma: 'credito', valor: centavos(5000) })
    expect(resultado.adquirente).toBeNull()
    expect(resultado.nsu).toBeNull()
    expect(resultado.autorizacao).toBeNull()
    expect(resultado.bandeira).toBeNull()
    expect(resultado.parcelas).toBeNull()
  })
})
