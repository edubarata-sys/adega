# ARQUITETURA — SISTEMA DA ADEGA

Documento técnico. Complementa `projeto-sistema-adega.md` (escopo comercial).

**v2** — revisão após crítica técnica. Correções em §3 (ledger), §3.1 (saldo), §6 (conciliação), §5 (bridge), §1 (hospedagem).

---

## 0. Princípios

1. **Dinheiro é inteiro em centavos.** Nunca float, em lugar nenhum.
2. **Movimento é imutável.** Estoque e caixa são livros-razão append-only, **sem colunas derivadas**.
3. **Soma é comutativa, sequência não é.** Todo valor derivado precisa ser order-independent, porque o sync offline entrega fora de ordem. Isso proíbe qualquer campo do tipo "saldo_apos".
4. **O caixa não para.** Qualquer decisão que faça a venda depender da internet está errada.
5. **Snapshot no momento da venda.** Preço e custo são copiados pro item.
6. **Ambiguidade é estado, não palpite.** Sistema que adivinha em silêncio corrompe dado sem avisar.
7. **Integração externa fica atrás de porta.** Nenhum código de negócio conhece "Rede" ou "Itaú".

---

## 1. Stack

| Camada | Escolha |
|---|---|
| Front (PDV + admin) | React 19 + Vite + TypeScript, PWA |
| Estado local | IndexedDB (via Dexie) |
| API | Node 22 + Fastify + Zod |
| ORM / migrations | Drizzle |
| Banco | PostgreSQL 17 |
| Bridge local | Go (binário único Windows) |
| Infra | 1 VPS, Docker Compose + Caddy |
| Repo | pnpm workspace, monorepo |

```
adega/
  apps/
    web/          React (PDV + admin, mesma SPA, rotas separadas por perfil)
    api/          Fastify
    bridge/       Go — impressora, gaveta, futuro TEF
  packages/
    core/         schemas Zod, tipos, regras de negócio puras
    db/           schema Drizzle + migrations
```

`packages/core` não importa nada de I/O. Cálculo de venda, troco, margem e fechamento vive lá e é testado sem banco.

### Por que não Next.js
Service worker com estratégia offline custom + IndexedDB brigam com o roteamento do App Router. SPA Vite pura é mais previsível pro caso de uso principal.

### Hospedagem
~R$35-50/mês. **Preferência fraca por região BR** — painel admin no celular, drenagem da fila de sync, conforto de LGPD. Não é requisito de latência: a leitura de código de barras resolve contra o IndexedDB local e não toca a rede. Decide preço e disponibilidade.

Postgres no mesmo host, `pg_dump` diário cifrado pra object storage.

**Hipótese:** volume < 500 vendas/dia. 2vCPU/4GB aguenta com folga.

---

## 2. Offline — o núcleo do desenho

- Catálogo espelhado em IndexedDB, revalidado por `updatedAt` (delta sync).
- Venda grava **local primeiro**, sempre. Resposta da API não é pré-requisito.
- `venda.id` é **UUIDv7 gerado no cliente** — chave de idempotência, reenvio nunca duplica.
- Fila com retry exponencial, estado visível na UI ("3 vendas pendentes").
- Estoque tolera negativo temporário.
- Sync é **push-only** pra vendas, **pull** pra catálogo/preço.

### Consequências de chegada fora de ordem (tratadas explicitamente)

| Efeito | Tratamento |
|---|---|
| Saldo de estoque | Contador comutativo, ver §3.1. Imune |
| `venda.numero` | Atribuído na chegada, **não é cronológico**. Documentado. Vira restrição real se houver NFC-e |
| Venda que sobe após fechamento do caixa | Sessão fechada **nunca** tem número alterado em silêncio: marca `tem_ajuste_posterior`, grava delta no audit, alerta o admin |

### 2.1 Trava de fechamento e premissa de terminal unico

**PREMISSA DA FASE 1: UM UNICO TERMINAL DE PDV.**

O fechamento e a operacao que converte o ledger em numero contabil. Ele **recusa**
enquanto houver venda pendente na fila local do dispositivo:

- a UI bloqueia o botao e mostra quantas vendas faltam subir;
- a API rejeita fechamento quando o cliente informa `fila_pendente > 0`;
- nao existe "fechar por cima". A saida e aguardar a internet ou cancelar as
  vendas pendentes explicitamente, com registro no audit.

Fechar com fila pendente calcularia `valor_esperado` sem vendas que existem:
gera diferenca fantasma e, pior, mascara divergencia real de caixa.

