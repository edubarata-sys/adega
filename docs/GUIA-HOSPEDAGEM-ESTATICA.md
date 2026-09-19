# Guia — subir a página de diagnóstico num servidor sem Node (FTP)

Este é o caminho pra quando você **não tem acesso pra configurar o
servidor** — só uma conta de FTP num hosting compartilhado (tipo o que
apareceu no FileZilla, `public_html/adega`). Não precisa Node, não precisa
`pnpm`, não precisa rodar nada — é um arquivo só, estático.

Pra rodar direto no PC da loja com o sistema completo (Node/pnpm), use o
outro guia: `docs/GUIA-TESTE-SERVIDOR.md`. Este aqui é só pra hospedar a
página de diagnóstico de hardware sozinha, em qualquer servidor web comum.

## O arquivo

`diagnostico-adega-dois-irmaos.html` — um único arquivo HTML de ~180KB,
com tudo embutido dentro dele (JS, CSS e a logo da loja em base64). Não
tem nenhuma referência a arquivo externo, nenhuma chamada pra API, nenhuma
dependência de servidor. Abrir esse arquivo já é a página inteira
funcionando.

## Como subir

1. No FileZilla, arraste `diagnostico-adega-dois-irmaos.html` pra dentro
   da pasta `public_html/adega` (a que já aparece criada na tela remota).
2. Pronto — não precisa mais nenhum outro arquivo nessa pasta.
3. Acesse pelo navegador no endereço correspondente a essa pasta no seu
   domínio (algo como `https://<seu-domínio>/adega/` ou
   `https://<seu-domínio>/adega/diagnostico-adega-dois-irmaos.html`,
   dependendo de como esse hosting resolve pastas — se a pasta não abrir
   direto, use o nome do arquivo completo na URL).

Se quiser que abra em `.../adega/` sem precisar digitar o nome do arquivo,
renomeie a cópia no servidor pra `index.html` (mantenha o nome original no
seu computador, se quiser guardar).

## O que funciona e o que não funciona hospedado assim

**Funciona igual:** leitor de código de barras (a pistola aparece como
teclado pro navegador, então funciona não importa de onde a página veio) e
o teste A da impressora (abre o diálogo de impressão do Windows,
independente de onde o HTML está hospedado).

**Não funciona hospedado remotamente:** o Teste B da impressora (conexão
com o bridge, `localhost:9100`) só funciona se o navegador estiver rodando
no mesmo PC que tem o bridge instalado — isso é normal e não depende de
onde a página está hospedada, é sobre o que está instalado no PC de quem
abre a página.

## Segurança

Essa página não pede login, não grava nada, não tem valor fiscal — é só um
diagnóstico. Mas como fica num link público (qualquer um que souber a URL
abre), se preferir, dá pra colocar uma senha simples via `.htaccess` nessa
pasta do hosting depois — não é obrigatório pra este teste funcionar.

## Atualizar depois

Se a página de diagnóstico mudar, é só gerar o arquivo de novo (comando
técnico: `pnpm --filter web build:diagnostico`, gera
`apps/web/dist-diagnostico/diagnostico.html`) e substituir o arquivo no
FTP pelo novo.
