# Contexto do projeto: Sistema PDV — Adega Dois Irmãos

> Documento de transferência de contexto para a Torre GPT (ou qualquer outro agente/IA que
> acompanhe este projeto). Escrito em 20/09/2026, resume o que o projeto é, o que já está pronto e
> testado, o que falta e as decisões já fechadas com o cliente — sem precisar reconstruir o
> histórico de conversa pra continuar acompanhando.

## 1. O cliente e o problema

**Leandro**, dono da **ADEGA DOIS IRMÃOS** (loja de bebidas), Rua Euclides Ribeiro 21, Residencial
San Marino, Taubaté-SP. Hoje ele usa um sistema de terceiros (Nexus/Nex, ver seção 7) e quer um PDV
(ponto de venda) próprio, feito sob medida, rodando localmente na loja.

Restrições de negócio importantes que moldaram o projeto:

- **Sem emissão fiscal.** O Leandro já emite nota fiscal por um PDV separado, fornecido pelo Itaú.
  Este sistema **não emite e nunca vai emitir** NFC-e nem qualquer documento fiscal — só um extrato
  de vendas simples (XML) pra contadora. Todo recibo impresso carrega o aviso "DEMONSTRAÇÃO — SEM
  VALOR FISCAL".
- **Sem integração automática com maquininha de cartão.** Avaliado (inclusive com segundas opiniões
  de outras IAs) e descartado: exigiria homologação com adquirente/TEF house, custo/escopo que não
  compensa pro tamanho do negócio. O operador só registra manualmente qual forma de pagamento (e,
  se cartão, qual das duas maquininhas físicas da loja) foi usada.
- **Vai rodar como executável local**, num PC próprio da loja (ainda não definido/comprado — hoje o
  desenvolvimento roda numa máquina de testes), não como site/web. Banco de dados, schema e
  programa embutidos no instalável; hardware (leitor de código de barras, impressora) deve
  "plugar e funcionar" sem configuração manual.
- **Backup**: hoje seria HD local + pendrive manual; migração pra backup "online" está prevista mas
  o destino exato ainda não foi decidido.
- **Encriptação**: leve numa primeira versão, mais robusta depois — escopo exato (só código, só
  dados, ou os dois) ainda não especificado pelo cliente.

## 2. O que o sistema já faz

- Login de administrador + PIN de operador (autenticação simples, sem cadastro público de conta).
- Busca de produto por código de barras (EAN) ou por descrição.
- **Cadastro e edição de produtos**, com categoria, e **movimentação manual de estoque** (entrada,
  perda, ajuste) — tela própria, separada da tela de venda.
- Abertura, sangria/reforço e fechamento de caixa. O fechamento é **cego**: o operador informa o
  valor contado antes de o sistema revelar o valor esperado (evita "ajustar pra bater").
- Venda item por item, cálculo de troco, baixa de estoque exatamente uma vez por venda (mesmo se a
  mesma venda for reenviada por engano/erro de rede).
- Recibo térmico de 58 mm: texto formatado e comandos ESC/POS reais, testável sem impressora física
  conectada.
- Consulta de vendas recentes e detalhe de cada venda.
- Relatório de vendas em XML por período, pra contadora — total geral, quebra por forma de
  pagamento e quebra por qual das duas maquininhas recebeu.
- Página pública de diagnóstico de hardware (leitor, impressora, maquininha) — feita pra o cliente
  testar sozinho antes da ida a campo, com duas formas de hospedar (sistema completo rodando local,
  ou uma página HTML avulsa hospedada por FTP, já que o cliente só tem acesso FTP num hosting
  compartilhado).

## 3. Estado atual

**185 testes automatizados passando**, cobrindo as regras de negócio (venda, caixa, estoque,
recibo, relatório) e as rotas HTTP de ponta a ponta. Build, lint e checagem de tipos limpos.
Zero vendas reais até agora — ambiente ainda é de teste/desenvolvimento.

Módulos já concluídos e considerados estáveis:

1. Fluxo ponta a ponta de venda (operador → caixa → produto → venda → pagamento → estoque →
   recibo → consulta → fechamento).
2. Página de diagnóstico de hardware.
3. Relatório de vendas em XML pra contadora, com quebra por maquininha.
4. Tela de cadastro de produtos e controle de estoque.

O layout de todas as telas é **propositalmente simples** por enquanto — o cliente pediu pra deixar
o ajuste visual/redesenho pra uma conversa presencial, ainda não realizada.

## 4. Arquitetura técnica (resumo)

Monorepo `pnpm` com quatro partes:

- **`apps/api`** — backend em Fastify (Node/TypeScript). Só rotas HTTP e sessão; nenhuma regra de
  negócio mora aqui.
- **`apps/web`** — frontend em React + Vite. Interface do PDV é uma máquina de estados única (sem
  biblioteca de rotas).
