# PROJETO — SISTEMA DA ADEGA DO LEANDRO

## 1. Objetivo

Criar um sistema simples, próprio e personalizado para a adega do Leandro, substituindo gradualmente o sistema atual e integrando a operação do caixa com a Laranjinha Itaú/Rede.

A proposta é começar pequeno, mas construir a base corretamente para permitir expansão futura sem precisar refazer o sistema.

---

## 2. Cenário atual

Hoje o Leandro utiliza:

- computador com Windows;
- sistema Nexus;
- leitor de código de barras USB;
- impressora térmica Waytec WP-50;
- impressora compatível com ESC/POS;
- gaveta de dinheiro;
- Laranjinha Smart Itaú/Rede;
- vendas também em dinheiro e Pix.

O sistema atual não está integrado à Laranjinha da forma desejada.

Hoje existe retrabalho no processo de venda e pouco controle centralizado de:

- vendas;
- estoque;
- entradas;
- saídas;
- caixa;
- fechamento;
- informações para a contadora.

Leandro informou que já pagou aproximadamente **R$ 2.000** pelo sistema atual.

---

# 3. FASE 1 — SISTEMA BÁSICO

A primeira fase terá:

## Produtos

- cadastro de produtos;
- código de barras;
- preço de compra;
- preço de venda;
- estoque atual;
- entrada de mercadoria;
- ajuste de estoque.

## Venda

Fluxo desejado:

**Passa a pistola**
→ produto aparece no sistema  
→ sistema calcula a compra  
→ operador clica em receber  
→ valor é enviado para a Laranjinha  
→ cliente paga  
→ Laranjinha confirma o pagamento  
→ venda é marcada como paga  
→ estoque baixa automaticamente  
→ entrada financeira é registrada  
→ comprovante pode ser impresso.

Objetivo principal:

**não precisar registrar a mesma venda duas vezes.**

---

## Caixa

Controle de:

- entradas;
- saídas;
- vendas;
- dinheiro;
- Pix;
- cartão;
- sangria;
- retiradas;
- fechamento diário;
- fechamento mensal.

---

## Estoque

O sistema deverá permitir:

- entrada de produtos;
- baixa automática após venda;
- consulta de estoque;
- histórico de movimentações;
- produtos acabando;
- ajustes manuais com registro.

---

## Relatórios

Relatórios básicos:

- vendas do dia;
- vendas do mês;
- entradas;
- saídas;
- movimentação do caixa;
- vendas por forma de pagamento;
- estoque;
- produtos mais vendidos;
- fechamento diário;
- fechamento mensal.

---

# 4. CONTADORA

O sistema deverá organizar as informações necessárias para o fechamento contábil.

Antes da implementação final dessa parte, será necessário confirmar diretamente com a contadora:

- quais arquivos ela precisa;
- quais relatórios ela utiliza;
- periodicidade;
- formato esperado;
- situação atual da emissão fiscal/XML.

A ideia é deixar o fechamento mensal pronto para envio, evitando levantamento manual de informações.

---

# 5. ACESSO PELA INTERNET

O sistema não ficará preso ao computador da adega.

Leandro e o sócio poderão acessar pelo:

- celular;
- notebook;
- computador;
- qualquer lugar com internet.

Poderão consultar, conforme permissão:

- vendas;
- faturamento;
- caixa;
- estoque;
- entradas;
- saídas;
- movimentações;
- relatórios.

Cada usuário poderá ter seu próprio acesso.

Exemplo:

### Leandro e sócio

Acesso administrativo completo.

### Funcionário do caixa

Acesso somente às funções necessárias para trabalhar.

---

# 6. HARDWARE JÁ IDENTIFICADO

## Leitor de código de barras

Conectado por USB.

A princípio poderá ser reaproveitado diretamente no novo sistema.

## Impressora

**Waytec WP-50**

Características identificadas:

- USB;
- térmica 58 mm;
- compatível com comandos ESC/POS.

Poderá ser utilizada para:

- comprovantes;
- sangrias;
- fechamento;
- recibos;
- relatórios simples.

## Laranjinha

Laranjinha Smart Itaú/Rede.

A integração com a maquininha é uma das partes centrais da primeira fase.

A implementação deverá utilizar o caminho oficial de integração disponibilizado pelo Itaú/Rede.

---

# 7. SISTEMA NEXUS ATUAL

A intenção NÃO é desenvolver uma grande integração com o Nexus.

Estratégia:

1. preservar o sistema atual enquanto o novo estiver sendo construído;
2. tentar exportar o cadastro existente;
3. recuperar produtos, códigos de barras, preços e demais dados úteis;
4. importar esses dados para o novo sistema;
5. testar o novo sistema;
6. somente depois decidir pelo cancelamento definitivo do Nexus.

Antes do cancelamento também deve ser confirmado se algum hardware foi:

- comprado;
- alugado;
- cedido em comodato.

---

