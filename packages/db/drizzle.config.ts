import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://adega:adega@localhost:5432/adega',
  },
  casing: 'snake_case',
})
