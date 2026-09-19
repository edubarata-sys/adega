import { describe, expect, it } from 'vitest'
import { centavos } from './dinheiro'
import {
  AVISO_SEM_VALOR_FISCAL,
  gerarComandosEscPos,
  gerarLinhasRecibo,
  LARGURA_RECIBO_58MM,
  type DadosRecibo,
} from './recibo'

function dadosBase(parcial: Partial<DadosRecibo> = {}): DadosRecibo {
  return {
    vendaId: '01920000-0000-7000-8000-000000000001',
    numero: 42,
    itens: [
      {
        descricao: 'Cerveja Pilsen Lata 350ml',
        quantidade: 2,
        precoUnitario: centavos(550),
        total: centavos(1100),
      },
    ],
    subtotal: centavos(1100),
    desconto: centavos(0),
    total: centavos(1100),
    pagamentos: [{ forma: 'dinheiro', valor: centavos(1200), troco: centavos(100) }],
    operadorNome: 'Operador Teste',
    ocorridoEm: new Date('2026-09-10T12:00:00.000Z'),
    ...parcial,
  }
}

describe('gerarLinhasRecibo', () => {
  it('sempre inclui o aviso obrigatorio de que nao tem valor fiscal', () => {
    const linhas = gerarLinhasRecibo(dadosBase())
    expect(linhas.some((l) => l.includes(AVISO_SEM_VALOR_FISCAL))).toBe(true)
    // Aparece pelo menos duas vezes (cabecalho e rodape) -- nao deve ser
    // possivel um recibo sair so com uma mencao facil de nao notar.
    expect(linhas.filter((l) => l.includes(AVISO_SEM_VALOR_FISCAL))).toHaveLength(2)
  })

  it('nenhuma linha excede a largura da bobina de 58mm', () => {
    const linhas = gerarLinhasRecibo(
      dadosBase({
        itens: [
          {
            descricao: 'Um produto com uma descricao bem comprida para testar a quebra de linha',
            quantidade: 1,
            precoUnitario: centavos(100),
            total: centavos(100),
          },
        ],
      }),
    )
    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(LARGURA_RECIBO_58MM)
    }
  })

  it('e deterministico: a mesma entrada produz sempre a mesma saida', () => {
    const dados = dadosBase()
    expect(gerarLinhasRecibo(dados)).toEqual(gerarLinhasRecibo(dados))
  })

  it('mostra o total e o troco quando ha pagamento em dinheiro com troco', () => {
    const linhas = gerarLinhasRecibo(dadosBase())
    expect(linhas.some((l) => l.includes('TOTAL') && l.includes('R$ 11,00'))).toBe(true)
    expect(linhas.some((l) => l.includes('Troco') && l.includes('R$ 1,00'))).toBe(true)
  })

  it('nao mostra linha de desconto quando nao ha desconto', () => {
    const linhas = gerarLinhasRecibo(dadosBase({ desconto: centavos(0) }))
    expect(linhas.some((l) => l.includes('Desconto'))).toBe(false)
  })

  it('mostra desconto quando presente', () => {
    const linhas = gerarLinhasRecibo(
      dadosBase({ subtotal: centavos(1200), desconto: centavos(100), total: centavos(1100) }),
    )
    expect(linhas.some((l) => l.includes('Desconto'))).toBe(true)
  })
})

describe('gerarComandosEscPos', () => {
  it('comeca com o comando de inicializacao ESC @', () => {
    const bytes = gerarComandosEscPos(gerarLinhasRecibo(dadosBase()))
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
  })

  it('termina com o comando de corte de papel GS V 1', () => {
    const bytes = gerarComandosEscPos(gerarLinhasRecibo(dadosBase()))
    expect(bytes.at(-3)).toBe(0x1d)
    expect(bytes.at(-2)).toBe(0x56)
    expect(bytes.at(-1)).toBe(0x01)
  })

  it('e deterministico', () => {
    const linhas = gerarLinhasRecibo(dadosBase())
    expect(gerarComandosEscPos(linhas)).toEqual(gerarComandosEscPos(linhas))
  })

  it('o texto codificado contem o aviso obrigatorio', () => {
    const linhas = gerarLinhasRecibo(dadosBase())
    const bytes = gerarComandosEscPos(linhas)
    const texto = new TextDecoder().decode(bytes)
    expect(texto).toContain(AVISO_SEM_VALOR_FISCAL)
  })
})
