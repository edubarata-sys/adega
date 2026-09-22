import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-exe/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/db/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // Lancador do .exe (apps/api/src/executavel/servidor.mjs): unico arquivo
    // .mjs do repo, roda direto em Node (sem build TS) -- por isso precisa
    // dos globais de Node explicitos, que os arquivos .ts ja tem via
    // tsconfig ("types": ["node"], nao passa por aqui).
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
  },
  {
    // packages/core nao pode importar I/O. Guarda-corpo do principio da arquitetura.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'http',
                'https',
                'net',
                'crypto',
                'os',
                'child_process',
                'pg',
                'postgres',
                'drizzle-orm',
                'drizzle-orm/*',
                'fastify',
                'fastify/*',
                'react',
                'react-dom',
                '@adega/db',
                '@adega/db/*',
              ],
              message:
                'packages/core e livre de I/O: nao importar banco, HTTP, filesystem ou framework.',
            },
          ],
        },
      ],
    },
  },
)
