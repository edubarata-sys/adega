import { describe, expect, it } from 'vitest'
import { buildApp } from './app'

function appComDbFake(ping: () => Promise<void>) {
  return buildApp({ db: { ping }, versao: 'teste' })
}

describe('GET /health (liveness)', () => {
  it('responde ok sem depender do banco', async () => {
    const app = appComDbFake(() => {
      throw new Error('nao deveria ser chamado')
    })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', versao: 'teste' })
  })
})

describe('GET /health/ready (readiness)', () => {
  it('responde 200 quando o banco responde ao ping', async () => {
    const app = appComDbFake(async () => {})
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('responde 503 quando o banco falha, sem derrubar o processo', async () => {
    const app = appComDbFake(async () => {
      throw new Error('connection refused')
    })
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ status: 'indisponivel', motivo: 'connection refused' })
  })
})