# 8. MIGRAÇÃO DE PRODUTOS

Prioridade:

**não recadastrar os produtos manualmente.**

Tentar recuperar do Nexus:

- código interno;
- código de barras/EAN;
- descrição;
- preço;
- custo;
- estoque;
- unidade;
- fornecedor;
- NCM;
- CEST;
- dados tributários disponíveis.

Ordem de tentativa:

1. exportação CSV/Excel pelo próprio Nexus;
2. backup/banco local;
3. solicitação de exportação ao suporte.

---

# 9. IMPLANTAÇÃO

Aproximadamente **99% do trabalho poderá ser feito remotamente**.

Fluxo:

- desenvolvimento remoto;
- disponibilização pela internet;
- Leandro testa no próprio equipamento;
- ajustes são feitos remotamente;
- visita presencial final caso seja necessária.

Na visita poderão ser feitos:

- instalação final;
- configuração dos equipamentos;
- testes da pistola;
- testes da impressora;
- testes do caixa;
- testes da Laranjinha;
- treinamento.

---

# 10. PRAZO

Prazo informado:

**até 15 dias para a primeira fase pronta e testada.**

Pode ser entregue antes.

O prazo possui margem para:

- desenvolvimento;
- integração;
- testes;
- ajustes;
- eventual dependência de liberação externa do Itaú/Rede.

---

# 11. PROPOSTA COMERCIAL PARA O LEANDRO

Valor normal estimado para uma implantação inicial desse porte:

**R$ 4.000 a R$ 5.000**

Para o Leandro será feita uma parceria.

## Condições

### 1. Ferramentas

**R$ 500 iniciais**

Para cobrir ferramentas utilizadas no desenvolvimento.

### 2. Infraestrutura

Hospedagem, servidor, domínio e eventuais serviços externos ficam por conta do Leandro.

Estimativa inicial de hospedagem:

**aproximadamente R$ 30 a R$ 80/mês**, dependendo da estrutura escolhida.

Nenhum serviço adicional será contratado sem aviso.

### 3. Crédito na adega

**R$ 1.500 de crédito**

Para utilização gradual.

O crédito só começa a ser utilizado:

**depois que o sistema estiver entregue, funcionando e testado pelo Leandro.**

### 4. Divulgação

Após o sistema estar funcionando e o cliente satisfeito:

- indicação;
- divulgação;
- autorização para apresentar o trabalho como case, se acordado.

A mão de obra do desenvolvimento inicial não será cobrada separadamente.

---

# 12. PERSONALIZAÇÃO

O sistema será feito especificamente para a adega.

Terá:

- nome da adega;
- logomarca;
- identidade visual;
- estrutura adaptada à operação real do Leandro.

Não será simplesmente um sistema genérico com o nome trocado.

---

# 13. SITE — PRESENTE

Ao fechar o projeto, será desenvolvido também um site simples para a adega sem cobrança de desenvolvimento adicional.

O site poderá conter:

- logomarca;
- identidade visual;
- endereço;
- localização;
- horário;
- WhatsApp;
- redes sociais;
- categorias de produtos;
- bebidas;
- espetinhos;
- chope;
- promoções;
- botão para contato.

O site será personalizado e não baseado apenas em um template genérico igual para vários clientes.

---

# 14. EXPANSÕES FUTURAS

Depois da Fase 1, a base principal já estará construída.

Novos módulos poderão ser adicionados com custo muito menor.

Possibilidades:

## WhatsApp

- catálogo;
- consulta de produtos;
- preços;
- disponibilidade;
- pedidos;
- retirada na loja;
- automação de atendimento.

## Espetinhos

- produtos;
- estoque;
- vendas;
- custos;
- combos.

## Chope

- barris;
- entrada;
- consumo;
- quantidade vendida;
- saldo;
- perdas.

## Clientes

- cadastro;
- histórico;
- frequência;
- preferências;
- relacionamento.

## Compras e fornecedores

- fornecedores;
- pedidos;
- custo;
- histórico;
- reposição.

## Gestão

- estoque mínimo;
- produtos parados;
- produtos mais vendidos;
- margem;
- lucro por produto;
- contas a pagar;
- contas a receber.

## Promoções

- combos;
- descontos;
- campanhas;
- produtos em destaque.

## Entrega

Caso a adega futuramente passe a realizar delivery:

- pedidos;
- endereço;
- taxa;
- status;
- entrega;
- integração com atendimento.

Os módulos futuros poderão ser negociados separadamente, inclusive através de crédito na própria adega.

---

# 15. PRINCÍPIO DO PROJETO

O sistema deve:

**nascer pequeno, simples e rápido de usar, mas não nascer limitado.**

A prioridade da primeira fase é resolver muito bem:

**VENDA  
+ ESTOQUE  
+ CAIXA  
+ LARANJINHA  
+ RELATÓRIOS  
+ CONTADORA**

Depois disso, o sistema cresce conforme as necessidades reais da adega.
