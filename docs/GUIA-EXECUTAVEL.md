# Executavel (.exe) do Sistema da Adega -- guia e roteiro

Este documento explica o que e o `AdegaPDV.exe`, o que ele resolve, o que
ainda NAO resolve, e o roteiro pra testar na maquina da loja.

## O que e

Um executavel unico do Windows que substitui os 3 comandos manuais do modo
dev (`pnpm dev`, que sobe API + web separados, mais o Postgres via
`docker-compose`) por um duplo-clique. Por dentro ele:

1. Sobe a API de verdade (o mesmo `buildApp` de `apps/api/src/app.ts`, sem
   nenhuma mudanca de logica de negocio -- e literalmente o mesmo codigo
   testado pelos 185 testes automatizados) numa porta interna (3000).
2. Serve os arquivos ja compilados de `apps/web` (pasta `web/` ao lado do
   `.exe`) numa porta publica (8080 por padrao).
3. Repassa (proxy) tudo que comeca com `/api` pra API interna -- o mesmo
   papel que o proxy do Vite faz em desenvolvimento.
4. Abre a tela sozinho em `http://localhost:8080`, em **modo app**: usa o
   Edge ou o Chrome ja instalados na maquina, mas sem barra de enderecos,
   sem abas e sem menu -- fica com cara de programa instalado, nao de
   pagina de navegador (ver secao "Modo app / janela" abaixo).

Fonte: `apps/api/src/executavel/servidor.mjs` (arquivo novo, nao mexe em
nenhum arquivo testado). Empacotado com `esbuild` (bundle num arquivo so) +
`pkg` (`@yao-pkg/pkg`, target `node22-win-x64`).

## O que NAO esta resolvido nesta versao (decisao consciente, nao esquecimento)

- **Postgres continua sendo instalado e rodando a parte.** O `.exe` nao
  embute banco de dados nenhum. Foi a escolha do "caminho rapido" discutida
  antes de comecar a construir: trocar pra um banco embutido (pglite) e
  mudanca de codigo de verdade, arriscada de fazer em cima da hora e ainda
  nao testada -- fica pro backlog (ver `docs/CONTEXTO-TORRE-ADEGA.md`,
  secao 8, item 5).
- **Nao e um instalador de verdade** (nao aparece em "Adicionar ou remover
  programas", nao cria atalho no menu iniciar sozinho, nao assina
  digitalmente o `.exe` -- o Windows/antivirus pode avisar "editor
  desconhecido" na primeira vez que abrir. Isso e normal pra um executavel
  nao assinado e nao bloqueia o uso, so exige clicar em "Mais informacoes"
  -> "Executar assim mesmo" uma vez).
- **Sem atualizacao automatica.** Toda vez que o codigo mudar, precisa
  gerar um `.exe` novo e substituir (ver "Como reconstruir" abaixo).
- **O modo app depende de achar Edge ou Chrome instalados nos locais
  padrao do Windows.** Se a maquina nao tiver nenhum dos dois (ou tiver
  em local nao padrao), cai automaticamente pro navegador padrao numa
  janela normal -- o sistema funciona igual, so muda a aparencia.

## Modo app / janela (sem barra do navegador)

Por padrao (`JANELA_APP=true` no `config.env`) o `.exe` procura o Edge ou
o Chrome instalados na maquina (`Program Files`/`Program Files (x86)`, e
tambem instalacao por usuario do Chrome em `%LOCALAPPDATA%`) e abre a tela
com a flag `--app=http://localhost:8080` maximizada -- isso tira barra de
enderecos, abas, menu e atalhos do navegador, deixando so a janela da
propria tela do sistema. Continua sendo o mesmo Chromium por baixo (nao
e um app nativo de verdade), so nao aparece nada disso pra quem esta
usando.

Se isso causar algum problema (por exemplo antivirus bloqueando o Edge
sendo chamado com esses parametros, ou a maquina nao ter nem Edge nem
Chrome), coloque `JANELA_APP=false` no `config.env` pra voltar pro
navegador padrao numa janela normal (com abas, barra de enderecos etc).

Pra fechar so a janela do sistema NAO desliga o programa -- ele continua
rodando ate a janela preta do terminal ser fechada (isso nao muda com o
modo app).

**Caminho mais robusto que isso, se algum dia fizer sentido investir:**
empacotar com Electron ou Tauri, que embutem o proprio motor de
renderizacao (Electron) ou usam o WebView2 da Microsoft (Tauri, ja vem
no Windows 10/11) em vez de depender de achar um Chrome/Edge instalado.
Fica mais pesado de construir (Electron) ou exige Rust no ambiente de
build (Tauri), mas realmente independe de qualquer navegador na maquina
do cliente. Nao foi feito agora porque o modo app acima ja resolve a
aparencia sem esse custo extra -- fica registrado como opcao futura.

## Estrutura da pasta de entrega

```
AdegaPDV/
  AdegaPDV.exe        <- o programa
  web/                <- build de apps/web (pnpm --filter web build)
  config.env          <- configuracao editavel (endereco do Postgres etc.)
  LEIA-ME.txt          <- versao curta deste guia, pra quem vai abrir na loja
```

`config.env` (formato `CHAVE=valor`, uma por linha, `#` comenta a linha):

```
DATABASE_URL=postgres://adega:adega@localhost:5432/adega
SESSION_SECRET=troque-esta-chave-por-uma-string-aleatoria-longa-1a2b3c4d
PORTA_PUBLICA=8080
PORTA_INTERNA_API=3000
JANELA_APP=true
```