**Fora de escopo nesta fase:** fechamento sincronizado multi-terminal. Com dois ou
mais PDVs a trava deixa de ser local e vira consenso distribuido -- nenhum terminal
sabe sozinho se os outros tem fila pendente. Isso exige desenho proprio e nao sera
inventado agora. Enquanto for um terminal, a fila local e informacao completa.

A trava **nao** dispensa `tem_ajuste_posterior` (§2): cancelamento de venda, ajuste
retroativo de estoque e correcao administrativa continuam podendo tocar uma sessao
ja fechada.

### O que NÃO funciona offline (aceito)
Relatórios, cadastro, entrada de mercadoria, fechamento. Tudo admin.

### Descartado
Servidor local no PC com réplica bidirecional. Duas fontes de verdade não cabem no prazo.

---

## 3. Modelo de dados (Fase 1)

`id` UUIDv7. Dinheiro `bigint` em centavos. Timestamp `timestamptz` UTC (exibição em America/Sao_Paulo).

### produtos
```
id, codigo_interno, ean (unique, nullable), descricao, descricao_pdv,
unidade ('UN'|'KG'|'L'), categoria_id, preco_venda, custo_medio,
estoque_minimo, ativo, criado_em, atualizado_em,
-- fiscais, nulos na Fase 1:
ncm, cest, cfop, cst_csosn, origem
```
`ean` nullable (granel). Busca por descrição com índice `pg_trgm`.

### estoque_movimentos — append-only, sem derivadas
```
id, produto_id, tipo ('entrada'|'venda'|'ajuste'|'perda'|'devolucao'),
quantidade (signed), custo_unitario,
origem_tipo, origem_id, usuario_id, observacao,
ocorrido_em, registrado_em
```
`ocorrido_em` = quando aconteceu no balcão (relógio do cliente). `registrado_em` = quando chegou no servidor. Os dois são necessários e **não** são o mesmo dado.

**Não existe `saldo_apos`.** Era incompatível com sync fora de ordem: uma venda antiga chegando exigiria reescrever toda linha posterior, mutando um ledger que se declara imutável.

Ajuste manual **exige** `observacao` — é a diferença entre inventário e desvio.

### 3.1 estoque_saldos — cache, não verdade
```
produto_id (PK), quantidade, versao, atualizado_em
```
Atualizado **na mesma transação** do insert do movimento, em código no repositório:
```sql
INSERT INTO estoque_saldos (produto_id, quantidade) VALUES ($1, $2)
ON CONFLICT (produto_id) DO UPDATE
  SET quantidade = estoque_saldos.quantidade + EXCLUDED.quantidade,
      versao = estoque_saldos.versao + 1,
      atualizado_em = now();
```
Order-independent (soma), e o row lock do `UPDATE` serializa concorrência sem read-modify-write em memória.

**Invariante, verificado por job noturno:**
`SUM(estoque_movimentos.quantidade) == estoque_saldos.quantidade`, por produto.
Divergiu → o ledger ganha, o cache é reconstruído, alerta é emitido.

**Descartado: materialized view por trigger.** Postgres não tem matview incremental — `REFRESH` é recompute total com lock (mesmo `CONCURRENTLY` faz full scan). Por trigger a cada venda é inviável. E trigger esconde regra de negócio do app e não compartilha caminho com o sync.

Saldo histórico point-in-time vem de query no ledger por `ocorrido_em`, ou de `estoque_snapshots` fechados por data — **recomputados com cutoff, nunca incrementais**. Movimento que chega depois do cutoff marca o snapshot como revisado.

### vendas
```
id (do cliente), numero (atribuído na chegada), sessao_caixa_id, usuario_id,
status ('aberta'|'paga'|'cancelada'), subtotal, desconto, total,
ocorrido_em, registrado_em, cancelada_em, cancelada_por, motivo_cancelamento
```
Venda **nunca é deletada**. Cancelamento é status + movimento de estoque reverso.

### venda_itens
```
id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario,
desconto_item, total_item
```
Preço e custo são cópia, não FK de leitura.

### pagamentos
```
id, venda_id, forma ('dinheiro'|'pix'|'debito'|'credito'|'voucher'),
valor, troco, criado_em,
conciliacao_status ('pendente'|'conciliado'|'ambiguo'|'divergente'|'ignorado'),
conciliacao_item_id, conciliado_em, conciliado_por,
-- porta de integração, nulos na Fase 1:
adquirente, nsu, autorizacao, bandeira, parcelas
```
**N pagamentos por venda.** Venda dividida é rotina em adega; modelar 1:1 obriga o operador a mentir e corrompe o relatório por forma de pagamento na origem.

