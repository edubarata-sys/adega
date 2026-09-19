# HANDOFF — Sistema da Adega

Documento único de transferência: o que é este projeto, o que já foi construído e testado, onde
cada coisa está, e o que ainda falta. Feito pra alguém pegar o projeto do zero (ou você mesmo,
depois de um tempo sem mexer) e entender o estado real sem precisar reconstruir o histórico.

Data: 11/09/2026.

---

## 1. O que é este projeto

Sistema de ponto de venda (PDV) feito sob medida para um cliente real: **Leandro, dono da ADEGA
DOIS IRMÃOS**, Rua Euclides Ribeiro 21, Residencial San Marino, Taubaté-SP. Substitui o sistema
atual da loja (Nexus Sistemas) — mas essa substituição não faz parte desta fase; hoje é só
contexto confirmado por foto do hardware.

O que o sistema faz:

- Login de administrador e PIN de operador (autenticação mínima, sem cadastro público).
- Busca de produto por código de barras (EAN) ou descrição.
- Abertura, movimentação e fechamento de caixa — o fechamento é **cego**: o valor contado é
  enviado antes de qualquer leitura do valor esperado pelo sistema.
- Venda transacional: item por item, cálculo de troco, baixa de estoque exatamente uma vez
  (inclusive sob reenvio idempotente da mesma venda).
- Pagamento via `ManualAdapter` — o sistema nunca recebe nem finge receber aprovação automática de
  uma adquirente; o operador só informa qual forma foi usada.
- Recibo de 58mm: texto formatado (32 colunas) e comandos ESC/POS reais, determinísticos e
  testáveis sem impressora nenhuma.
- Consulta de vendas recentes e detalhe de uma venda.

Decisão congelada desde o início da missão: **nenhum recibo sai sem o aviso "DEMONSTRAÇÃO — SEM
VALOR FISCAL"**. Esta fase não emite documento fiscal.

## 2. Arquitetura

Monorepo `pnpm`, workspaces:

- `apps/api` — Fastify. Rotas HTTP, sessão HMAC, sem lógica de negócio própria (delega tudo pro
  `packages/core`).
- `apps/web` — React + Vite. Interface do PDV (`App.tsx`, sem router — é uma máquina de estados
  única) e a página pública de diagnóstico de hardware (`/diagnostico`, resolvida em `main.tsx`
  antes de renderizar `<App/>`).
- `apps/bridge` — stub em Go. Só expõe `GET /health` em `127.0.0.1:9100`. **Não tem endpoint
  `/print`** — decisão deliberada de não "chutar formato" de impressão antes de validação física.
- `packages/core` — regras de negócio **zero I/O**: dinheiro (`Centavos`, tipo de marca), venda,
  caixa, recibo/ESC-POS, adapter de pagamento. Testável sem banco, sem impressora, sem rede.
- `packages/db` — Drizzle ORM sobre Postgres, testado em dois modos (pglite em memória para testes
  rápidos, postgres-js real para integração).

Comando `pnpm dev` na raiz sobe API e Web juntos (`pnpm -r --parallel dev`). O driver Postgres
(`postgres-js`) é **preguiçoso**: só conecta quando uma query roda de verdade — por isso a página
de diagnóstico funciona mesmo sem Postgres real rodando.

## 3. Status atual

**Fase 1 — missão ponta a ponta (10 PASSOs + gate automático): concluída.**
12 commits, terminou com status `PRONTO_PARA_TESTE_FISICO`. Um teste único
(`apps/api/src/gate-integrado.test.ts`) prova os 12 checkpoints em um fluxo real contra Postgres:
operador → caixa aberto → produto por EAN → venda → pagamento → estoque baixado uma vez → recibo
com aviso obrigatório e bytes ESC/POS reais → consulta → fechamento cego coerente.

**Fase 2 — diagnóstico de hardware, pedido do cliente: em andamento.**
14 commits. O cliente pediu, antes de qualquer venda real, uma forma de testar pistola, impressora
e maquininha separadamente. Essa frente está descrita em detalhe na seção 5.

Hoje: **151 testes automatizados passando** (23 arquivos de teste), **26 commits** no total,
**zero vendas reais** — ambiente ainda de teste.

`pnpm check` (format + lint + build + typecheck + test) limpo na última rodada.

## 4. Como rodar localmente

```
cd <pasta do projeto>
copy .env.example .env    # os valores de exemplo servem pro diagnostico; pra API completa
                           # com banco, ajustar DATABASE_URL e SESSION_SECRET
pnpm install
pnpm dev
```

API em `http://localhost:3000`, interface em `http://localhost:5173`. Página de diagnóstico em
`http://localhost:5173/diagnostico`.

Script pronto pra isso, com verificação de Node/pnpm e criação automática do `.env`:
`scripts/iniciar-diagnostico.bat` (duplo-clique no Windows).

## 5. Diagnóstico de hardware — o que existe e onde

Contexto: antes de qualquer venda real, o cliente precisa confirmar que a pistola, a impressora
(Waytec WP-50, confirmada por foto: 58mm, USB, ESC/POS) e a maquininha Itaú/Rede funcionam. A
Torre determinou explicitamente: **sem comunicação automática entre a página e a maquininha** —
isso continua um checklist manual.

Existem **dois caminhos de hospedagem**, porque o cliente só tem acesso FTP num hosting
compartilhado (sem poder configurar servidor nenhum):

### Caminho 1 — sistema completo, no PC da loja

Node + pnpm rodando local, API e interface juntas. `docs/GUIA-TESTE-SERVIDOR.md` tem o passo a
passo, troubleshooting e um modelo de relatório em texto pra preencher depois do teste físico.
Cobre os três testes, incluindo o teste B (bridge/ESC-POS).

### Caminho 2 — página avulsa, sem backend, hospedada por FTP

