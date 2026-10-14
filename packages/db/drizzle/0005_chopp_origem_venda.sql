CREATE TYPE "public"."origem_venda" AS ENUM('pdv', 'celular');--> statement-breakpoint
ALTER TYPE "public"."via_produto" ADD VALUE 'chopp';--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "origem" "origem_venda" DEFAULT 'pdv' NOT NULL;