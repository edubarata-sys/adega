-- ============================================================================
-- Adega Dois Irmaos -- 25/09/2026
-- Rodar no Railway: servico Postgres -> aba "Data" -> "Query" (ou psql).
-- Rode UM BLOCO POR VEZ, na ordem. Leia o resultado antes de ir pro proximo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCO 1 -- CONFERIR ANTES (so leitura, nao muda nada)
-- Quantos produtos tem estoque diferente de zero hoje.
-- ----------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE quantidade < 0)  AS negativos,
  count(*) FILTER (WHERE quantidade > 0)  AS positivos,
  count(*) FILTER (WHERE quantidade = 0)  AS zerados,
  count(*)                                AS total
FROM estoque_saldos;


-- ----------------------------------------------------------------------------
-- BLOCO 2 -- ZERAR TODO O ESTOQUE (recontagem)
--
-- NAO e um UPDATE simples no saldo: o sistema exige que o saldo seja sempre
-- a soma dos movimentos (estoque_movimentos). Por isso, pra cada produto com
-- saldo diferente de zero, lanca um movimento de "ajuste" do tamanho exato
-- pra levar a zero, e so depois zera o saldo. Fica tudo registrado
-- (origem 'recontagem_zerar'), da pra auditar e ate desfazer.
-- Tudo numa transacao: ou faz tudo, ou nao faz nada.
-- ----------------------------------------------------------------------------
BEGIN;

INSERT INTO estoque_movimentos
  (id, produto_id, tipo, quantidade, origem_tipo, observacao, ocorrido_em)
SELECT
  gen_random_uuid(),
  s.produto_id,
  'ajuste',
  -s.quantidade,
  'recontagem_zerar',
  'Zerado para recontagem 25/09/2026',
  now()
FROM estoque_saldos s
WHERE s.quantidade <> 0;

UPDATE estoque_saldos
SET quantidade = 0,
    versao = versao + 1,
    atualizado_em = now()
WHERE quantidade <> 0;

COMMIT;


-- ----------------------------------------------------------------------------
-- BLOCO 3 -- CONFERIR DEPOIS (so leitura)
-- Esperado: nao_zerados = 0 e divergencias = 0.
-- ----------------------------------------------------------------------------
SELECT count(*) AS nao_zerados FROM estoque_saldos WHERE quantidade <> 0;

SELECT count(*) AS divergencias
FROM estoque_saldos s
LEFT JOIN (
  SELECT produto_id, sum(quantidade) AS soma
  FROM estoque_movimentos
  GROUP BY produto_id
) m ON m.produto_id = s.produto_id
WHERE coalesce(m.soma, 0) <> s.quantidade;


-- ----------------------------------------------------------------------------
-- BLOCO 4 -- PRODUTOS ATIVOS SEM CUSTO MEDIO (so leitura)
-- Exporte o resultado (CSV) e me mande preenchido com o custo de cada um.
-- preco_venda e custo_medio estao em CENTAVOS no banco (1250 = R$ 12,50);
-- a coluna preco_venda_reais ja mostra em reais pra facilitar.
-- ----------------------------------------------------------------------------
SELECT
  p.id,
  p.ean,
  p.descricao,
  round(p.preco_venda / 100.0, 2) AS preco_venda_reais,
  NULL::numeric                   AS custo_reais_preencher
FROM produtos p
WHERE p.ativo = true
  AND p.custo_medio = 0
ORDER BY p.descricao;


-- ----------------------------------------------------------------------------
-- BLOCO 5 -- LISTA COMPLETA DO CADASTRO (so leitura) -- PRA RECONTAGEM
-- Rode ANTES da contagem e exporte em CSV. Serve pra ligar cada linha da
-- lista de papel ao produto certo. tem_historico = ja teve venda ou
-- movimento de estoque (esse nao pode ser apagado, so desativado).
-- ----------------------------------------------------------------------------
SELECT
  p.id,
  p.ean,
  p.descricao,
  p.ativo,
  round(p.preco_venda / 100.0, 2) AS preco_venda_reais,
  round(p.custo_medio / 100.0, 2) AS custo_reais,
  coalesce(s.quantidade, 0)       AS estoque_atual,
  (EXISTS (SELECT 1 FROM venda_itens vi WHERE vi.produto_id = p.id)
   OR EXISTS (SELECT 1 FROM estoque_movimentos m WHERE m.produto_id = p.id)) AS tem_historico
FROM produtos p
LEFT JOIN estoque_saldos s ON s.produto_id = p.id
ORDER BY p.descricao;