A página `/diagnostico` foi reescrita pra gerar tudo no próprio navegador (mesmos geradores puros
de `@adega/core`, dados compartilhados em `packages/core/src/recibo-diagnostico.ts`) e a logo vem
embutida em base64. `pnpm --filter web build:diagnostico` gera **um único arquivo HTML** (~185KB,
zero dependência externa) em `apps/web/dist-diagnostico/diagnostico.html`. Documentado em
`docs/GUIA-HOSPEDAGEM-ESTATICA.md`. Esse arquivo (renomeado `diagnostico-adega-dois-irmaos.html`)
já foi entregue ao cliente pra soltar na pasta `public_html/adega` do FTP dele.

Nesse caminho, o **Teste B (bridge) não funciona** — depende do PC de quem abre a página ter o
bridge instalado localmente, não de onde o HTML está hospedado. O leitor (é HID, teclado) e o
Teste A da impressora (driver do Windows) funcionam igual nos dois caminhos.

### Resultado do teste — como ele chega até você

A página não tem backend nenhum (caminho 2), então não existe envio automático pra um servidor
nosso. A 4ª seção da página, "Resumo final", monta um relatório de texto com o status real de cada
teste e oferece três formas de mandar: **copiar**, **WhatsApp** (link `wa.me`, sem número fixo — a
pessoa escolhe o destinatário) e **e-mail** (link `mailto:` já endereçado para
`eduardo@impsys.com.br`, assunto e corpo prontos).

## 6. Linha do tempo de commits (Fase 2, em ordem)

| Commit | O que mudou |
|---|---|
| `8a937fb` | Página de diagnóstico criada — rota pública, sem login, três testes independentes. |
| `368e383` | ADENDO no relatório final documentando a página. |
| `6def0fb` | Specs de hardware confirmadas por fotos reais da loja (Durawell SC-2013, Waytec WP-50). |
| `8232e7e` | ADENDO documentando a confirmação por fotos. |
| `a978bb5` | Redesenho visual com a marca real da loja (tema escuro/dourado, logo). |
| `c85eca5` | ADENDO sobre o redesenho + nota de confiabilidade do espelhamento de arquivos. |
| `f232ec6` | Guia de teste no PC da loja + script `.bat` + modelo de relatório. |
| `eb10f1f` | Ajuste de hash no ADENDO. |
| `30d5b53` | Build estática standalone (sem backend) — página vira um único arquivo HTML. |
| `6caa1d3` | Guia de hospedagem estática via FTP + ADENDO. |
| `28faf36` | Resumo final copiável + botão de WhatsApp. |
| `435457c` | ADENDO sobre o resumo final. |
| `52f8875` | Botão de e-mail pré-endereçado no resumo final. |
| `76004d3` | ADENDO sobre o botão de e-mail. |

Histórico completo e detalhado de cada decisão: `docs/ENTREGA-FINAL-GATE.md` (ADENDOs 1 a 7).

## 7. Pendências reais — o que só alguém com as mãos na máquina resolve

1. **Levar os commits pro histórico real do D:\adega.** Hoje só o sandbox de build tem o log
   completo; os arquivos já batem, só falta `git add -A && git commit` no terminal físico (comandos
   exatos já estão no `docs/ENTREGA-FINAL-GATE.md`).
2. **Ajuste de 2 linhas em `.github/workflows/ci.yml`.** Caminho protegido contra escrita remota —
   o conteúdo final já está pronto, só falta colar manualmente.
3. **Subir o Postgres real no Windows.** Descobrir serviço/porta real, criar o banco `adega`,
   aplicar a migração, rodar um teste real. Bloqueado remotamente por falta de acesso a shell na
   máquina real durante boa parte da sessão.
4. **Teste físico de impressão com o Leandro.** É o único jeito de confirmar se o driver da Waytec
   WP-50 está instalado no Windows e qual página de código ela aceita de verdade — os dois campos
   continuam `DESCOBRIR_NO_TESTE` na página até esse teste acontecer.

## 8. Observações e riscos conhecidos

- **Escrita remota não confiável sem reconferência.** O comando que espelha arquivos pro PC real
  da loja já relatou sucesso (inclusive com `force`) enquanto entregava conteúdo desatualizado
  (`docs/ENTREGA-FINAL-GATE.md`, uma vez) ou um arquivo binário re-codificado com tamanho diferente
  mas mesmo conteúdo visual (a logo, duas vezes). Prática adotada: **toda escrita remota é
  reconferida byte a byte** (stage de volta + diff) antes de ser considerada concluída.
- **`apps/bridge` é só um stub.** Só `/health`. Nenhum endpoint de impressão existe ainda —
  decisão deliberada, não pendência esquecida.
- **Nada aqui tem valor fiscal.** Todo recibo, real ou de teste, carrega o aviso obrigatório.

## 9. Onde encontrar cada coisa

| Arquivo | O quê |
|---|---|
| `docs/ENTREGA-FINAL-GATE.md` | Relatório completo da Fase 1 + os 7 ADENDOs da Fase 2, com todo o detalhe técnico de cada decisão. |
| `docs/GUIA-TESTE-SERVIDOR.md` | Rodar o sistema completo no PC da loja + modelo de relatório físico. |
| `docs/GUIA-HOSPEDAGEM-ESTATICA.md` | Subir a página avulsa por FTP. |
| `scripts/iniciar-diagnostico.bat` | Sobe o sistema local com um duplo-clique. |
| `apps/web/dist-diagnostico/diagnostico.html` | Build estática da página de diagnóstico (gerar com `pnpm --filter web build:diagnostico`). |
| `packages/core/src/recibo-diagnostico.ts` | Dados fixos do recibo de teste — fonte única compartilhada entre a API local e a build estática. |
