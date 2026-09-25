DROP INDEX IF EXISTS "produtos_ean_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "produtos_ean_idx" ON "produtos" USING btree ("ean");
