# GATE — PRIMEIRO TESTE ADEGA

STATUS:
PRONTO_PARA_TESTE_FISICO

Commits realizados:
Os 12 commits abaixo existem no repositório do sandbox de build (fallback autorizado, já que `device_bash` ficou indisponível durante toda a missão — ver "Pendências que realmente exigem Eduardo" item 1). Todos os arquivos que eles produzem já foram espelhados e VERIFICADOS BYTE A BYTE no D:\adega real (diff limpo em 59 dos 60 arquivos alterados; o único que não bate é `.github/workflows/ci.yml`, que é um caminho protegido contra escrita remota — ver item 2).

- de65054 fix: garante reprodutibilidade do gate `pnpm check` a partir de clone limpo
- 0782972 feat: seed reproduzível de dados de teste e hash de senha/PIN (PASSO 1)
- 7bcc10e feat: autenticação mínima — login admin, PIN operador, sessão HMAC (PASSO 2)
- 69d4de7 feat: API mínima de produtos — busca por EAN e por descrição (PASSO 3)
- a3de0e2 feat: rotas de caixa — abrir/consultar/movimentar/fechar (PASSO 4)
- 8367317 feat: venda transacional (núcleo da missão) — POST /vendas (PASSO 5)
- f86fd92 feat: ManualAdapter — porta explícita de pagamento (PASSO 6)
- a1c7897 feat: PDV web — login, abertura de caixa e tela de venda EAN→pagamento (PASSO 7)
- a061cda feat: PrinterAdapter — recibo 58mm determinístico + ESC/POS + FakePrinterAdapter (PASSO 8)
- 4b31332 feat: consulta de venda — localizar recentes e inspecionar uma venda (PASSO 9)
- 16c338e feat: tela de fechamento de caixa — fechamento cego na UI (PASSO 10)
- 09ae74a test: GATE AUTOMÁTICO — teste integrado dos 12 checkpoints ponta a ponta

Baseline: 6d702ad no sandbox = fa09755c em D:\adega (HEAD real no início da missão).

Testes:
`pnpm check` (format:check + lint + build + typecheck) — limpo, sem erros, rodado a partir de clone reproduzível.
`pnpm test` — 21 arquivos de teste, 142 testes, todos passando (inclui o teste único do GATE AUTOMÁTICO com os 12 checkpoints).
Ambos rodados no sandbox contra a árvore de arquivos que já está confirmada idêntica ao D:\adega real.

Fluxo demonstrado:
`apps/api/src/gate-integrado.test.ts` prova, em um único fluxo real contra Postgres (via pglite): operador identificado por PIN → caixa aberto → produto localizado por EAN → venda criada com cálculo correto (3× R$5,50 = R$16,50, pago com R$20,00, troco R$3,50) → pagamento confirmado via ManualAdapter sem inventar dados de adquirente → estoque baixado exatamente uma vez, inclusive sob reenvio idempotente da mesma venda → movimento de estoque existe no ledger append-only → comprovante gerado com o aviso "DEMONSTRAÇÃO — SEM VALOR FISCAL" (duas vezes) e bytes ESC/POS reais (ESC @ de inicialização) → venda consultável na listagem e no detalhe → caixa fechado com fechamento cego (valor contado enviado antes de qualquer leitura de "esperado") e coerência numérica exata (fundo + venda líquida de troco + suprimento).

PostgreSQL Windows:
BLOQUEIO_REDE_VM_HOST — não foi possível executar nenhum comando no host Windows durante toda a missão. `device_bash` falhou de forma consistente e idêntica em todas as tentativas (início da missão, antes do subgate de Postgres, e novamente agora): `sandbox-helper: no Plan9 drive shares mounted under /mnt/.virtiofs-root/shared`. Isso não é uma falha de rede comum entre a VM e um Postgres já em execução — é a ausência total de um shell no dispositivo real durante esta sessão inteira, então nem descoberta de serviço/versão/porta, nem `psql`, nem criação do banco ADEGA, nem aplicação da migration puderam ser tentadas. Nenhuma configuração de Postgres (firewall, `listen_addresses`, serviço) foi tocada, como instruído. Isso precisa ser refeito com acesso de terminal real à máquina (ver Próximo teste físico exato).

