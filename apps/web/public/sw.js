/*
 * Service worker do PDV (arquitetura §2): guarda a "casca" do sistema
 * (HTML, JS, CSS, imagens) pra ele ABRIR sem internet. Nunca guarda nada de
 * /api -- dados de venda/produto offline ficam no IndexedDB do proprio app.
 *
 * - Pagina (navegacao): internet primeiro; sem internet, a ultima copia.
 * - Arquivos com hash do Vite (/assets/...): guardados na primeira vez.
 * - Demais arquivos estaticos: copia guardada, atualizada em segundo plano.
 *
 * Trocar VERSAO limpa as copias antigas no proximo acesso com internet.
 */
const VERSAO = 'adega-pdv-v1'
const CASCA = ['/', '/manifest.webmanifest', '/icone-192.png', '/logo-adega-dois-irmaos.jpg']

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) => cache.addAll(CASCA))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

async function internetPrimeiro(request) {
  const cache = await caches.open(VERSAO)
  try {
    const resposta = await fetch(request)
    if (resposta.ok) cache.put('/', resposta.clone())
    return resposta
  } catch {
    return (await cache.match('/')) || (await cache.match(request)) || Response.error()
  }
}

async function guardadoPrimeiro(request, atualizarEmSegundoPlano) {
  const cache = await caches.open(VERSAO)
  const guardado = await cache.match(request)
  const daInternet = fetch(request)
    .then((resposta) => {
      if (resposta.ok) cache.put(request, resposta.clone())
      return resposta
    })
    .catch(() => undefined)
  if (guardado) {
    if (atualizarEmSegundoPlano) void daInternet
    return guardado
  }
  return (await daInternet) || Response.error()
}

self.addEventListener('fetch', (evento) => {
  const { request } = evento
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return
  if (request.mode === 'navigate') {
    evento.respondWith(internetPrimeiro(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(guardadoPrimeiro(request, false))
    return
  }
  evento.respondWith(guardadoPrimeiro(request, true))
})