## Roteiro pra testar na maquina da loja

1. **Preparar o Postgres na maquina** (se ainda nao tiver):
   - Instalar o Postgres (versao 16 ou proxima, mesma usada em dev).
   - Criar o usuario/banco. Duas opcoes:
     - Usar os mesmos valores do `config.env` padrao (usuario `adega`,
       senha `adega`, banco `adega`, porta `5432`) -- mais simples, nao
       precisa editar nada.
     - Ou usar outro usuario/senha/porta e AJUSTAR `DATABASE_URL` no
       `config.env` pra bater.
   - Aplicar as migrations: com Node instalado na maquina, dentro da pasta
     do projeto (`D:\adega`), rodar `pnpm db:migrate` (usa o `DATABASE_URL`
     do `.env` do projeto -- que e separado do `config.env` do `.exe`,
     preste atencao pra apontar pro mesmo banco nos dois lugares).
2. **Copiar a pasta `AdegaPDV/`** (o conteudo do zip) pra maquina da loja --
   pendrive, rede, como for mais facil. Pode ficar em qualquer lugar (nao
   precisa ser dentro do projeto).
3. **Conferir o `config.env`** -- se o Postgres da loja usa outro
   usuario/senha/porta, edita aqui antes de abrir o `.exe`.
4. **Dar duplo-clique em `AdegaPDV.exe`.** Se o Windows avisar
   "Windows protegeu o computador" (SmartScreen, por nao ser assinado):
   clicar em "Mais informacoes" -> "Executar assim mesmo".
5. Confirmar que a janela do terminal mostra `Sistema no ar em
   http://localhost:8080` e que o navegador abriu sozinho nessa pagina.
6. Fazer o teste real: login por PIN, abrir caixa, ler um EAN de produto
   cadastrado, completar uma venda, conferir o recibo na tela, fechar o
   caixa.
7. Pra fechar tudo: fechar a janela preta do terminal.

## Se der erro

| Sintoma | Causa provavel | O que fazer |
|---|---|---|
| Janela fecha sozinha na hora | Postgres nao esta rodando, ou `DATABASE_URL` errada | Confirmar que o Postgres esta de pe e que usuario/senha/porta no `config.env` batem |
| Pagina abre mas fica em "Carregando..." pra sempre | API interna nao subiu (porta 3000 ocupada por outro programa) | Trocar `PORTA_INTERNA_API` no `config.env` pra outro numero, ex. `3050` |
| "Falha ao falar com a API interna" na tela | API ainda terminando de subir, ou caiu | Esperar alguns segundos e atualizar a pagina; se persistir, olhar o texto na janela preta |
| Porta 8080 ja em uso | Outro programa usando a mesma porta | Trocar `PORTA_PUBLICA` no `config.env`, ex. `8090`, e abrir de novo |
| Windows/antivirus bloqueia de vez (nao deixa nem com "Executar assim mesmo") | Antivirus corporativo mais restritivo | Vai precisar assinar o executavel digitalmente ou liberar excecao no antivirus -- avisar o Eduardo |
| Sistema abre num navegador comum, com abas e barra de enderecos (em vez de janela sem essas ferramentas) | Nao achou Edge nem Chrome instalados nos locais padrao | Normal, so muda a aparencia -- o sistema funciona igual. Se quiser confirmar que nao e outra coisa, verifique se `JANELA_APP=true` no `config.env` |

## Como reconstruir o `.exe` (pra quando o codigo mudar)

Precisa: Node 22+, pnpm, e as ferramentas `esbuild` e `@yao-pkg/pkg`
(`npm install -g esbuild @yao-pkg/pkg`).

```bash
# 1. instalar dependencias e buildar os pacotes internos
pnpm install
pnpm build

# 2. empacotar o lancador num arquivo .cjs so (esbuild bundla tudo)
cd apps/api
esbuild src/executavel/servidor.mjs \
  --bundle --platform=node --target=node18 --format=cjs \
  --outfile=../../dist-exe/servidor.cjs --loader:.ts=ts
cd ../..

# 3. gerar o .exe do Windows a partir do .cjs
pkg dist-exe/servidor.cjs --targets node22-win-x64 --output dist-exe/AdegaPDV.exe

# 4. montar a pasta de entrega
mkdir -p /tmp/AdegaPDV
cp dist-exe/AdegaPDV.exe /tmp/AdegaPDV/
cp -r apps/web/dist /tmp/AdegaPDV/web
# copiar config.env e LEIA-ME.txt de uma pasta anterior, ou recriar
```

`dist-exe/` esta no `.gitignore` (artefato de build, igual `dist-diagnostico/`
-- nao deve ir pro historico do git).

## Proximos passos possiveis (nao feitos agora, so registrados)

1. Trocar Postgres por um banco embutido (pglite) pra eliminar a
   dependencia externa de verdade -- aí sim vira "so um arquivo, zero
   instalacao". Mudanca de codigo real, nao so empacotamento.
2. Assinar o `.exe` digitalmente pra nao disparar o aviso do SmartScreen.
3. Gerar um instalador de verdade (ex. Inno Setup) que cria atalho, ja
   pergunta o `DATABASE_URL` numa tela simples, e desinstala limpo.
4. Auto-update (checar se ha `.exe` mais novo e avisar).