Bridge:
Decisão já tomada e documentada no commit do PASSO 8: não estender `apps/bridge` com uma rota `/print` nesta missão, porque a pergunta de PNA (HTTPS→localhost) do bridge ainda não foi validada fisicamente — implementar impressão real sobre uma fundação não verificada seria "chutar formato". A missão não foi bloqueada por isso: o comprovante é gerado e servido pela API (`GET /vendas/:id/recibo`) e a UI já exibe o texto e oferece um fallback auxiliar via `window.print()`. O spike de PNA (`apps/bridge/spike-test.html`) continua disponível para quando Eduardo puder testá-lo fisicamente no Chrome.

Impressora:
SIMULADA_OK

Leitor:
TECLADO_HID_OK

Pendências que realmente exigem Eduardo:

1. **Capturar os 12 commits no histórico git real do D:\adega.** Como `device_bash` ficou fora do ar a missão inteira, todo o trabalho de código foi feito e commitado em um sandbox de build na nuvem, e cada arquivo alterado foi espelhado individualmente para D:\adega via cópia de arquivo (não via `git commit`). Isso foi verificado byte a byte ao final da missão e está correto — mas o `git log` real em D:\adega ainda mostra só o commit `fa09755c` (baseline), com os arquivos das 12 mudanças aparecendo como working-tree modificado/novo, não commitado. Para registrar isso no histórico real, rodar em D:\adega (com terminal local):
   ```
   git add -A
   git commit -m "feat: fluxo ponta a ponta completo do MVP (operador->caixa->produto->venda->pagamento->estoque->caixa->comprovante->consulta->fechamento)"
   ```
   (ou, se preferir manter a granularidade original, os 12 commits do sandbox podem ser recriados um a um com as mensagens listadas acima — nenhuma das duas abordagens é obrigatória tecnicamente, é só uma escolha de como Eduardo quer o histórico.)
2. **Aplicar manualmente o fix em `.github/workflows/ci.yml`** — `device_commit_files` recusa esse caminho ("is a protected file and cannot be written via remote tools"), confirmado duas vezes nesta missão. A mudança é só reordenar `build` antes de `typecheck` nos steps do job `check`. Conteúdo final já pronto:
   ```yaml
   name: CI
   on:
     push:
       branches: [main]
     pull_request:
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v4
           with:
             version: 9.15.4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: pnpm
         - run: pnpm install --frozen-lockfile
         - run: pnpm format:check
         - run: pnpm lint
         - run: pnpm build
         - run: pnpm typecheck
         - run: pnpm test
   ```
3. **Subgate de PostgreSQL Windows 18.6** — precisa de terminal real na máquina (ver BLOQUEIO_REDE_VM_HOST acima). Passos: localizar o serviço Postgres (`Get-Service postgresql*` ou similar), confirmar versão/porta, `CREATE DATABASE adega;` (nome sugerido), aplicar a migration de `packages/db`, e rodar a API real apontando pra esse banco pra um smoke test (abrir caixa → vender → fechar, os mesmos passos do gate, mas contra Postgres de verdade em vez de pglite).
4. **(Opcional, não bloqueia a missão)** Testar fisicamente o spike de PNA do bridge (`apps/bridge/spike-test.html`) no Chrome, se/quando Eduardo quiser avaliar impressão real via bridge no futuro.

Pendências externas:
Nenhuma além das listadas acima. Fora de escopo por decisão da Torre (não tocado, como instruído): Docker, PWA/offline, Nexus real, integração Rede/Itaú, emissão NFC-e/NF-e, XML fiscal, integração contábil.

Próximo teste físico exato:
Na máquina real (D:\adega), com terminal disponível:

