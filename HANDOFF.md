# HANDOFF -- Sistema da Adega

Escrito em 2026-09-08 para troca de agente. Quem assumir daqui deve ler
este arquivo inteiro antes de tocar em qualquer codigo, depois ler
`arquitetura.md` (o porque de cada decisao) e `README.md` (como rodar).
Este documento nao substitui os outros dois -- e o mapa de onde as
coisas estao e o que ainda esta em aberto.

Apague este arquivo quando o handoff estiver absorvido e nao fizer mais
sentido mante-lo (ou mova o conteudo relevante para `arquitetura.md` /
`README.md` e delete este).

---

## 1. Como o dono do projeto trabalha (leia isto primeiro)

Isto importa mais do que parece. Instrucao explicita do usuario nesta
conversa:

> "Eu penso conversando e gosto de velocidade. Nao precisa ficar me
> pedindo confirmacao a cada decisao tecnica. Pode assumir bastante
> autonomia, propor caminhos, escolher stack e montar a solucao
> inteira." Prefere: resposta direta, pouca cerimonia, decisao tecnica
> clara, apontar risco de verdade sem dramatizar, discordar dele quando
> ele estiver escolhendo um caminho ruim, nao elogiar por reflexo, nao
> checklist infinito, nao parar por duvida pequena. "Se houver 3
> caminhos possiveis, escolha o que voce considera melhor, explique em
> poucas linhas por que e siga." Hipotese marcada como hipotese.
> Dependencia real marcada como dependencia real, mas continuar
> desenhando o resto.

