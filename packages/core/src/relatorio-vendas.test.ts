import { describe, expect, it } from 'vitest'
import { centavos, ZERO } from './dinheiro'
import {
  agruparPorFormaPagamento,
  agruparPorMaquininha,
  calcularTotalPeriodo,
  gerarXmlRelatorioVendas,
  type DadosRelatorioVendas,
  type VendaRelatorio,
} from './relatorio-vendas'

function venda(parcial: Partial<VendaRelatorio> = {}): VendaRelatorio {
  return {
    vendaId: '01920000-0000-7000-8000-000000000001',
    numero: 1,
    ocorridoEm: new Date('2026-09-10T12:00:00.000Z'),
    total: centavos(1000),
    pagamentos: [{ forma: 'dinheiro', valor: centavos(1000), terminalApelido: null }],
    ...parcial,
  }
}

function dados(vendas: readonly VendaRelatorio[]): DadosRelatorioVendas {
  return {
    periodoInicio: new Date('2026-09-01T00:00:00.000Z'),
    periodoFim: new Date('2026-09-30T23:59:59.000Z'),
    vendas,
  }
}

describe('calcularTotalPeriodo', () => {
  it('soma o total das vendas, nao dos pagamentos (uma venda pode ter varios pagamentos)', () => {
    const total = calcularTotalPeriodo(
      dados([
        venda({
          total: centavos(1000),
          pagamentos: [
            { forma: 'dinheiro', valor: centavos(400), terminalApelido: null },
            { forma: 'credito', valor: centavos(600), terminalApelido: 'Maquininha 1' },
          ],
        }),
        venda({ total: centavos(500) }),
      ]),
    )
    expect(total).toBe(centavos(1500))
  })

  it('periodo sem vendas soma zero', () => {
    expect(calcularTotalPeriodo(dados([]))).toBe(ZERO)
  })
})

describe('agruparPorFormaPagamento', () => {
  it('agrupa e soma por forma, uma linha por forma distinta', () => {
    const grupos = agruparPorFormaPagamento(
      dados([
        venda({
          pagamentos: [
            { forma: 'dinheiro', valor: centavos(400), terminalApelido: null },
            { forma: 'pix', valor: centavos(600), terminalApelido: null },
          ],
        }),
        venda({ pagamentos: [{ forma: 'dinheiro', valor: centavos(200), terminalApelido: null }] }),
      ]),
    )
    expect(grupos).toEqual([
      { chave: 'dinheiro', total: centavos(600), quantidade: 2 },
      { chave: 'pix', total: centavos(600), quantidade: 1 },
    ])
  })
})

describe('agruparPorMaquininha', () => {
  it('separa debito/credito por apelido de maquininha, ignora dinheiro e pix', () => {
    const grupos = agruparPorMaquininha(
      dados([
        venda({
          pagamentos: [
            { forma: 'credito', valor: centavos(300), terminalApelido: 'Maquininha 1' },
            { forma: 'debito', valor: centavos(200), terminalApelido: 'Maquininha 2' },
            { forma: 'dinheiro', valor: centavos(100), terminalApelido: null },
          ],
        }),
        venda({
          pagamentos: [{ forma: 'credito', valor: centavos(150), terminalApelido: 'Maquininha 1' }],
        }),
      ]),
    )
    expect(grupos).toEqual([
      { chave: 'Maquininha 1', total: centavos(450), quantidade: 2 },
      { chave: 'Maquininha 2', total: centavos(200), quantidade: 1 },
    ])
  })

  it('pagamento de cartao sem maquininha informada cai em "Nao identificada", nunca e descartado', () => {
    const grupos = agruparPorMaquininha(
      dados([
        venda({
          pagamentos: [{ forma: 'credito', valor: centavos(500), terminalApelido: null }],
        }),
      ]),
    )
    expect(grupos).toEqual([{ chave: 'Nao identificada', total: centavos(500), quantidade: 1 }])
  })

  it('sem nenhum pagamento de cartao no periodo, o grupo fica vazio', () => {
    expect(agruparPorMaquininha(dados([venda()]))).toEqual([])
  })
})

describe('gerarXmlRelatorioVendas', () => {
  it('e XML bem formado com o periodo, o total combinado e a quebra por maquininha', () => {
    const xml = gerarXmlRelatorioVendas(
      dados([
        venda({
          vendaId: '01920000-0000-7000-8000-000000000002',
          numero: 7,
          total: centavos(900),
          pagamentos: [{ forma: 'credito', valor: centavos(900), terminalApelido: 'Maquininha 1' }],
        }),
      ]),
    )

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<Periodo inicio="2026-09-01" fim="2026-09-30" />')
    expect(xml).toContain('<QuantidadeVendas>1</QuantidadeVendas>')
    expect(xml).toContain('valor="9.00"') // total da venda em reais, cru
    expect(xml).toContain('<Maquininha apelido="Maquininha 1"')
    expect(xml).toContain('numero="7"')
  })

  it('escapa caracteres especiais no apelido da maquininha (nunca quebra o XML)', () => {
    const xml = gerarXmlRelatorioVendas(
      dados([
        venda({
          pagamentos: [
            { forma: 'debito', valor: centavos(100), terminalApelido: 'Maquina & Cia <2>' },
          ],
        }),
      ]),
    )
    expect(xml).toContain('Maquina &amp; Cia &lt;2&gt;')
    expect(xml).not.toContain('Maquina & Cia <2>')
  })

  it('e deterministico: a mesma entrada produz sempre a mesma saida', () => {
    const entrada = dados([venda()])
    expect(gerarXmlRelatorioVendas(entrada)).toBe(gerarXmlRelatorioVendas(entrada))
  })

  it('periodo sem vendas gera XML valido com total zero', () => {
    const xml = gerarXmlRelatorioVendas(dados([]))
    expect(xml).toContain('<QuantidadeVendas>0</QuantidadeVendas>')
    expect(xml).toContain('valor="0.00"')
  })
})
