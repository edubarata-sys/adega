# Guia de teste no PC da loja — ambiente de diagnóstico

Este documento tem dois objetivos:

1. Passo a passo pra rodar o ambiente de diagnóstico (pistola, impressora,
   maquininha) no PC real da ADEGA DOIS IRMÃOS e confirmar que ele funciona.
2. Um modelo de relatório no final pra preencher com o que for observado no
   teste físico e mandar de volta — essas são "nossas respostas" pra Torre
   sobre os itens que só um teste real resolve (driver da impressora,
   terminador da pistola, etc.).

Não é preciso Postgres rodando nem internet depois da primeira instalação.
Este teste não grava nada em banco, não faz venda real e não tem valor
fiscal.

---

## 1. Antes de começar (uma vez só)

Precisa estar instalado no PC:

- **Node.js 22 ou mais novo** — baixar em https://nodejs.org/ (versão LTS
  serve). Pra conferir se já está instalado, abra o Prompt de Comando e
  digite `node -v`.
- **pnpm** — se não tiver, o script do passo 2 tenta instalar sozinho. Pra
  conferir, digite `pnpm -v`.

A pasta do projeto (ex.: `D:\adega`) precisa estar completa no PC, com a
página de diagnóstico já incluída (pasta `apps/web/src/DiagnosticoTela.tsx`
e `scripts/iniciar-diagnostico.bat` presentes).

## 2. Rodar o teste

**Caminho mais simples:** dentro da pasta do projeto, entre em `scripts` e
dê duplo-clique em `iniciar-diagnostico.bat`. Ele confere se o Node/pnpm
estão instalados, copia o `.env` de exemplo se ainda não existir, instala as
dependências na primeira vez, sobe o sistema e abre o Chrome sozinho em
`http://localhost:5173/diagnostico` depois de alguns segundos.

**Caminho manual** (se preferir fazer na mão ou o `.bat` der problema):

```
cd D:\adega
copy .env.example .env
pnpm install
pnpm dev
```

Espere aparecer no terminal uma linha `api ouvindo na porta 3000` e outra do
Vite com `Local: http://localhost:5173`. Aí abra no Chrome:

```
http://localhost:5173/diagnostico
```

Se a página abrir com o logo da loja e as três seções (Leitor, Impressora,
Maquininha), o ambiente subiu certo — isso já é a primeira resposta:
**"o sistema roda no PC da loja"** confirmado.

Pra parar, feche a janela do terminal ou aperte `Ctrl+C` nela.

### Se der erro

- **"'pnpm' não é reconhecido..."** — rode `npm install -g pnpm@9.15.4` no
  terminal e tente de novo.
- **`pnpm install` trava ou falha** — precisa de internet nessa etapa
  (só nessa). Confira a conexão do PC.
- **Porta 3000 ou 5173 já em uso** — algum outro programa está usando a
  porta. Feche-o ou reinicie o PC e tente de novo.
- **Página abre em branco ou dá erro no Chrome** — confira se as duas linhas
  (api + Vite) realmente apareceram sem erro vermelho no terminal antes de
  abrir a página.

## 3. O que testar em cada seção

A própria página guia o teste; aqui vai só o que observar pra preencher o
relatório da seção 4.

**Leitor de código de barras** — clique no campo de leitura e passe a
pistola em qualquer produto. A página mostra sozinha se o texto veio rápido
(padrão de pistola) ou devagar (digitado na mão), e se terminou com Enter,
Tab, ou nada. Teste pelo menos 2–3 produtos diferentes.

**Impressora térmica** — a página oferece dois testes independentes:
- **Impressão via driver do Windows**: precisa que a Waytec WP-50 esteja
  instalada como impressora no Windows primeiro (Painel de
  Controle → Dispositivos e Impressoras). Se ainda não estiver instalada,
  instale o driver antes de testar aqui.
- **Impressão via bridge (ESC/POS direto)**: só funciona se o programa
  bridge (`apps/bridge`) estiver rodando à parte no PC. Se não estiver
  rodando, é normal esse teste falhar — não é obrigatório pra este
  diagnóstico, é um caminho alternativo que ainda está em desenvolvimento.

Em qualquer um dos dois, confira se o papel sai com o texto legível, os
acentos (áéíóúãõç) corretos e o corte automático do papel no final.

**Maquininha Itaú** — não há comunicação automática entre a página e a
maquininha (decisão da Torre, mantida de propósito). É um checklist manual:
siga os 4 passos mostrados na tela (ligar, fazer uma venda/transação de
teste de valor baixo, conferir se autoriza e emite comprovante, cancelar/
estornar se possível) e marque cada um.

## 4. Modelo de relatório — respostas para a Torre

Preencher depois do teste físico e devolver esse bloco preenchido.

```
Data do teste: ____/____/______
Testado por: _______________________
PC usado: (caixa da loja / notebook / outro: __________)

AMBIENTE
[ ] Sistema subiu sem erro (pnpm dev, sem linha vermelha no terminal)
[ ] Página /diagnostico abriu no Chrome com o logo e as 3 seções

LEITOR DE CÓDIGO DE BARRAS
Terminador observado:  [ ] Enter   [ ] Tab   [ ] Nenhum   [ ] Variou
Classificado pela página como: [ ] pistola (rápido)  [ ] manual (lento)
Produtos testados: ______________________________
Observações: _____________________________________

IMPRESSORA TÉRMICA (Waytec WP-50)
Driver Windows instalado antes do teste?  [ ] Sim   [ ] Não
  Se sim, nome da impressora no Windows: ________________
  Conexão reconhecida: [ ] USB   [ ] Outra: ______
Teste via driver do Windows:  [ ] Saiu correto  [ ] Saiu com erro  [ ] Não testado
Teste via bridge (ESC/POS direto):  [ ] Saiu correto  [ ] Saiu com erro  [ ] Não testado (bridge não estava rodando)
Acentuação (áéíóúãõç) saiu correta?  [ ] Sim  [ ] Não  [ ] Não testado
Corte automático do papel funcionou?  [ ] Sim  [ ] Não

MAQUININHA ITAÚ / REDE
[ ] Ligou e conectou normalmente
[ ] Transação de teste autorizada
[ ] Comprovante emitido
[ ] Cancelamento/estorno testado (se aplicável)
Observações: _____________________________________

OUTRAS OBSERVAÇÕES LIVRES
___________________________________________________
___________________________________________________
```

Esse bloco preenchido é o retorno físico que a Torre pediu pra fechar os
itens que ainda estavam como `DESCOBRIR_NO_TESTE` (driver da impressora,
terminador do leitor, codepage) na resposta de especificações de hardware.
