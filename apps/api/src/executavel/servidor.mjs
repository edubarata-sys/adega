// Lancador do Sistema da Adega empacotado como executavel unico (.exe).
//
// O que este arquivo faz, que em modo dev fica dividido entre 3 coisas
// separadas (vite dev server com proxy, tsx watch do apps/api, Postgres via
// docker-compose):
//   1. Sobe a API de verdade (mesmo buildApp de apps/api/src/app.ts, sem
//      nenhuma mudanca de logica de negocio) numa porta interna.
//   2. Serve os arquivos estaticos do build de apps/web (pasta `web/` ao
//      lado do .exe) numa porta publica.
//   3. Repassa (proxy) tudo que comeca com /api para a API interna --
//      substitui o que o proxy do Vite fazia em dev.
//   4. Abre o navegador padrao sozinho na porta publica.
//
// Continua exigindo Postgres de verdade rodando em algum lugar (local ou de
// rede) -- isso NAO foi embutido no .exe nesta primeira versao. Ver
// docs/GUIA-EXECUTAVEL.md pra detalhes e para o porque dessa escolha.

import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { exec, execFile } from 'node:child_process'

import { criarDb } from '@adega/db'
import { buildApp } from '../app'

// --------------------------------------------------------------------
// Diretorio base: quando empacotado com pkg, process.execPath e o proprio
// .exe -- os arquivos "ao lado" (web/, config.env) ficam no mesmo diretorio
// dele. Rodando direto com `node` (sem empacotar, pra testar), usa __dirname
// do proprio bundle (esbuild fornece isso mesmo compilando a partir de ESM).
// --------------------------------------------------------------------
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname

const CAMINHO_CONFIG = path.join(BASE_DIR, 'config.env')
const CAMINHO_WEB = path.join(BASE_DIR, 'web')

// Prioridade de configuracao (da mais baixa pra mais alta): valores padrao
// (uso local sem nada configurado) < arquivo config.env ao lado do .exe
// (uso desktop empacotado) < variaveis de ambiente reais (uso em nuvem, ex.
// Railway -- nao ha como colocar um config.env lá, so env vars no painel).
// PORT e a convencao usada por Railway/Heroku/etc pra dizer em qual porta
// escutar; se estiver definida e PORTA_PUBLICA nao vier de outro lugar, usa
// ela.
function carregarConfig() {
  const config = {
    DATABASE_URL: 'postgres://adega:adega@localhost:5432/adega',
    SESSION_SECRET: 'troque-esta-chave-por-uma-string-aleatoria-longa',
    PORTA_PUBLICA: process.env.PORT ?? '8080',
    PORTA_INTERNA_API: '3000',
    JANELA_APP: 'true',
  }
  if (existsSync(CAMINHO_CONFIG)) {
    const texto = readFileSync(CAMINHO_CONFIG, 'utf-8')
    for (const linha of texto.split(/\r?\n/)) {
      const semComentario = linha.split('#')[0]?.trim()
      if (!semComentario || !semComentario.includes('=')) continue
      const indice = semComentario.indexOf('=')
      const chave = semComentario.slice(0, indice).trim()
      const valor = semComentario.slice(indice + 1).trim()
      if (chave) config[chave] = valor
    }
  }
  for (const chave of Object.keys(config)) {
    if (process.env[chave] !== undefined) config[chave] = process.env[chave]
  }
  return config
}