### caixa_sessoes
```
id, usuario_abertura_id, aberto_em, fundo_troco,
usuario_fechamento_id, fechado_em, valor_contado, valor_esperado,
diferenca, tem_ajuste_posterior, observacao
```

### caixa_movimentos — append-only
```
id, sessao_id, tipo ('sangria'|'suprimento'|'despesa'|'entrada_avulsa'),
valor, descricao, usuario_id, criado_em
```

### usuarios
```
id, nome, email, senha_hash (argon2id), pin_hash, perfil ('admin'|'caixa'),
ativo, ultimo_acesso
```

### audit_log
```
id, usuario_id, acao, entidade, entidade_id, dados_antes, dados_depois, ip, criado_em
```
Grava cancelamento, ajuste de estoque, mudança de preço, sangria, fechamento com diferença, ajuste posterior em sessão fechada, resolução manual de conciliação. Não grava venda normal — volume alto e já auditável pelo ledger.

---

## 4. Autenticação

- **Admin:** e-mail + senha (argon2id), cookie httpOnly SameSite=Lax, 30 dias.
- **Caixa:** PIN de 6 dígitos sobre dispositivo já autorizado. Troca de turno em 2 segundos — exigir e-mail e senha no balcão garante senha em post-it no monitor.
- Dispositivo do PDV registrado uma vez pelo admin, token de longa duração. Vendas offline assinadas com ele.
- Dois perfis: `admin` e `caixa`. Permissão granular é armadilha de escopo.

---

## 5. Bridge local (Windows)

Binário Go único, autostart, `127.0.0.1:9100`, CORS restrito à origem do sistema.

```
POST /print    { tipo: 'cupom'|'sangria'|'fechamento', payload }
POST /drawer   {}                      → ESC p 0 25 250
GET  /health   → { versao, impressora: 'ok'|'offline' }
```

ESC/POS cru na Waytec WP-50 (58mm, 32 col). O front monta o layout, o bridge transmite bytes.

**Por que Go:** binário único, sem runtime na máquina do cliente. É o mesmo processo que hospeda TEF na Fase 2 (SiTef e PayGo são DLL/serviço local Windows, só alcançáveis por um agente assim).

### 5.1 SPIKE OBRIGATÓRIO — dia 1, antes de qualquer código de produto

**Página HTTPS chamando `http://localhost` não é pressuposto seguro.** `localhost` é *potentially trustworthy origin* pela spec de Secure Contexts (logo, não é mixed content), **mas** o Chrome aplica **Private Network Access**: preflight com `Access-Control-Request-Private-Network`, resposta precisa de `Access-Control-Allow-Private-Network: true`. O comportamento muda entre versões do Chrome.

Teste, timebox 3h, **na máquina e no Chrome do Leandro**: página HTTPS no domínio real + stub Go respondendo `/health`. Binário: passa ou não passa.

**Cascata de fallback, em ordem:**
1. Cert real para domínio que resolve `127.0.0.1`, embarcado no binário (padrão Plex). Custo: renovação.
2. Self-signed no trust store do Windows, instalado pelo instalador.
3. **Bridge com conexão de saída** — conecta no servidor e recebe job de impressão por push. Elimina o problema inteiro, mas mata impressão offline. Vira híbrido: localhost primeiro, push como degradação.
4. `window.print()` com `@page 58mm`. Perde gaveta, não perde venda.

### Pistola
HID, emula teclado. Zero driver: listener global + heurística de tempo entre teclas (< 30ms = leitura) + Enter como terminador. Busca contra IndexedDB local, sem rede no caminho. Campo sempre com foco no PDV.

---

## 6. Pagamento e conciliação

```ts
interface PaymentAdapter {
  charge(input: { vendaId: string; valorCentavos: number; forma: FormaPagamento })
    : Promise<PaymentResult>
  status(ref: string): Promise<PaymentResult>
}
```

**Fase 1 — `ManualAdapter`:** operador cobra na Laranjinha, confirma na tela, sistema registra forma + valor.

### 6.1 Conciliação — estado explícito, jamais auto-match por heurística

```
conciliacao_lotes   id, arquivo, periodo, importado_em, importado_por
conciliacao_itens   id, lote_id, linha_bruta (jsonb, IMUTÁVEL),
                    valor, ocorrido_em, nsu, bandeira, status
```

Regra de casamento, por prioridade:
1. **NSU exato** (só a partir da Fase 2) → `conciliado`
2. **Valor + janela temporal, candidato ÚNICO** → `conciliado`
3. **Dois ou mais candidatos** → `ambiguo` → fila de resolução humana
4. **Linha da Rede sem contraparte** → `divergente`
5. **Pagamento sem linha da Rede** → `divergente`

