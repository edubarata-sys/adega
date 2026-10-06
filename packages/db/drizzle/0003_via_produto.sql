CREATE TYPE "public"."via_produto" AS ENUM('adega', 'outros', 'espetinho');--> statement-breakpoint
ALTER TABLE "produtos" ADD COLUMN "via" "via_produto" DEFAULT 'adega' NOT NULL;