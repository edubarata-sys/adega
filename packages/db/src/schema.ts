import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Schema da Fase 1 -- arquitetura v2.
 *
 * Convencoes inegociaveis:
 * - dinheiro e bigint em CENTAVOS (nunca numeric, nunca float);
 * - id e uuid v7 gerado pela APLICACAO (o cliente offline precisa gerar sem banco);
 * - tempo e timestamptz em UTC;
 * - ledger e append-only e NAO tem coluna derivada.
 */

const dinheiro = (nome: string) => bigint(nome, { mode: 'number' })
const quantidade = (nome: string) => numeric(nome, { precision: 14, scale: 3 })
const agora = () => timestamp({ withTimezone: true, mode: 'date' })

export const unidadeProduto = pgEnum('unidade_produto', ['UN', 'KG', 'L'])
export const tipoMovimentoEstoque = pgEnum('tipo_movimento_estoque', [
  'entrada',
  'venda',
  'ajuste',
  'perda',
  'devolucao',
])
export const statusVenda = pgEnum('status_venda', ['aberta', 'paga', 'cancelada'])
export const formaPagamento = pgEnum('forma_pagamento', [
  'dinheiro',
  'pix',
  'debito',
  'credito',
  'voucher',
])
export const conciliacaoStatus = pgEnum('conciliacao_status', [
  'pendente',
  'conciliado',
  'ambiguo',
  'divergente',
  'ignorado',
])
export const tipoMovimentoCaixa = pgEnum('tipo_movimento_caixa', [
  'sangria',
  'suprimento',
  'despesa',
  'entrada_avulsa',
])
export const perfilUsuario = pgEnum('perfil_usuario', ['admin', 'caixa'])

export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid().primaryKey(),
    nome: text().notNull(),
    email: text().notNull(),
    senhaHash: text(),
    /** PIN curto para troca de turno no balcao. Ver arquitetura §4. */
    pinHash: text(),
    perfil: perfilUsuario().notNull(),
    ativo: boolean().notNull().default(true),
    ultimoAcesso: agora(),
    criadoEm: agora().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usuarios_email_idx').on(t.email)],
)

/** Terminal de PDV autorizado. Fase 1 assume UM unico terminal (arquitetura §2.1). */
export const dispositivos = pgTable('dispositivos', {
  id: uuid().primaryKey(),
  nome: text().notNull(),
  tokenHash: text().notNull(),
  ativo: boolean().notNull().default(true),
  ultimoSync: agora(),
  criadoEm: agora().notNull().defaultNow(),
})

export const categorias = pgTable('categorias', {
  id: uuid().primaryKey(),
  nome: text().notNull(),
  ativo: boolean().notNull().default(true),
  criadoEm: agora().notNull().defaultNow(),
})

export const produtos = pgTable(
  'produtos',
  {
    id: uuid().primaryKey(),
    codigoInterno: text(),
    /** Nulo em granel/fracionado, por isso nao e chave. */
    ean: text(),
    descricao: text().notNull(),
    descricaoPdv: text(),
    unidade: unidadeProduto().notNull().default('UN'),
    categoriaId: uuid().references(() => categorias.id),
    precoVenda: dinheiro('preco_venda').notNull(),
    custoMedio: dinheiro('custo_medio').notNull().default(0),
    estoqueMinimo: quantidade('estoque_minimo').notNull().default('0'),
    ativo: boolean().notNull().default(true),

    // Fiscais: existem desde ja, ficam nulos na Fase 1 (arquitetura §11).
    ncm: text(),
    cest: text(),
    cfop: text(),
    cstCsosn: text(),
    origem: text(),

    criadoEm: agora().notNull().defaultNow(),
    atualizadoEm: agora().notNull().defaultNow(),
  },
  (t) => [
    // NAO unico (25/09): o mesmo codigo de barras pode estar em mais de um
    // produto (gelo por sabor, Coca normal/Zero com o mesmo codigo). O caixa
    // pergunta qual e quando o codigo bate em mais de um.
    index('produtos_ean_idx').on(t.ean),
    index('produtos_descricao_idx').on(t.descricao),
    index('produtos_atualizado_em_idx').on(t.atualizadoEm),
  ],
)

