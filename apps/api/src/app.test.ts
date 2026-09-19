import { describe, expect, it } from 'vitest'
import { buildApp } from './app'

/** Fake minimo de `Executor`: so o suficiente pra exercitar o healthcheck sem banco real. */
function dbFake(execute: () => Promise<unknown>) {
  return { execute } as unknown as Parameters<typeof buildApp>[0]['db']
}

describe('GET /health (liveness)', () => {
  it('responde ok sem depender do banco', async () => {
    const app = buildApp({
      db: dbFake(() => {
        throw new Error('nao deveria ser chamado')
      }),
      versao: 'teste',
      sessionSecret: 'segredo-teste',
    })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', versao: 'teste' })
  })
})

describe('GET /health/ready (readiness)', () => {
  it('responde 200 quando o banco responde ao ping', async () => {
    const app = buildApp({
      db: dbFake(async () => undefined),
      versao: 'teste',
      sessionSecret: 'segredo-teste',
    })
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('responde 503 quando o banco falha, sem derrubar o processo', async () => {
    const app = buildApp({
      db: dbFake(async () => {
        throw new Error('connection refused')
      }),
      versao: 'teste',
      sessionSecret: 'segredo-teste',
    })
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ status: 'indisponivel', motivo: 'connection refused' })
  })
})
