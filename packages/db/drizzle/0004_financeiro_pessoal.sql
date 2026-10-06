CREATE TYPE "public"."fin_grupo" AS ENUM('adega', 'casa', 'outros');--> statement-breakpoint
CREATE TYPE "public"."fin_origem" AS ENUM('manual', 'voz', 'caixa', 'conta');--> statement-breakpoint
CREATE TYPE "public"."fin_tipo" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TYPE "public"."fin_tipo_conta" AS ENUM('boleto', 'fixo');--> statement-breakpoint
CREATE TABLE "financeiro_contas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" "fin_tipo_conta" NOT NULL,
	"grupo" "fin_grupo" NOT NULL,
	"descricao" text NOT NULL,
	"valor" bigint NOT NULL,
	"vencimento" date,
	"dia_vencimento" integer,
	"codigo_barras" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financeiro_lancamentos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tipo" "fin_tipo" NOT NULL,
	"grupo" "fin_grupo" NOT NULL,
	"valor" bigint NOT NULL,
	"descricao" text NOT NULL,
	"data" date NOT NULL,
	"origem" "fin_origem" NOT NULL,
	"sessao_caixa_id" uuid,
	"conta_id" uuid,
	"competencia" text,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_sessao_caixa_id_caixa_sessoes_id_fk" FOREIGN KEY ("sessao_caixa_id") REFERENCES "public"."caixa_sessoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_conta_id_financeiro_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."financeiro_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financeiro_lancamentos" ADD CONSTRAINT "financeiro_lancamentos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_lanc_data_idx" ON "financeiro_lancamentos" USING btree ("data");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_lanc_sessao_uq" ON "financeiro_lancamentos" USING btree ("sessao_caixa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_lanc_conta_comp_uq" ON "financeiro_lancamentos" USING btree ("conta_id","competencia");