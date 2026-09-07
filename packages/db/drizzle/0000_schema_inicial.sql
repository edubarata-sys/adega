CREATE TYPE "public"."conciliacao_status" AS ENUM('pendente', 'conciliado', 'ambiguo', 'divergente', 'ignorado');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('dinheiro', 'pix', 'debito', 'credito', 'voucher');--> statement-breakpoint
CREATE TYPE "public"."perfil_usuario" AS ENUM('admin', 'caixa');--> statement-breakpoint
CREATE TYPE "public"."status_venda" AS ENUM('aberta', 'paga', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimento_caixa" AS ENUM('sangria', 'suprimento', 'despesa', 'entrada_avulsa');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimento_estoque" AS ENUM('entrada', 'venda', 'ajuste', 'perda', 'devolucao');--> statement-breakpoint
CREATE TYPE "public"."unidade_produto" AS ENUM('UN', 'KG', 'L');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" uuid,
	"dados_antes" jsonb,
	"dados_depois" jsonb,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caixa_movimentos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sessao_id" uuid NOT NULL,
	"tipo" "tipo_movimento_caixa" NOT NULL,
	"valor" bigint NOT NULL,
	"descricao" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caixa_sessoes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispositivo_id" uuid,
	"usuario_abertura_id" uuid NOT NULL,
	"aberto_em" timestamp with time zone NOT NULL,
	"fundo_troco" bigint DEFAULT 0 NOT NULL,
	"usuario_fechamento_id" uuid,
	"fechado_em" timestamp with time zone,
	"valor_contado" bigint,
	"valor_esperado" bigint,
	"diferenca" bigint,
	"tem_ajuste_posterior" boolean DEFAULT false NOT NULL,
	"observacao" text
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conciliacao_itens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lote_id" uuid NOT NULL,
	"linha_bruta" jsonb NOT NULL,
	"valor" bigint NOT NULL,
	"ocorrido_em" timestamp with time zone,
	"nsu" text,
	"bandeira" text,
	"status" "conciliacao_status" DEFAULT 'pendente' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conciliacao_lotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"arquivo" text NOT NULL,
	"periodo_inicio" timestamp with time zone,
	"periodo_fim" timestamp with time zone,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"importado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "dispositivos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"token_hash" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_sync" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estoque_movimentos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"produto_id" uuid NOT NULL,
	"tipo" "tipo_movimento_estoque" NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"custo_unitario" bigint,
	"origem_tipo" text,
	"origem_id" uuid,
	"usuario_id" uuid,
	"observacao" text,
	"ocorrido_em" timestamp with time zone NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estoque_saldos" (
	"produto_id" uuid PRIMARY KEY NOT NULL,
	"quantidade" numeric(14, 3) DEFAULT '0' NOT NULL,
	"versao" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venda_id" uuid NOT NULL,
	"forma" "forma_pagamento" NOT NULL,
	"valor" bigint NOT NULL,
	"troco" bigint DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"conciliacao_status" "conciliacao_status" DEFAULT 'pendente' NOT NULL,
	"conciliacao_item_id" uuid,
	"conciliado_em" timestamp with time zone,
	"conciliado_por" uuid,
	"adquirente" text,
	"nsu" text,
	"autorizacao" text,
	"bandeira" text,
	"parcelas" integer
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"codigo_interno" text,
	"ean" text,
	"descricao" text NOT NULL,
	"descricao_pdv" text,
	"unidade" "unidade_produto" DEFAULT 'UN' NOT NULL,
	"categoria_id" uuid,
	"preco_venda" bigint NOT NULL,
	"custo_medio" bigint DEFAULT 0 NOT NULL,
	"estoque_minimo" numeric(14, 3) DEFAULT '0' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ncm" text,
	"cest" text,
	"cfop" text,
	"cst_csosn" text,
	"origem" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text,
	"pin_hash" text,
	"perfil" "perfil_usuario" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_acesso" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venda_itens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venda_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"preco_unitario" bigint NOT NULL,
	"custo_unitario" bigint DEFAULT 0 NOT NULL,
	"desconto_item" bigint DEFAULT 0 NOT NULL,
	"total_item" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"numero" integer,
	"sessao_caixa_id" uuid,
	"dispositivo_id" uuid,
	"usuario_id" uuid NOT NULL,
	"status" "status_venda" DEFAULT 'aberta' NOT NULL,
	"subtotal" bigint NOT NULL,
	"desconto" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"ocorrido_em" timestamp with time zone NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" uuid,
	"motivo_cancelamento" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_sessao_id_caixa_sessoes_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."caixa_sessoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_sessoes" ADD CONSTRAINT "caixa_sessoes_dispositivo_id_dispositivos_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_sessoes" ADD CONSTRAINT "caixa_sessoes_usuario_abertura_id_usuarios_id_fk" FOREIGN KEY ("usuario_abertura_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixa_sessoes" ADD CONSTRAINT "caixa_sessoes_usuario_fechamento_id_usuarios_id_fk" FOREIGN KEY ("usuario_fechamento_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conciliacao_itens" ADD CONSTRAINT "conciliacao_itens_lote_id_conciliacao_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."conciliacao_lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conciliacao_lotes" ADD CONSTRAINT "conciliacao_lotes_importado_por_usuarios_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_movimentos" ADD CONSTRAINT "estoque_movimentos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_movimentos" ADD CONSTRAINT "estoque_movimentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estoque_saldos" ADD CONSTRAINT "estoque_saldos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_conciliacao_item_id_conciliacao_itens_id_fk" FOREIGN KEY ("conciliacao_item_id") REFERENCES "public"."conciliacao_itens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_conciliado_por_usuarios_id_fk" FOREIGN KEY ("conciliado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_sessao_caixa_id_caixa_sessoes_id_fk" FOREIGN KEY ("sessao_caixa_id") REFERENCES "public"."caixa_sessoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_dispositivo_id_dispositivos_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."dispositivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cancelada_por_usuarios_id_fk" FOREIGN KEY ("cancelada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entidade_idx" ON "audit_log" USING btree ("entidade","entidade_id");--> statement-breakpoint
CREATE INDEX "caixa_mov_sessao_idx" ON "caixa_movimentos" USING btree ("sessao_id");--> statement-breakpoint
CREATE INDEX "conciliacao_itens_busca_idx" ON "conciliacao_itens" USING btree ("valor","ocorrido_em");--> statement-breakpoint
CREATE INDEX "estoque_mov_produto_idx" ON "estoque_movimentos" USING btree ("produto_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "estoque_mov_origem_idx" ON "estoque_movimentos" USING btree ("origem_tipo","origem_id");--> statement-breakpoint
CREATE INDEX "pagamentos_venda_idx" ON "pagamentos" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "pagamentos_conciliacao_idx" ON "pagamentos" USING btree ("conciliacao_status");--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_ean_idx" ON "produtos" USING btree ("ean");--> statement-breakpoint
CREATE INDEX "produtos_descricao_idx" ON "produtos" USING btree ("descricao");--> statement-breakpoint
CREATE INDEX "produtos_atualizado_em_idx" ON "produtos" USING btree ("atualizado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_idx" ON "usuarios" USING btree ("email");--> statement-breakpoint
CREATE INDEX "venda_itens_venda_idx" ON "venda_itens" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "vendas_ocorrido_em_idx" ON "vendas" USING btree ("ocorrido_em");--> statement-breakpoint
CREATE INDEX "vendas_sessao_idx" ON "vendas" USING btree ("sessao_caixa_id");