const CONFIG = carregarConfig()
const PORTA_PUBLICA = Number(CONFIG.PORTA_PUBLICA)
const PORTA_INTERNA_API = Number(CONFIG.PORTA_INTERNA_API)
const JANELA_APP = CONFIG.JANELA_APP !== 'false'

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function servirEstatico(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let caminhoRelativo = decodeURIComponent(url.pathname)
  if (caminhoRelativo === '/' || caminhoRelativo === '/diagnostico') {
    caminhoRelativo = '/index.html'
  }
  let caminhoArquivo = path.join(CAMINHO_WEB, caminhoRelativo)

  // Impede sair da pasta web/ (path traversal).
  if (!caminhoArquivo.startsWith(CAMINHO_WEB)) {
    res.writeHead(400).end('Requisicao invalida.')
    return
  }

  try {
    const conteudo = await readFile(caminhoArquivo)
    const ext = path.extname(caminhoArquivo)
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[ext] ?? 'application/octet-stream' })
    res.end(conteudo)
  } catch {
    // SPA sem router: qualquer caminho que nao seja um arquivo real (ex:
    // uma rota futura) cai de volta pro index.html.
    try {
      const indexHtml = await readFile(path.join(CAMINHO_WEB, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(indexHtml)
    } catch {
      res.writeHead(500).end('Nao encontrei os arquivos do sistema (pasta web/ ausente).')
    }
  }
}

// caminhoDestino e explicito (em vez de derivar de req.url aqui dentro)
// porque o chamador de /health precisa mandar pra API interna sem o
// prefixo /api, sem precisar criar uma copia rasa de `req` so pra mudar
// a url -- isso quebrava req.pipe (metodo do prototype de stream, que
// um spread {...req} nao copia).
function repassarParaApi(req, res, caminhoDestino) {
  const opcoesProxy = {
    hostname: '127.0.0.1',
    port: PORTA_INTERNA_API,
    path: caminhoDestino,
    method: req.method,
    headers: req.headers,
  }
  const reqProxy = httpRequest(opcoesProxy, (resApi) => {
    res.writeHead(resApi.statusCode ?? 502, resApi.headers)
    resApi.pipe(res)
  })
  reqProxy.on('error', (erro) => {
    res.writeHead(502).end(`Falha ao falar com a API interna: ${erro.message}`)
  })
  req.pipe(reqProxy)
}

// Modo "app" (JANELA_APP=true, padrao): abre no Edge ou Chrome ja instalados
// na maquina com --app=URL, que tira barra de enderecos, abas e menu -- fica
// com cara de programa instalado, nao de pagina de navegador. Se nao achar
// nenhum dos dois (ou JANELA_APP=false no config.env), cai pro navegador
// padrao numa janela normal, igual antes.
function encontrarNavegadorApp() {
  if (process.platform !== 'win32') return null
  const candidatos = [
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter((c) => typeof c === 'string')
  return candidatos.find((c) => existsSync(c)) ?? null
}

function abrirNavegador(url) {
  const navegadorApp = JANELA_APP ? encontrarNavegadorApp() : null
  if (navegadorApp) {
    console.log(`Abrindo em modo app (sem barra/abas): ${navegadorApp}`)
    execFile(
      navegadorApp,
      [`--app=${url}`, '--start-maximized', '--disable-features=TranslateUI'],
      () => {
        // Falha ao abrir sozinho nao e fatal -- so avisa no console.
      },
    )
    return
  }
  const comando =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  exec(comando, () => {
    // Falha ao abrir sozinho nao e fatal -- so avisa no console.
  })
}

async function iniciar() {
  console.log('Sistema da Adega -- iniciando...')
  console.log(`Banco: ${CONFIG.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)

  const db = criarDb(CONFIG.DATABASE_URL)
  const apiApp = buildApp({
    versao: '1.0.0-exe',
    db,
    sessionSecret: CONFIG.SESSION_SECRET,
  })

  try {
    await apiApp.listen({ port: PORTA_INTERNA_API, host: '127.0.0.1' })
  } catch (erro) {
    console.error('Nao consegui iniciar a API interna (porta ja em uso?):', erro)
    process.exitCode = 1
    return
  }

  const servidorPublico = createHttpServer((req, res) => {
    if (req.url?.startsWith('/api')) {
      repassarParaApi(req, res, req.url.replace(/^\/api/, '') || '/')
    } else if (req.url?.startsWith('/health')) {
      // healthcheck (Railway e afins batem aqui direto, sem prefixo /api)
      repassarParaApi(req, res, req.url)
    } else {
      void servirEstatico(req, res)
    }
  })

  servidorPublico.listen(PORTA_PUBLICA, () => {
    const url = `http://localhost:${PORTA_PUBLICA}`
    console.log(`Sistema no ar em ${url}`)
    // Em nuvem (Railway seta essa variavel automaticamente) nao tem sentido
    // tentar abrir navegador local -- so faz isso em uso desktop de verdade.
    if (!process.env.RAILWAY_ENVIRONMENT_NAME) {
      console.log('Feche esta janela para desligar o sistema.')
      abrirNavegador(url)
    }
  })
}

void iniciar().catch((erro) => {
  console.error('Erro fatal ao iniciar:', erro)
  process.exitCode = 1
})