/**
 * Ledger de estoque. APPEND-ONLY, SEM COLUNA DERIVADA.
 *
 * Nao existe `saldo_apos`: valor posicional e incompativel com sync fora de
 * ordem -- uma venda antiga chegando obrigaria a reescrever toda linha
 * posterior, mutando um ledger que se declara imutavel.
 */
export const estoqueMovimentos = pgTable(
  'estoque_movimentos',
  {
    id: uuid().primaryKey(),
    produtoId: uuid()
      .notNull()
      .references(() => produtos.id),
    tipo: tipoMovimentoEstoque().notNull(),
    /** Assinada: negativa em venda e perda. */
    quantidade: quantidade('quantidade').notNull(),
    custoUnitario: dinheiro('custo_unitario'),
    origemTipo: text(),
    origemId: uuid(),
    usuarioId: uuid().references(() => usuarios.id),
    observacao: text(),
    /** Quando aconteceu no balcao (relogio do cliente). */
    ocorridoEm: agora().notNull(),
    /** Quando chegou no servidor. Nao e o mesmo dado que `ocorridoEm`. */
    registradoEm: agora().notNull().defaultNow(),
  },
  (t) => [
    index('estoque_mov_produto_idx').on(t.produtoId, t.ocorridoEm),
    index('estoque_mov_origem_idx').on(t.origemTipo, t.origemId),
  ],
)

/**
 * Cache de saldo corrente -- NAO e a verdade, e projecao do ledger.
 *
 * Atualizado por `quantidade = quantidade + delta` na MESMA transacao do insert
 * do movimento. Soma e comutativa, logo o resultado independe da ordem de
 * chegada. Invariante verificada por job: SUM(movimentos) == saldos.quantidade.
 */
export const estoqueSaldos = pgTable('estoque_saldos', {
  produtoId: uuid()
    .primaryKey()
    .references(() => produtos.id),
  quantidade: quantidade('quantidade').notNull().default('0'),
  versao: integer().notNull().default(0),
  atualizadoEm: agora().notNull().defaultNow(),
})

export const caixaSessoes = pgTable('caixa_sessoes', {
  id: uuid().primaryKey(),
  dispositivoId: uuid().references(() => dispositivos.id),
  usuarioAberturaId: uuid()
    .notNull()
    .references(() => usuarios.id),
  abertoEm: agora().notNull(),
  fundoTroco: dinheiro('fundo_troco').notNull().default(0),
  usuarioFechamentoId: uuid().references(() => usuarios.id),
  fechadoEm: agora(),
  valorContado: dinheiro('valor_contado'),
  valorEsperado: dinheiro('valor_esperado'),
  diferenca: dinheiro('diferenca'),
  /** Sessao fechada que recebeu movimento depois. Nunca alterar numero em silencio. */
  temAjustePosterior: boolean().notNull().default(false),
  observacao: text(),
})

export const caixaMovimentos = pgTable(
  'caixa_movimentos',
  {
    id: uuid().primaryKey(),
    sessaoId: uuid()
      .notNull()
      .references(() => caixaSessoes.id),
    tipo: tipoMovimentoCaixa().notNull(),
    valor: dinheiro('valor').notNull(),
    descricao: text().notNull(),
    usuarioId: uuid()
      .notNull()
      .references(() => usuarios.id),
    criadoEm: agora().notNull().defaultNow(),
  },
  (t) => [index('caixa_mov_sessao_idx').on(t.sessaoId)],
)

export const vendas = pgTable(
  'vendas',
  {
    /** Gerado NO CLIENTE. Chave de idempotencia do sync. */
    id: uuid().primaryKey(),
    /** Atribuido na chegada; NAO e cronologico (arquitetura §2). */
    numero: integer(),
    sessaoCaixaId: uuid().references(() => caixaSessoes.id),
    dispositivoId: uuid().references(() => dispositivos.id),
    usuarioId: uuid()
      .notNull()
      .references(() => usuarios.id),
    status: statusVenda().notNull().default('aberta'),
    subtotal: dinheiro('subtotal').notNull(),
    desconto: dinheiro('desconto').notNull().default(0),
    total: dinheiro('total').notNull(),
    ocorridoEm: agora().notNull(),
    registradoEm: agora().notNull().defaultNow(),
    canceladaEm: agora(),
    canceladaPor: uuid().references(() => usuarios.id),
    motivoCancelamento: text(),
  },
  (t) => [
    index('vendas_ocorrido_em_idx').on(t.ocorridoEm),
    index('vendas_sessao_idx').on(t.sessaoCaixaId),
  ],
)