- **`apps/bridge`** — hoje é só um stub (só responde "estou vivo"); ainda não faz a ponte real com
  a impressora. Decisão deliberada: não implementar o formato de impressão antes de testar com a
  impressora física do cliente.
- **`packages/core`** — todas as regras de negócio (dinheiro, venda, caixa, recibo, relatório),
  escritas sem nenhuma dependência de banco/rede/impressora — por isso são fáceis de testar.
- **`packages/db`** — acesso a dados via Postgres (Drizzle ORM).

Dinheiro é sempre tratado como número inteiro de centavos (nunca ponto flutuante), pra evitar erro
de arredondamento.

## 5. Decisões já fechadas com o cliente (não reabrir sem ele pedir de novo)

- Sem integração automática com maquininha (ver seção 1).
- Sem emissão fiscal própria (ver seção 1).
- Vai ser um executável local, não um sistema web.
- Layout definitivo de todas as telas fica pra depois de uma conversa presencial.

## 6. Pendências reais — dependem de alguém com a mão na máquina física

1. Subir um banco Postgres de verdade no computador da loja (hoje só testado em ambiente de
   desenvolvimento/nuvem).
2. Teste físico de impressão com o Leandro presente, pra confirmar que a impressora térmica
   (modelo Waytec WP-50, já identificado por foto) imprime corretamente pelo Windows.
3. Empacotar o sistema como executável desktop de verdade (ainda não implementado — é só uma
   decisão tomada, falta construir).
4. Rodar a instalação de dependências do projeto (`pnpm install`) direto na máquina real — a
   tentativa mais recente pela conexão remota deixou isso incompleto lá; precisa ser refeito
   sentado na máquina ou por uma sessão que rode local nela.

## 7. Sobre a importação do sistema antigo (pendência de pesquisa, ainda sem construção)

O cliente quer, no futuro, importar os dados do sistema que ele usa hoje. Pesquisa (não
confirmada in loco) aponta que o sistema provavelmente é o **"Nex" da Nextar**, às vezes vendido
como "Nexus PDV" — instala em `C:\Nex`, roda um serviço `NexServ`, guarda backup em `C:\Nex\Copia`.
O fornecedor tem uma função oficial de "importar planilha de produtos", o que sugere que também dê
pra **exportar** os dados via planilha (mais fácil que mexer direto no banco). Não foi confirmado
publicamente qual banco de dados ele usa por baixo (palpite: Firebird, comum nesse tipo de sistema
brasileiro, mas é só inferência). Confirmação definitiva só visitando a loja: checar se roda um
processo `firebird.exe` no Windows, ou ligar pro suporte do Nex e perguntar sobre exportação via
planilha.

## 8. Backlog aprovado — próximos passos combinados, ainda não construídos

Em ordem sugerida:

1. Tela de relatórios visual (vendas por dia/semana/mês, produto mais vendido, por maquininha) — o
   banco de dados já suporta, só falta a interface.
2. Redesenho visual de todo o sistema (PDV, cadastro de produtos, etc.) — grande, estilo caixa de
   supermercado, fácil de operar. Depende da conversa presencial sobre layout.
3. Tela/fluxo de importação de dados do sistema antigo (Nex), usando a pesquisa da seção 7 como
   ponto de partida.
4. Decidir e implementar o destino do backup "online".
5. Avaliar trocar o Postgres por um banco embutido mais simples (pglite), pensando no executável.
6. Empacotar como executável desktop de verdade (item 3 da seção 6).
7. Implementar a encriptação leve da v1 (escopo ainda em aberto com o cliente).

## 9. Ideias futuras — discutidas mas explicitamente NÃO priorizadas agora

- Venda de produtos por peso/volume sem código de barras (ex.: espetinho, chopp) — precisa de um
  fluxo de venda diferente do "lê código de barras".
- Portar a lógica de um projeto Python separado do cliente ("Caixa Oculto", que calcula giro de
  estoque e sugere liquidar/renegociar/ajustar compra) pra um futuro relatório de "produtos
  parados" da Adega.
- Fiado, alerta de estoque baixo, acesso remoto pelo celular, promoções/combos, sugestão de
  compra, múltiplos operadores simultâneos, recibo por WhatsApp, site da loja.
- Automação via WhatsApp (do simples — cobrança Pix automática — até um fluxo completo de pedido
  por WhatsApp com baixa de estoque automática). Ambicioso e fora do escopo combinado hoje, mas o
  cliente topa pagar por isso separadamente no futuro.

## 10. Como continuar

O código-fonte completo (histórico git real) está no computador do cliente/desenvolvedor, pasta
`D:\adega`. Um documento irmão deste, `HANDOFF.md`, é mantido dentro do projeto Claude "adega" com
todo o detalhe técnico (estrutura de arquivos, comandos, histórico de commits, riscos conhecidos de
infraestrutura) — este documento aqui é a versão resumida, pensada pra dar contexto de negócio e
estado geral pra quem (ou qual IA) for coordenar os próximos passos, sem precisar do detalhe de
implementação linha a linha.