1. Rodar os comandos do item 1 acima (git commit) e aplicar o fix do item 2 (ci.yml).
2. `pnpm install --frozen-lockfile && pnpm check && pnpm build` — confirmar que a árvore sincronizada builda limpo também na máquina real (já confirmado no sandbox; isso é só a re-confirmação local).
3. Resolver o subgate de PostgreSQL (item 3) antes ou depois do teste manual — o fluxo funciona com pglite para os testes automatizados, mas o teste físico real deve usar o Postgres real da máquina.
4. Subir `apps/api` e `apps/web` localmente, logar como operador via PIN, abrir o caixa, passar um leitor USB HID (ou digitar) um EAN real de produto cadastrado, completar uma venda em dinheiro, conferir o comprovante simulado na tela, consultar a venda na lista, e fechar o caixa confirmando o valor contado antes de ver o esperado — exatamente o fluxo que `gate-integrado.test.ts` já prova de forma automatizada, agora com as mãos.

---

ADENDO — Página de diagnóstico de hardware (commit `8a937fb`):

Depois do gate acima, o cliente pediu uma página separada para testar fisicamente a pistola, a impressora e a maquininha antes do teste completo. Especificações vieram da Torre (Waytec WP-50, papel 58mm, pistola em modo HID/teclado — conexão, driver e codepage da impressora ainda `DESCOBRIR_NO_TESTE`; maquininha `AUTONOMA`, sem integração nesta fase).

Implementado e testado (`pnpm check` limpo, 23 arquivos / 150 testes passando, incluindo os 3 novos testes de `GET /diagnostico/recibo-teste` e os 5 novos testes de `DiagnosticoTela`), já espelhado e verificado byte a byte em D:\adega:

- Rota pública `GET /diagnostico/recibo-teste` (`apps/api/src/routes/diagnostico.ts`) — recibo fixo, sem banco, usando o mesmo gerador de texto + ESC/POS de `packages/core/recibo.ts`, com uma linha dedicada a teste de caracteres (ASCII, acentos, cedilha, R$).
- Página `apps/web/src/DiagnosticoTela.tsx`, acessível em `/diagnostico` sem login (roteada em `main.tsx` antes da máquina de estados de autenticação):
  1. **Leitor**: aceita Enter, Tab ou timeout de inatividade como fim de leitura (nunca assume Enter, como a Torre pediu), com classificação heurística pistola-vs-manual por velocidade entre teclas.
  2. **Impressora**: teste A (driver Windows via `window.print()`), teste B (bridge ESC/POS — só checa `/health`, já que `/print` não foi implementado no bridge; bytes ESC/POS disponíveis para copiar manualmente), e o teste de caracteres embutido no mesmo recibo.
  3. **Maquininha**: checklist manual (ligar, verificar conectividade, operação de teste, confirmar aprovação autônoma) — sem nenhuma comunicação navegador→maquininha, coerente com o ManualAdapter.

Pendência que ainda exige Eduardo: capturar este commit também no histórico git real de D:\adega (mesmo procedimento do item 1 acima — este ainda não foi rodado localmente, já que `device_bash` segue indisponível nesta sessão).

ADENDO 2 — specs de hardware confirmadas por fotos reais (commit `6def0fb`):

O cliente mandou fotos do hardware real da loja (ADEGA DOIS IRMAOS, Rua Euclides Ribeiro 21, Residencial San Marino, Taubaté-SP) em 10/09/2026. Isso confirma, por etiqueta/foto — não mais por suposição:

- **Leitor**: Durawell SC-2013, a laser, conectado por USB.
- **Impressora Waytec WP-50**: interface **USB** (visível na etiqueta do fabricante e no cabo fotografado plugado na CPU) e **"Comandos Compatível ESC/POS"** (também na etiqueta) — confirma que o contrato ESC/POS já implementado em `packages/core/recibo.ts` está no caminho certo.
- Também apareceu nas fotos: o sistema atual em uso na loja é o **Nexus Sistemas** (confirma o que já era assumido — não é para integrar, só contexto), e uma gaveta de dinheiro física já instalada no balcão.