export const vendaItens = pgTable(
  'venda_itens',
  {
    id: uuid().primaryKey(),
    vendaId: uuid()
      .notNull()
      .references(() => vendas.id),
    produtoId: uuid()
      .notNull()
      .references(() => produtos.id),
    quantidade: quantidade('quantidade').notNull(),
    /** Copia, nao leitura por FK: mudar preco hoje nao reescreve a margem de ontem. */
    precoUnitario: dinheiro('preco_unitario').notNull(),
    custoUnitario: dinheiro('custo_unitario').notNull().default(0),
    descontoItem: dinheiro('desconto_item').notNull().default(0),
    totalItem: dinheiro('total_item').notNull(),
  },
  (t) => [index('venda_itens_venda_idx').on(t.vendaId)],
)

export const conciliacaoLotes = pgTable('conciliacao_lotes', {
  id: uuid().primaryKey(),
  arquivo: text().notNull(),
  periodoInicio: agora(),
  periodoFim: agora(),
  importadoEm: agora().notNull().defaultNow(),
  importadoPor: uuid().references(() => usuarios.id),
})

/** Linha bruta do extrato da adquirente. IMUTAVEL -- nunca se edita a origem. */
export const conciliacaoItens = pgTable(
  'conciliacao_itens',
  {
    id: uuid().primaryKey(),
    loteId: uuid()
      .notNull()
      .references(() => conciliacaoLotes.id),
    linhaBruta: jsonb().notNull(),
    valor: dinheiro('valor').notNull(),
    ocorridoEm: agora(),
    nsu: text(),
    bandeira: text(),
    status: conciliacaoStatus().notNull().default('pendente'),
  },
  (t) => [index('conciliacao_itens_busca_idx').on(t.valor, t.ocorridoEm)],
)

export const pagamentos = pgTable(
  'pagamentos',
  {
    id: uuid().primaryKey(),
    /** N pagamentos por venda: venda dividida e rotina em adega. */
    vendaId: uuid()
      .notNull()
      .references(() => vendas.id),
    forma: formaPagamento().notNull(),
    valor: dinheiro('valor').notNull(),
    troco: dinheiro('troco').notNull().default(0),
    criadoEm: agora().notNull().defaultNow(),

    conciliacaoStatus: conciliacaoStatus().notNull().default('pendente'),
    conciliacaoItemId: uuid().references(() => conciliacaoItens.id),
    conciliadoEm: agora(),
    conciliadoPor: uuid().references(() => usuarios.id),

    // Porta de integracao com a adquirente. Nulos na Fase 1 (arquitetura §6).
    adquirente: text(),
    nsu: text(),
    autorizacao: text(),
    bandeira: text(),
    parcelas: integer(),

    /**
     * Apelido informado pelo operador pra identificar QUAL maquininha fisica
     * recebeu o pagamento (ex.: "Maquininha 1", "Itau"), quando ha mais de
     * uma na loja. Texto livre de proposito -- nao e integracao com
     * adquirente (isso continua fora do escopo, ver campos acima), so
     * permite separar o relatorio de vendas por maquininha depois. Nulo pra
     * pagamentos em dinheiro/pix ou quando so existe uma maquininha.
     */
    terminalApelido: text(),
  },
  (t) => [
    index('pagamentos_venda_idx').on(t.vendaId),
    index('pagamentos_conciliacao_idx').on(t.conciliacaoStatus),
  ],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey(),
    usuarioId: uuid().references(() => usuarios.id),
    acao: text().notNull(),
    entidade: text().notNull(),
    entidadeId: uuid(),
    dadosAntes: jsonb(),
    dadosDepois: jsonb(),
    ip: text(),
    criadoEm: agora().notNull().defaultNow(),
  },
  (t) => [index('audit_entidade_idx').on(t.entidade, t.entidadeId)],
)
