import { eq } from 'drizzle-orm'
import * as schema from './schema'
import { aplicarMovimentoEstoque, type Executor } from './repositorios/estoque'
import { hashSenha } from './senha'

/**
 * Seed de AMBIENTE DE TESTE/DEV. Nunca e chamado automaticamente em producao --
 * veja `seed-cli.ts` para a trava explicita que impede rodar isso sem intencao.
 *
 * IDs fixos (nao aleatorios) de proposito: torna o seed idempotente (rodar
 * duas vezes atualiza os mesmos registros em vez de duplicar) e permite que
 * testes de integracao referenciem esses IDs sem precisar consultar o banco
 * primeiro.
 */
export const SEED_IDS = {
  usuarioAdmin: '00000000-0000-7000-8000-00000000a001',
  usuarioOperador: '00000000-0000-7000-8000-00000000a002',
  dispositivoPdv: '00000000-0000-7000-8000-00000000a003',
  categoria: '00000000-0000-7000-8000-00000000a004',
  produtos: {
    cervejaLata: '00000000-0000-7000-8000-00000000b001',
    refrigerante: '00000000-0000-7000-8000-00000000b002',
    agua: '00000000-0000-7000-8000-00000000b003',
    salgadinho: '00000000-0000-7000-8000-00000000b004',
    vinho: '00000000-0000-7000-8000-00000000b005',
  },
} as const

export const SEED_CREDENCIAIS_DEV = {
  adminEmail: 'admin@adega.local',
  adminSenha: 'trocar-esta-senha-123',
  operadorNome: 'Operador Teste',
  operadorPin: '135790',
} as const

interface ProdutoSeed {
  readonly id: string
  readonly ean: string
  readonly descricao: string
  readonly precoVenda: number
  readonly custoMedio: number
  readonly estoqueInicial: number
}

const PRODUTOS_SEED: readonly ProdutoSeed[] = [
  {
    id: SEED_IDS.produtos.cervejaLata,
    ean: '7891000100019',
    descricao: 'Cerveja Pilsen Lata 350ml',
    precoVenda: 550,
    custoMedio: 320,
    estoqueInicial: 120,
  },
  {
    id: SEED_IDS.produtos.refrigerante,
    ean: '7891000100026',
    descricao: 'Refrigerante Cola 2L',
    precoVenda: 900,
    custoMedio: 550,
    estoqueInicial: 40,
  },
  {
    id: SEED_IDS.produtos.agua,
    ean: '7891000100033',
    descricao: 'Agua Mineral 500ml',
    precoVenda: 300,
    custoMedio: 150,
    estoqueInicial: 80,
  },
  {
    id: SEED_IDS.produtos.salgadinho,
    ean: '7891000100040',
    descricao: 'Salgadinho Batata 100g',
    precoVenda: 750,
    custoMedio: 480,
    estoqueInicial: 25,
  },
  {
    id: SEED_IDS.produtos.vinho,
    ean: '7891000100057',
    descricao: 'Vinho Tinto Seco 750ml',
    precoVenda: 3490,
    custoMedio: 2100,
    estoqueInicial: 15,
  },
]

/**
 * Popula usuario admin, operador, dispositivo de PDV e 5 produtos com estoque
 * inicial. Idempotente: pode ser chamado varias vezes (upsert por ID fixo)
 * sem duplicar linhas nem re-somar estoque a cada chamada.
 */
export async function seedDados(db: Executor): Promise<void> {
  const senhaHashAdmin = await hashSenha(SEED_CREDENCIAIS_DEV.adminSenha)
  const pinHashOperador = await hashSenha(SEED_CREDENCIAIS_DEV.operadorPin)

  await db
    .insert(schema.usuarios)
    .values({
      id: SEED_IDS.usuarioAdmin,
      nome: 'Admin (seed)',
      email: SEED_CREDENCIAIS_DEV.adminEmail,
      senhaHash: senhaHashAdmin,
      perfil: 'admin',
    })
    .onConflictDoUpdate({
      target: schema.usuarios.id,
      set: { senhaHash: senhaHashAdmin, ativo: true },
    })

  await db
    .insert(schema.usuarios)
    .values({
      id: SEED_IDS.usuarioOperador,
      nome: SEED_CREDENCIAIS_DEV.operadorNome,
      email: 'operador@adega.local',
      pinHash: pinHashOperador,
      perfil: 'caixa',
    })
    .onConflictDoUpdate({
      target: schema.usuarios.id,
      set: { pinHash: pinHashOperador, ativo: true },
    })

  await db
    .insert(schema.dispositivos)
    .values({
      id: SEED_IDS.dispositivoPdv,
      nome: 'PDV Balcao (seed/dev)',
      tokenHash: await hashSenha('dispositivo-seed-nao-usar-em-producao'),
    })
    .onConflictDoNothing({ target: schema.dispositivos.id })

  await db
    .insert(schema.categorias)
    .values({ id: SEED_IDS.categoria, nome: 'Geral (seed)' })
    .onConflictDoNothing({ target: schema.categorias.id })

  for (const produto of PRODUTOS_SEED) {
    await db
      .insert(schema.produtos)
      .values({
        id: produto.id,
        ean: produto.ean,
        descricao: produto.descricao,
        categoriaId: SEED_IDS.categoria,
        precoVenda: produto.precoVenda,
        custoMedio: produto.custoMedio,
      })
      .onConflictDoUpdate({
        target: schema.produtos.id,
        set: {
          precoVenda: produto.precoVenda,
          custoMedio: produto.custoMedio,
          atualizadoEm: new Date(),
        },
      })

    const [saldoExistente] = await db
      .select({ produtoId: schema.estoqueSaldos.produtoId })
      .from(schema.estoqueSaldos)
      .where(eq(schema.estoqueSaldos.produtoId, produto.id))

    if (!saldoExistente) {
      // Produto novo no seed: cria a linha de saldo zerada e registra a
      // entrada inicial pelo MESMO caminho que qualquer entrada real usaria
      // (aplicarMovimentoEstoque) -- o seed nao inventa um atalho que a
      // invariante SUM(movimentos) == saldo nao cobriria.
      await db.insert(schema.estoqueSaldos).values({ produtoId: produto.id, quantidade: '0' })
      await db.transaction(async (tx) => {
        await aplicarMovimentoEstoque(tx, {
          id: crypto.randomUUID(),
          produtoId: produto.id,
          tipo: 'entrada',
          quantidade: produto.estoqueInicial,
          custoUnitario: produto.custoMedio,
          origemTipo: 'seed',
          usuarioId: SEED_IDS.usuarioAdmin,
          observacao: 'Estoque inicial de seed (ambiente de teste/dev).',
          ocorridoEm: new Date(),
        })
      })
    }
    // Se ja existe saldo, o seed e re-executado (idempotencia) e nao mexe no
    // estoque de novo -- so preco/descricao do produto sao atualizados acima.
  }
}