Ainda ficam `DESCOBRIR_NO_TESTE` (não dava pra confirmar só pela foto): se a WP-50 aparece como impressora instalada no Windows (driver) e qual página de código ela aceita de verdade — isso só um teste de impressão físico decide. A página de diagnóstico já reflete essas confirmações (badges verdes onde antes eram amarelos) e mantém os testes A/B/C do jeito que estavam para o que ainda falta.

ADENDO 3 — redesenho visual com a marca da loja, pronto pra colocar no servidor (commit `a978bb5`):

O cliente pediu uma versão "bonita" da página `/diagnostico`, com a marca da loja, pra jogar no servidor e o Leandro reconhecer o que está testando sem precisar entender jargão técnico. Reskin completo, lógica de cada teste inalterada:

- Tema escuro + dourado usando a logo real da ADEGA DOIS IRMAOS (enviada pelo cliente), aplicada em `apps/web/public/logo-adega-dois-irmaos.jpg` e no cabeçalho da página.
- Resumo de status no topo (3 indicadores — Leitor / Impressora / Maquininha — pendente/confirmado/atenção) que atualiza ao vivo conforme cada teste é concluído.
- Cada seção virou um cartão com ícone, número e descrição em linguagem simples; os detalhes técnicos (badges, modelos, especificações) ficaram atrás de um "Detalhes técnicos" recolhível, em vez de expostos direto.
- Verificado visualmente com Playwright antes de commitar (screenshot desktop e mobile, e um fluxo completo simulando leitura, testes de impressora marcados e checklist da maquininha preenchido) — as capturas foram enviadas ao usuário na conversa.
- `pnpm check` limpo, 23 arquivos / 150 testes passando sem nenhuma alteração nos testes existentes (os textos/placeholders usados nas asserções foram preservados de propósito durante o redesenho).

Sobre testar a maquininha "de verdade": a Torre já havia determinado explicitamente que esta página NÃO deve se comunicar com a maquininha (Fase 1 usa `ManualAdapter`, sem TEF/SDK aprovado) — então o teste da maquininha continua sendo um checklist manual que o Leandro preenche olhando pra ela, não uma comunicação automática. Isso não mudou nesta rodada.

Nota de confiabilidade (mais uma ocorrência do padrão já documentado): ao espelhar o arquivo de logo (binário, JPEG) para D:\adega, `device_commit_files` reportou sucesso duas vezes (inclusive com `force`), mas o arquivo no dispositivo ficou com um tamanho diferente do original (19550 bytes vs 13779 bytes). Baixei o arquivo de volta e conferi visualmente — é a mesma logo, mesma resolução 225x225, aparentemente só recodificada em algum ponto do pipeline de transferência (não é o mesmo bug de conteúdo "revertido/antigo" visto com `vendas.ts` na missão anterior — aqui o conteúdo visual está correto, só os bytes exatos mudaram). Não é um problema para o funcionamento da página, mas fica registrado como mais uma evidência de que `device_commit_files` não deve ser confiado sem reconferência, inclusive para arquivos binários.

ADENDO 4 — guia de teste no servidor da loja + script de inicialização + modelo de relatório (commit `f232ec6`):

O cliente pediu um documento pra conferir se o ambiente sobe de verdade no PC da loja e que "gere nossas respostas" — ou seja, que sirva tanto de checklist de instalação quanto de modelo pra registrar as respostas físicas que a Torre pediu (driver da impressora, terminador do leitor, etc.), sem precisar de mais nenhuma decisão remota.

