# Bridge -- stub do spike (dia 1)

Este binario responde SOMENTE `GET /health`. Nao imprime nada, nao fala com
a gaveta, nao e o bridge de producao. Existe para responder uma pergunta
binaria da arquitetura (secao 5.1):

> Uma pagina HTTPS real, no Chrome real do cliente, consegue chamar
> `http://127.0.0.1:9100/health`?

## Status atual: PARCIALMENTE VALIDADO

**Validado** (protocolo, via curl, nesta maquina): o servidor responde a
requisicao GET com o JSON esperado, e responde ao preflight OPTIONS com
`204` e os headers `Access-Control-Allow-Origin`,
`Access-Control-Allow-Private-Network: true` e
`Access-Control-Allow-Methods`. O log do processo mostra explicitamente
o que cada requisicao recebeu (origin, `Access-Control-Request-Private-Network`,
`Access-Control-Request-Method`) -- isso e o que da o diagnostico de "em
qual camada falhou" se algo der errado depois.

**NAO validado**: o comportamento real do Chrome contra a politica de
Private Network Access. curl nao aplica essa politica -- so um navegador
de verdade aplica. Essa parte da pergunta continua em aberto.

**Por que nao foi validado nesta sessao**: a maquina do Leandro nunca
esteve conectada a esta sessao (que roda no computador de quem esta
desenvolvendo). Rodar o teste de verdade exige acesso fisico (ou remoto)
a uma maquina Windows com Chrome -- idealmente ja a maquina real da adega,
para que o resultado valha tambem para o hardware e a rede de la.

## Como rodar o spike manualmente

1. **Compilar** (ou usar o binario ja compilado, se existir em `bin/` --
   esse diretorio nao vai para o git, e binario de plataforma):
   ```
   GOOS=windows GOARCH=amd64 go build -o bin/bridge-windows-amd64.exe .
   ```
2. **Copiar `bin/bridge-windows-amd64.exe` para a maquina alvo** (a da
   adega, ou por enquanto qualquer Windows com Chrome real) e executar.
   Uma janela de console vai mostrar `bridge (spike) ouvindo em
   http://127.0.0.1:9100/health`. Deixar essa janela aberta.
3. **Servir `spike-test.html` por HTTPS real** -- nao abrir como arquivo
   local (`file://`). Qualquer host HTTPS estatico serve para este teste
   pontual (o proprio deploy do app quando existir, ou qualquer static
   host temporario). O ponto e a pagina estar em `https://`, nao em
   `file://` nem `http://`.
4. Abrir essa URL no Chrome real da maquina, clicar em **"Testar bridge
   agora"**.
5. A pagina mostra **PASSA** ou **FALHA** diretamente. Se **FALHA**, abrir
   o DevTools (F12) -> Console ANTES de testar de novo: o Chrome imprime
   ali a frase exata da politica que bloqueou -- informacao que o
   JavaScript da pagina nao consegue ler por design de seguranca do
   proprio navegador.
6. **Registrar o resultado** (PASSA/FALHA + a frase exata do Console, se
   houver) de volta em `arquitetura.md` secao 5.1 e neste README, antes de
   decidir qual dos 4 fallbacks (se algum) entra em jogo. Nao pular direto
   para implementar um fallback sem esse veredito -- e exatamente o que a
   arquitetura pede para evitar.

## Ambiente de desenvolvimento usado nesta sessao

Go 1.18.1, obtido via `apt-get download golang-go` (sem privilegio de
root disponivel no ambiente; download de pacote `.deb` nao exige root,
so a instalacao via `apt-get install` exige). Suficiente para este stub;
nao ha uso de nenhum recurso de versao mais recente do Go. Se o ambiente
de producao tiver uma versao mais nova disponivel, nao ha necessidade de
fixar em 1.18 especificamente -- so documentando o que foi realmente
testado aqui.