**Match nunca é palpite.** Dois clientes pagando R$50 no mesmo minuto é rotina em adega; casar por proximidade seria sorteio, e match errado silencioso é pior que nenhum — corrompe a conferência sem sinalizar.

`divergente` no sentido "passou na maquininha e nunca virou venda" é o achado mais valioso do módulo: é sinal de desvio, não de bug.

Linha bruta importada é **imutável**. Resolução manual grava decisão + usuário + timestamp no audit, nunca edita a origem.

**Expectativa honesta da Fase 1:** sem NSU, `ambiguo` é o caso comum, não a exceção. A fila de resolução é o produto, não o defeito. Com NSU na Fase 2, o match vira exato e a fila esvazia.

### 6.2 Fase 2 — trocar implementação, não sistema
1. TEF homologado (SiTef/PayGo/Connect) — real, exige PinPad separado + mensalidade
2. App-to-app embarcado na Laranjinha — melhor UX, gargalo é credenciamento de parceiro
3. Link/QR via API — sem homologação, mas taxa de cartão não presente é mais cara

**DEPENDÊNCIA REAL:** não há API pública da Rede/Itaú pra maquininha física. Confirmar caminho oficial direto com a Rede (4001-4433). Corre em paralelo, não bloqueia a Fase 1.

---

## 7. Migração do Nexus

**Começa no dia 1.** Única dependência com terceiro no caminho crítico.

1. Exportação nativa (CSV/Excel) pelo próprio Nexus
2. Acesso ao banco local — **hipótese:** Firebird ou SQL Server Express, típico de PDV brasileiro desse porte. Confirmar em `Program Files` e nos serviços do Windows
3. Chamado formal ao suporte pedindo dump (LGPD ajuda: o dado é do Leandro)

Importador com **staging + dry-run**: sobe pra tabela temporária, mostra relatório (X produtos, Y sem EAN, Z com preço zerado, W duplicados), só então confirma.

---

## 8. Fases

| Dias | Entrega | Pronto quando |
|---|---|---|
| 1 | **Spike do bridge (§5.1)** + extração Nexus iniciada + repo + deploy + CI | Veredito binário do spike; deploy automático de pé |
| 2-3 | Banco, auth, layout, usuários | Admin loga, cria operador |
| 4-6 | Produtos, categorias, entrada, importador | Catálogo do Nexus dentro, conferido |
| 7-10 | **PDV**: venda, múltiplos pagamentos, offline, impressão, gaveta | Venda completa com internet desligada, sincroniza ao religar |
| 11-12 | Caixa: abertura, sangria, suprimento, fechamento cego | Fechamento bate com dinheiro contado |
| 13 | Relatórios + acesso mobile + conciliação | Leandro abre no celular e vê o dia |
| 14-15 | Operação real em paralelo ao Nexus, treinamento, ajustes | Um dia inteiro de vendas reais sem intervenção |

**Fechamento cego:** o operador digita o que contou *antes* de ver o esperado. Mostrar o esperado primeiro não detecta desvio nenhum.

---

## 9. Virada

- Rodar **em paralelo ao Nexus por no mínimo 7 dias**.
- Não cancelar antes de um fechamento mensal completo no sistema novo.
- Confirmar se algum hardware é comodato/aluguel.
- Backup do banco do Nexus guardado, independente de tudo.

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo inchando durante o desenvolvimento | **Alto** | Fase 1 é venda+estoque+caixa+relatório. Todo pedido novo vai pra Fase 2, sem exceção |
| Integração Laranjinha travada por credenciamento | Alto | Adapter manual + conciliação. Prazo não depende disso |
| Dados do Nexus inacessíveis | Alto | 3 caminhos em paralelo desde o dia 1. Pior caso: ~200 itens de maior giro na mão, resto conforme vende |
| PWA HTTPS não alcança bridge localhost | Médio | Spike no dia 1, 4 fallbacks mapeados (§5.1) |
| Waytec com ESC/POS não-padrão | Baixo | Fallback `window.print()`. Testar cedo |
| Internet instável | Baixo | Resolvido por desenho |

---

## 11. Fiscal

Fora do escopo da Fase 1, **modelado desde já**. Campos fiscais existem e ficam nulos.

Restrição herdada do offline: `venda.numero` não é cronológico. Se houver NFC-e, numeração fiscal precisa de sequência própria atribuída na emissão, nunca reaproveitando `numero`.

**Dependência:** confirmar com a contadora (a) se a adega emite cupom fiscal hoje, (b) o que ela recebe e em que formato. Única pergunta capaz de invalidar parte do desenho — fazer na primeira semana.