- **`docs/GUIA-TESTE-SERVIDOR.md`** (novo): passo a passo completo — pré-requisitos (Node 22+, pnpm), como rodar (`scripts/iniciar-diagnostico.bat` ou os comandos manuais `pnpm install` / `pnpm dev`), o que checar em cada seção da página, troubleshooting das falhas mais prováveis (pnpm não encontrado, porta ocupada, etc.), e — na seção final — um modelo de relatório em texto simples com checkboxes e campos em branco pra preencher depois do teste físico (leitor: terminador observado; impressora: driver instalado, conexão, resultado do teste via driver do Windows e via bridge, acentuação, corte de papel; maquininha: os 4 passos do checklist). Esse bloco preenchido é literalmente a resposta que falta mandar pra Torre.
- **`scripts/iniciar-diagnostico.bat`** (novo): script Windows de duplo-clique que confere Node/pnpm instalados, cria o `.env` a partir do `.env.example` se não existir, roda `pnpm install` na primeira vez, sobe `pnpm dev` (API + Web num comando só, confirmado que o `package.json` raiz já tem esse script) e abre o Chrome sozinho em `http://localhost:5173/diagnostico` depois de alguns segundos.
- Confirmado no código (`apps/api/src/server.ts` + `packages/db/src/client.ts`) que o driver Postgres usado (`postgres-js`) é **preguiçoso** — só conecta no banco quando uma query realmente roda. Como a rota `/diagnostico/recibo-teste` não toca o banco, o `DATABASE_URL` do `.env.example` pode ficar com o valor de exemplo (sem Postgres real rodando) só para este teste específico — isso está documentado no guia pra evitar que o cliente ache que precisa instalar/configurar Postgres antes de testar hardware.
- `apps/bridge` (Go) não faz parte do `pnpm dev` (não tem `package.json`, roda separado) e continua sem endpoint `/print` — o guia deixa explícito que o teste via bridge é opcional/pode falhar sem problema, o caminho principal de teste é o driver de impressora do Windows.

ADENDO 5 — build estática standalone da página de diagnóstico, sem backend nenhum (commit `30d5b53`):

O cliente esclareceu o cenário real (print do FileZilla conectado num hosting compartilhado, pasta `public_html/adega` recém-criada, acesso só por FTP): ele vai hospedar a página de diagnóstico num servidor onde **não tem acesso pra configurar nada** — sem Node, sem processo rodando, só soltar arquivo. O sistema completo (API + banco) continua fora disso; para ele o cliente já está pensando em algo tipo Railway depois, separadamente. Aqui o pedido era só a página de diagnóstico de hardware.

Mudança arquitetural: o recibo de teste, que antes vinha de uma chamada à API local (`GET /diagnostico/recibo-teste`), agora é gerado **direto no navegador**, chamando os mesmos geradores puros de `@adega/core` (`gerarLinhasRecibo`/`gerarComandosEscPos`) que a API sempre usou. Os dados fixos do recibo de teste foram movidos para `packages/core/src/recibo-diagnostico.ts` (`DADOS_RECIBO_DIAGNOSTICO`) — fonte única compartilhada entre a rota da API (que continua existindo, sem mudança de comportamento, para quando o ambiente roda completo no PC da loja) e a página estática. A logo da loja passou a ser importada como módulo (`?inline`), embutida em base64 direto no JavaScript, em vez de um arquivo separado em `public/`.

Nova build dedicada: `pnpm --filter web build:diagnostico` (config `apps/web/vite.diagnostico.config.ts`, plugin `vite-plugin-singlefile`, entrada `apps/web/diagnostico.html` → `apps/web/src/main-diagnostico.tsx`) gera **um único arquivo HTML autossuficiente** (~183KB, JS e CSS inlinados, zero referência a arquivo externo — confirmado por grep, sem nenhum `src="http`/`href="http`) em `apps/web/dist-diagnostico/`. Renomeado para `diagnostico-adega-dois-irmaos.html` antes de entregar.