Ele **rejeita explicitamente o AskUserQuestion tool em painel** ("sem
perguntas em painel odeio isso kkk") -- decida e escreva em prosa, nao
abra formulario de multipla escolha para decisao tecnica.

Regras operacionais que ele deu e que foram seguidas neste repo:
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`), commits pequenos por unidade logica, nunca um commit
  gigante de "projeto inicial".
- Testes desde o dia 1, prioridade: `packages/core` > contrato de API >
  invariantes de banco > smoke de UI. Sem perseguir cobertura artificial.
- ESLint + Prettier + TypeScript strict + `noImplicitAny`, sem `any` sem
  justificativa explicita. Sem inventar configuracao exotica.
- `packages/core` e ZERO I/O -- isso e regra de lint, nao so convencao
  (ver `eslint.config.js`, bloco `no-restricted-imports` escopado a
  `packages/core/**`).

Ele revisa tecnicamente a fundo. Ja rejeitou uma versao anterior da
arquitetura em 3 pontos concretos (ver secao 3) -- espere o mesmo nivel
de escrutinio, entao prefira decisao correta e justificada a decisao
rapida e fragil.

---

## 2. Onde as coisas estao (isto e MUITO especifico deste ambiente)

**O repositorio de verdade e `D:\adega`**, acessado neste tipo de sessao
via `mcp__remote-devices__device_bash` (roda numa VM Linux isolada do
computador do usuario, com `D:\adega` montado em `$HOME/mnt/adega`).
Todo o codigo, `arquitetura.md`, `projeto-sistema-adega.md` e o git
historico vivem la. Isso nao muda -- e requisito explicito do usuario
("Nao criar outro projeto paralelo").

**Blocker de ambiente real, ja resolvido, mas que VAI reaparecer**: o
mount de `D:\adega` e OK para editar arquivos de codigo-fonte
individualmente, mas e MUITO lento para qualquer operacao com muitos
arquivos pequenos -- `pnpm install` (milhares de arquivos em
`node_modules`) e `rm -rf` de `.pnpm-store` estouraram o timeout de
2 minutos direto no mount. Diagnostico confirmado experimentalmente (nao
e suposicao): a mesma operacao no disco local da VM levou 9-22s.

**A solucao que esta em uso**: existe um clone de trabalho em
`$HOME/build-adega/repo` (disco local da VM do `device_bash`, rapido).
O fluxo e:
1. Editar/testar/instalar/buildar em `$HOME/build-adega/repo`.
2. Quando uma unidade logica estiver pronta e verde (lint+typecheck+
   test+build), sincronizar so os arquivos de codigo-fonte de volta
   para `$HOME/mnt/adega` via `rsync -a --delete --exclude
   node_modules --exclude dist --exclude .git --exclude bin ...`.
3. Commitar em `$HOME/mnt/adega` (poucos arquivos, git e tolera-vel
   la, so lento-ish, nao trava).

**Se o clone local (`$HOME/build-adega/repo`) nao existir mais** (sessao
nova, VM reciclada), recria-lo com `git clone
"$HOME/mnt/adega/.git" "$HOME/build-adega/repo"` e seguir o mesmo fluxo.
Nao rodar `pnpm install` direto em `$HOME/mnt/adega` -- vai travar.

**Outro detalhe de ambiente**: `git commit` no mount as vezes deixa
`.git/*.lock` para tras de forma que o proprio `unlink` do processo
falha com "Operation not permitted" -- isso e permissao de delecao no
device bridge, nao bug do git. Resolvido nesta sessao pedindo
`device_request_delete_permission` para `D:\adega` (usuario aprovou).
Se reaparecer ("Unable to create .git/index.lock: File exists"), rodar
`rm -f .git/*.lock` antes do commit -- se a delecao falhar de novo,
pedir a permissao de novo.

---

## 3. Decisoes de arquitetura que ja passaram por revisao critica

Nao reabrir estas sem motivo novo -- ja foram debatidas e corrigidas
uma vez:

1. **Nao existe `saldo_apos` no ledger de estoque.** Primeira versao
   tinha essa coluna; foi rejeitada porque e valor posicional,
   incompativel com sync fora de ordem (uma venda atrasada chegando
   obrigaria reescrever todo o historico posterior, mutando um ledger
   que se declara imutavel). Solucao: `estoque_saldos` como CACHE
   atualizado por soma comutativa (`quantidade = quantidade + delta`)
   na mesma transacao do insert do movimento. Invariante testada de
   verdade em `packages/db/src/invariantes.test.ts` (SUM(movimentos) ==
   saldo, inclusive com chegada fora de ordem e escrita concorrente).

2. **Materialized view por trigger foi descartada.** Postgres nao tem
   matview incremental; `REFRESH` e recompute total com lock. Trocado
   por update em codigo, no repositorio, na mesma transacao.

3. **Conciliacao com a Rede/Itau nunca faz auto-match por heuristica.**
   Maquina de estados explicita: `pendente | conciliado | ambiguo |
   divergente | ignorado`. Dois candidatos por valor+horario = ambiguo,
   vai pra fila humana -- nunca decide sozinho por proximidade. Linha
   bruta da adquirente e imutavel.

4. **Fase 1 assume terminal UNICO de PDV**, documentado explicitamente
   (arquitetura.md secao 2.1) porque fechamento de caixa multi-terminal
   e consenso distribuido -- fora de escopo, nao "esquecido".

5. **Trava de fechamento de caixa**: recusa fechar com venda pendente na
   fila local do dispositivo (`podeFecharCaixa` em
   `packages/core/src/caixa.ts`, com teste cobrindo exatamente isso).

6. **Integracao com a Laranjinha Itau/Rede fica atras de um
   `PaymentAdapter`.** Fase 1 usa `ManualAdapter` (operador confirma na
   tela) + conciliacao por extrato. Nao existe API publica de maquininha
   fisica da Rede/Itau -- isso e DEPENDENCIA REAL, nao coisa a
   implementar. Ver arquitetura.md secao 6.

Leia `arquitetura.md` inteiro -- ele tem o raciocinio completo, incluindo
o "por que nao" de cada alternativa descartada (Next.js, servidor local
com replica bidirecional, etc.).

---

## 4. O que esta pronto e verificado

12 commits, `git log --oneline` no repo mostra a sequencia. Rodar
`pnpm check` (format:check + lint + typecheck + test) e `pnpm build` no
clone local -- ambos passam limpos, 48/48 testes.

- **`packages/core`** (40 testes): `dinheiro.ts` (Centavos como tipo
  branded, multiplicacao por quantidade fracionaria via milesimos
  inteiros para nao acumular erro de float, arredondamento
  meio-para-cima), `id.ts` (UUIDv7 puro, gerado no cliente), `venda.ts`
  (calculo de item/venda, conferencia de pagamento -- regra central: SO
  dinheiro devolve troco, cartao/pix acima do total e erro de digitacao),
  `caixa.ts` (fechamento e a trava `podeFecharCaixa`), `resultado.ts`
  (Result para regra de negocio vs excecao para bug de programacao).

- **`packages/db`** (5 testes, contra Postgres REAL via `pglite`, nao
  mock): schema Drizzle completo da Fase 1 (14 tabelas), migration
  gerada e commitada (`packages/db/drizzle/0000_schema_inicial.sql`),
  `client.ts` centralizando `casing: 'snake_case'` (ver bug real na
  secao 5).

- **`apps/api`**: Fastify com `/health` (liveness) e `/health/ready`
  (readiness com ping no banco), testado via `app.inject` sem subir
  Postgres.

- **`apps/web`**: React+Vite, uma tela que confere `web -> api ->
  banco`. Nao e o PDV -- so prova a esteira.

- **`apps/bridge`**: stub Go que responde SO `/health` com CORS/Private
  Network Access. Ver secao 6 -- isto NAO esta com veredito fechado.

- **Infra**: `docker-compose.yml` (Postgres 17), `.env.example`, CI
  (`.github/workflows/ci.yml`) espelhando `pnpm check` + build, README
  com passo a passo de subida local.

---

## 5. Bugs reais encontrados pelos proprios testes (nao hipoteticos)

Vale ler porque mostram por que os testes de banco contra Postgres real
(nao mock) importam:

1. **`casing: 'snake_case'` faltando no client de runtime do Drizzle.**
   `drizzle-kit generate` usa essa config e gera SQL com colunas
   `senha_hash`; o client `drizzle()` em runtime PRECISA da mesma config
   ou gera queries com `senhaHash` literal -- erro so aparece em
   runtime contra banco real, nunca no typecheck. Corrigido
   centralizando a fabrica em `packages/db/src/client.ts` E em
   `packages/db/src/test-helpers.ts`, ambos com a mesma config, para
   nao poder divergir de novo.

2. **pglite (Postgres em WASM) crasha o worker do Vitest por volta da
   3a instancia criada no mesmo processo**, neste ambiente com pouca
   memoria. Nao e bug do schema -- e o padrao de teste errado (criar um
   banco novo por teste). Corrigido: UMA instancia de pglite por
   arquivo de teste (`beforeAll`), `TRUNCATE` entre testes
   (`afterEach`), fecha so no fim (`afterAll`). Ver
   `packages/db/src/test-helpers.ts` -- funcao `limparTabelas`.

3. **Prettier corrompeu conteudo de prosa.** Rodar `prettier --write .`
   sem revisar transformou a formatacao deliberada "VENDA + ESTOQUE +
   CAIXA..." (continuacao visual) do `projeto-sistema-adega.md` original
   do usuario numa lista com `-`, mudando o sentido visual. Revertido;
   `arquitetura.md` e `projeto-sistema-adega.md` agora estao em
   `.prettierignore` -- **NUNCA rodar Prettier `--write` nesses dois
   arquivos**. Sao conteudo/prosa do usuario, nao codigo.

---

## 6. Em aberto -- nao finalizado, decisao ou acao pendente

### 6.1 Spike do bridge (PWA HTTPS -> Chrome -> localhost:9100) -- SEM VEREDITO

Este e o item mais importante em aberto. `apps/bridge/main.go` esta
escrito e o comportamento de protocolo foi validado com `curl` (preflight
OPTIONS responde 204 com `Access-Control-Allow-Private-Network: true` e
os demais headers CORS corretos; log do processo registra origin e
headers de preflight recebidos). **Isso NAO prova que o Chrome de
verdade permite a chamada** -- curl nao aplica Private Network Access,
so um navegador aplica.

**Por que nao foi resolvido**: a maquina do Leandro (cliente final, dono
da adega) NUNCA esteve conectada a nenhuma sessao ate agora -- so a
maquina de quem esta desenvolvendo (`desktop-quutu4d`) esteve. Rodar o
teste de verdade exige acesso fisico (ou remoto) a uma maquina Windows
com Chrome, idealmente ja a maquina real da adega.

**Procedimento exato para fechar isto** esta documentado em
`apps/bridge/README.md` -- resumo: compilar
(`GOOS=windows GOARCH=amd64 go build`), rodar o `.exe` na maquina alvo,
servir `apps/bridge/spike-test.html` por HTTPS REAL (nao `file://`),
abrir no Chrome, clicar "Testar bridge agora", ler PASSA/FALHA. Se
FALHA, abrir DevTools -> Console ANTES de testar de novo -- o Chrome
imprime ali a frase exata da politica que bloqueou, informacao que o
proprio JS da pagina nao consegue ler por design de seguranca do
navegador.

**Nao pular direto para implementar um dos 4 fallbacks do
`arquitetura.md` secao 5.1 sem esse veredito** -- e exatamente o
comportamento que o usuario pediu para evitar ("Nao sair implementando
os quatro fallbacks por iniciativa propria").

Depois de rodar, registrar o resultado (PASSA/FALHA + frase exata do
Console se houver) de volta em `arquitetura.md` secao 5.1 e em
`apps/bridge/README.md`.

### 6.2 Docker nunca foi executado nesta sessao

`docker-compose.yml` foi escrito por especificacao correta (Postgres
17-alpine, healthcheck via `pg_isready`, volume nomeado), mas Docker nao
existe no ambiente de desenvolvimento usado (nem em `device_bash`, nem
no container cloud auxiliar) -- **nunca foi possivel rodar `docker
compose up` e confirmar na pratica**. O SCHEMA e a MIGRATION ja foram
validados contra Postgres real por outro caminho (`pglite`, que fala o
protocolo de fio do Postgres de verdade) -- entao o risco residual aqui
e especificamente sintaxe/porta/volume do compose, nao correcao do
schema. Primeira coisa a fazer com Docker disponivel: `pnpm db:up` e
depois `pnpm db:migrate` contra o Postgres de verdade subido pelo
compose.

### 6.3 Mensagem do commit `e22d9f0` tem um trecho perdido

Erro de shell quoting meu (crase dentro de aspas duplas foi interpretada
como substituicao de comando pelo bash). O CONTEUDO do commit
(`packages/db`) esta correto e testado -- so a mensagem ficou incompleta
("a divergencia entre essa config em producao e em teste foi um bug real
... config  do Drizzle" -- falta o trecho "`casing: 'snake_case'`" no
meio). Nao foi feito `git commit --amend` porque a regra seguida nesta
sessao e nunca reescrever historico sem pedido explicito do usuario.
Decisao de deixar como esta ou corrigir e do usuario/proximo agente.

### 6.4 Todo o resto da Fase 1 ainda nao foi construido

O scaffold cobriu SOMENTE o que foi explicitamente autorizado: tooling,
schema, healthcheck, tela minima, stub do bridge, infra. **Nao existe
ainda**: tela de produtos, fluxo de PDV/venda de verdade, fluxo de
caixa (abertura/sangria/fechamento) na UI, relatorios, importador do
Nexus, service worker/PWA offline de verdade (o principio esta descrito
em `arquitetura.md` secao 2, nada implementado), autenticacao
(admin e-mail/senha, PIN de operador). Ordem sugerida em
`arquitetura.md` secao 8 (tabela de fases/dias) -- ainda vale, nao foi
alterada por nada que aconteceu nesta sessao.

O usuario foi explicito: **"Depois PARAR. Nao comecar as
funcionalidades da Fase 1 automaticamente."** -- ele quer decidir o
proximo passo, nao que o agente decida sozinho seguir para produtos/PDV.

### 6.5 Dependencias reais (nao GAPs de trabalho -- fora do controle do dev)

- **Integracao com a Laranjinha Itau/Rede**: nao existe API publica para
  maquininha fisica. Confirmar com a Rede (4001-4433) qual caminho
  oficial (TEF homologado / app-to-app / link de pagamento) antes de
  prometer prazo para a Fase 2 disso.
- **Exportacao de dados do Nexus** (sistema atual do Leandro): ainda nao
  iniciada nesta sessao. E a dependencia de maior risco de atraso porque
  depende de terceiro (suporte do Nexus) -- comecar isso o quanto antes,
  em paralelo a qualquer outra coisa.
- **Contadora**: confirmar formato/periodicidade que ela precisa antes
  de fechar qualquer coisa de fiscal (que hoje esta soh modelada, nao
  implementada -- campos NCM/CEST/CFOP/CST/origem existem nulos no
  schema).

---

## 7. Ambiente de desenvolvimento usado nesta sessao (para reproduzir)

- Node 22 e npm ja vinham no `device_bash`. **pnpm nao vinha** --
  instalado via `npm install -g pnpm@9.15.4` com prefix em
  `$HOME/.npm-global` (adicionado ao `PATH` via `.bashrc`).
- **Go nao vinha, e nao ha `sudo`** no `device_bash`. Resolvido com
  `apt-get download golang-go golang-1.18-go golang-1.18-src` (baixar
  `.deb` NAO exige root, so instalar via `apt-get install` exige) e
  `dpkg-deb -x` para extrair sem privilegio, em `$HOME/go1.18`. Go
  1.18.1 -- antigo, mas suficiente para o stub. Variaveis: `GOROOT`,
  `GOPATH`, `GOCACHE`, `PATH` -- ver `.bashrc` de
  `desktop-quutu4d` se precisar recriar.
- **Docker nao existe e nao foi possivel instalar** (exige daemon e
  privilegio de root que nao esta disponivel).
- **Egress**: `registry.npmjs.org` e `github.com` acessiveis;
  `go.dev`/`dl.google.com` bloqueados pelo proxy (403) -- por isso a
  rota via `apt-get download` em vez de baixar o tarball oficial do Go.
- O container cloud auxiliar (fora do `device_bash`) tambem nao tinha
  Docker nem Go -- nao e so limitacao da VM do usuario.

---

## 8. Se voce e o proximo agente: por onde comecar

1. Leia `arquitetura.md` inteiro, depois `README.md`.
2. Recrie o clone local de trabalho se necessario (secao 2 acima) e
   rode `pnpm check && pnpm build` para confirmar que ainda esta tudo
   verde antes de mudar qualquer coisa.
3. Pergunte ao usuario -- ele PREFERE que voce pergunte quando a
   decisao e dele de verdade, mas decida sozinho o resto -- se o proximo
   passo e: (a) rodar o spike do bridge numa maquina Windows real,
   (b) comecar a exportacao do Nexus, ou (c) comecar as telas da Fase 1
   (produtos/PDV/caixa) assumindo que o adapter manual de pagamento
   e suficiente por enquanto. Ele disse explicitamente para parar antes
   dessa decisao, entao nao a tome sozinho.
4. Qualquer commit novo: Conventional Commits, pequeno, uma unidade
   logica, sem `--amend` a menos que ele peca.