Verificação: servido localmente com um servidor HTTP simples e aberto via Playwright — carrega sem erro de console (só o 404 esperado do favicon), mostra a logo, o resumo de status, a prévia do recibo com teste de acentuação (`áéíóú`) e o item de teste — captura enviada ao usuário. `pnpm check` limpo, 150 testes passando (nenhum teste existente precisou mudar: os textos/valores usados nas asserções continuam batendo com o recibo real, porque sempre foram os mesmos dados).

Documentado em `docs/GUIA-HOSPEDAGEM-ESTATICA.md` (novo): como subir o arquivo pelo FileZilla na pasta já criada, o que funciona hospedado remotamente (leitor — é HID, não depende de onde a página está; impressão via driver do Windows) e o que não funciona (Teste B via bridge, que depende do PC de quem abre a página ter o bridge rodando localmente, não de onde o HTML está hospedado).

`.gitignore` ganhou `dist-diagnostico/` (artefato de build, não deve ir pro histórico).

ADENDO 6 — resumo final copiável / WhatsApp, respondendo "a gente recebe algo ou ele tem que me dar o resultado" (commit `28faf36`):

Pergunta direta do cliente. Resposta honesta primeiro: como a página não tem backend nenhum (ADENDO 5), não existe como "receber" algo automaticamente num servidor nosso — sem servidor, não tem pra onde mandar sozinho.

O que dá pra fazer sem servidor: uma 4ª seção "Resumo final" na própria página, que junta o status e um detalhe real de cada teste (leitor, impressora, maquininha) — cada seção passou a reportar `(status, detalhe)` via um novo callback `onAtualizar`, em vez de só status — e monta um texto pronto tipo:

```
RESUMO — Diagnóstico de Hardware (Adega Dois Irmãos)
Gerado em: 10/09/2026, 14:40:47
[CONFIRMADO] Leitor de código de barras — 3 leitura(s) registrada(s). Última: código "789...", terminador Enter, classificação provável pistola (HID).
[PENDENTE] Impressora térmica — Teste A (driver Windows): nao-testado. Teste B (bridge): nao-testado.
[CONFIRMADO] Maquininha Itaú/Rede — 4/4 passos confirmados. Maquininha confirmada funcionando de forma autônoma.
```

Com dois botões: "Copiar resumo" (clipboard) e "Enviar por WhatsApp" (link `wa.me` pré-preenchido com esse texto, sem número fixo — o Leandro escolhe pra quem manda). Isso fecha o loop real: ele testa, a própria página monta o relatório, ele manda com um clique — em vez de precisar descrever de memória o que aconteceu (o que era o risco de deixar só o modelo de relatório em texto do ADENDO 4, que continua valendo como registro formal/mais completo pra quando o teste é feito com o sistema completo no PC da loja).

Ajuste nos testes: como o resumo repete, de propósito, os mesmos títulos e frases das seções (é um resumo, tem que citar as mesmas coisas), duas asserções que buscavam texto solto passaram a bater em mais de um lugar. Trocadas por busca por `heading` (títulos das seções) e por `getAllByText` onde a duplicação é esperada — nada na aplicação estava errado, só o teste precisava ficar mais específico. `pnpm check` limpo, 151 testes passando (1 teste novo, cobrindo a seção de resumo).

ADENDO 7 — botão "Enviar por e-mail" pré-endereçado no resumo final (commit `52f8875`):

Pedido direto do cliente: "manda o resultado pra eduardo@impsys.com.br". Não existe ferramenta de envio de e-mail disponível neste ambiente — avisado ao cliente antes de agir. Solução possível, no mesmo espírito do botão de WhatsApp do ADENDO 6: um terceiro botão na seção "Resumo final", link `mailto:eduardo@impsys.com.br` com assunto e corpo (o mesmo resumo) já preenchidos via query string — quem testa só clica, o cliente de e-mail dele abre pronto pra enviar, sem escolher destinatário nem copiar/colar nada. Endereço fica como constante (`EMAIL_DESTINO_RESUMO`) no topo do componente, fácil de trocar depois se precisar. `pnpm check` limpo, 151 testes passando.
