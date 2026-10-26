# PDV Restaurante — Parte 3 (Escopo Lanchonete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o sistema de lanchonete do novo texto de requisitos sobre o projeto Node/Electron existente: cardápio de pratos e bebidas com estoque, clientes, pedido com fluxo de status e histórico, tela da cozinha (tablet), WhatsApp automático, relatórios PDF/Excel, título com versão e crédito "Desenvolvido por Kaio Gomes".

**Architecture:** Mesma arquitetura em camadas (domain → application → infrastructure → presentation, ligação só em `src/compositionRoot.js`), SPA em JS puro, SQLite com migrações. Integrações atrás de portas com implementação simulada para testes.

**Tech Stack:** Node ≥ 22.13, `node:sqlite`, Electron, `whatsapp-web.js`, `exceljs`, `pdfkit`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-26-lanchonete-design.md` (fonte de verdade deste plano; vence `docs/` onde divergir). Contexto herdado: `docs/` e o plano `2026-10-23-...parte-1...` (Tarefas 1–12 já implementadas e na branch; Tarefas 13–14 da Parte 1 e todo o plano da Parte 2 estão **supersedidos** por este).

**Estado inicial:** branch `feat/escopo-lanchonete`, criada de `ef0d0d3`. Já existem: autenticação A/B/C, auditoria, configurações, HTTP + SSE, shell Electron + backup, cardápio (categorias, ingredientes, pratos, `/api/cardapio`), mesas (CRUD), domínio e serviço de pedido do escopo antigo (comanda/rodadas), API de pedidos antiga, CSV. Leia o código antes de alterar; `git show 54844cc` guarda o estado do escopo antigo.

## Global Constraints

- Node.js `>=22.13`; `node:sqlite`; testes `node --test` (`npm test`); CommonJS no back, ES modules em `public/js`. Uma classe por arquivo; arquivos < 500 linhas; validar entrada nas fronteiras; textos e erros em português do Brasil.
- Dinheiro em centavos inteiros (`*_cents`); datas ISO 8601 UTC; datas locais `AAAA-MM-DD` pelo mesmo helper de data local já usado em `data_local`. Valores sempre recalculados no servidor.
- Níveis: `A` Administrador, `B` Atendente, `C` Cozinha. Matriz de permissões do §5 do spec. Servidor da janela só em `127.0.0.1`; o listener da rede local (Tarefa 17) tem lista fechada de rotas e só aceita login de nível C.
- Status do pedido: `ABERTO, RECEBIDO, EM_PREPARO, PRONTO_RETIRADA, PRONTO_ENTREGA, FINALIZADO, CANCELADO`. Estoque de bebida nunca negativo. Toda mudança de status grava `pedido_status_historico` (anterior, novo, usuário, instante) na mesma transação.
- Mensagens de WhatsApp (texto exato, `{nome}` = primeiro nome): retirada `Olá, {nome}!\n\nSeu pedido nº {numero} está pronto para retirada.\n\nAgradecemos a preferência.` · entrega `Olá, {nome}!\n\nSeu pedido nº {numero} foi finalizado e está pronto para entrega.\n\nAgradecemos a preferência.`
- Crédito: texto `Desenvolvido por Kaio Gomes` como link para `https://kaio-gomes-site.vercel.app/` (`target="_blank" rel="noopener noreferrer"`), em todas as telas. Título da janela: `PDV Restaurante — v{versão do package.json}`.
- Tokens de cor azul-escuro já em `public/style.css` (`--brand:#1e3a8a`, `--side:#0b1f44`); alvos de toque ≥ 40 px; todo texto de servidor passa por `esc()`.
- Limites: observação do item 140 caracteres; motivo 200; foto 300 KB; telefone E.164 `+55DDDNÚMERO`.
- Migrações 2 e 4 podem ser editadas no lugar (nada liberado); tabelas novas na migração 5; bancos de desenvolvimento antigos são apagados. `docs/banco-de-dados.md` é atualizado na Tarefa 20.
- Commits sem trailer `Co-Authored-By`. `npm test` verde e com saída limpa antes de cada commit.

## Review Focus

1. Estoque nunca fica negativo nem some: confirmar o mesmo pedido duas vezes, confirmar vários pedidos até zerar, reabrir/cancelar estornam exatamente o baixado (Tarefas 2, 5).
2. Telefones digitados como `(11) 99999-8888`, `+55 11 99999-8888`, `011999998888`, `99998888`, `abc` e vazio: normalizados ou recusados com mensagem clara; o mesmo cliente não duplica (Tarefa 3).
3. Falha do WhatsApp (offline, número sem WhatsApp, timeout) nunca reverte nem trava a mudança de status, e fica registrada e visível (Tarefas 7–8).
4. Relatórios: pedidos cancelados e rascunhos fora do faturamento; virada de dia/mês no fuso local; período vazio devolve tabela vazia, não erro (Tarefa 10).
5. Exportações: células de texto começando com `= + - @` neutralizadas no Excel; nomes com acento/emoji não quebram PDF nem Excel (Tarefa 11).

---

### Task 1: Ingredientes e pratos adaptados + migração 5

**Files:**
- Modify: `src/infrastructure/database/migrations.js` (migração 2: `ingredientes.unidade_medida TEXT NOT NULL`, `ingredientes.observacao TEXT`, `pratos.tempo_preparo_min INTEGER NOT NULL CHECK (tempo_preparo_min > 0)`; **nova migração 5** com `clientes`, `bebidas`, `movimentacoes_estoque`, `pedido_status_historico`, `notificacoes_whatsapp` conforme o DER do spec §3, com os `CHECK`s e índices necessários)
- Modify: `src/domain/cardapio/{validators,pratoValidator}.js`, `PratoService`, `PratoRepository`, `CadastroService` (ingredientes), controladores, `test/{database,cardapio-cadastros,pratos}.test.js`

**Interfaces:**
- Produces: `UNIDADES = ['UN','G','KG','ML','L','COLHER','FATIA','PORCAO']` (exportada de `validators.js`); ingrediente API `{ nome, unidadeMedida, observacao, precoAdicionalCents, podeSerAdicional, ativo }`; prato API ganha `tempoPreparoMin`; `/api/cardapio` pratos trazem `tempoPreparoMin`.

- [ ] **Step 1: Testes** (ajustar os existentes e acrescentar): `unidade de medida inválida → 400`; `unidade ausente → 400`; `observação com 201 caracteres → 400`; `prato sem tempo de preparo ou com 0/-1/1.5 → 400`; `prato sem ingredientes → 400 "O prato precisa de pelo menos um ingrediente"` (criar e atualizar); `atualizar prato removendo todos os ingredientes → 400`; `ativar/inativar prato por PUT {ativo}` mantém a lista; `database.test.js`: `user_version` 5 e as 5 tabelas novas com seus CHECKs (`movimentacoes_estoque.tipo`, `notificacoes_whatsapp.situacao`, `pedido_status_historico` sem UPDATE/DELETE se o DER do spec assim definir — não definir gatilhos além do especificado).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** migrações e regras (editar migração 2 no lugar; migração 5 nova). Atualizar fixtures de teste que criam pratos/ingredientes.
- [ ] **Step 4: Rodar** `npm test` → PASS. **Step 5: Commit** `feat: ingredientes com unidade, pratos com tempo e migração 5`.

### Task 2: Bebidas e controle de estoque

**Files:**
- Create: `src/domain/estoque/movimentos.js`, `src/infrastructure/repositories/{BebidaRepository,MovimentacaoRepository}.js`, `src/application/{BebidaService,EstoqueService}.js`, `src/presentation/http/controllers/{BebidaController,EstoqueController}.js`, `test/bebidas.test.js`, `test/estoque.test.js`
- Modify: `src/compositionRoot.js`

**Interfaces:**
- Produces:
  - API: `GET/POST /api/bebidas`, `PUT/DELETE /api/bebidas/:id` (escrita só A; leitura A e B), bebida `{ id, nome, precoCents, estoqueQtd, estoqueMinimo, ativo, critico }` (`critico = estoqueQtd <= estoqueMinimo`); `POST /api/bebidas/:id/movimentacoes` `{ tipo: 'ENTRADA'|'SAIDA'|'AJUSTE', quantidade | novaQuantidade, motivo }` (A); `GET /api/bebidas/:id/movimentacoes?limite=` ; `GET /api/estoque/critico`.
  - `EstoqueService.baixarParaPedido(user, pedidoId, itens: [{ bebidaId, quantidade }])` e `estornarPedido(user, pedidoId)` — **sem abrir transação própria** (rodam dentro da transação do chamador); `baixa` lança `ConflictError` listando `{ bebida, saldo, pedido }` de cada bebida insuficiente.
  - Evento `estoque` `{ bebidaId, estoqueQtd, critico }` publicado pelo chamador após o commit (o serviço devolve a lista de eventos).

- [ ] **Step 1: Testes**: criar bebida com estoque inicial 10 gera movimento `ENTRADA` "Estoque inicial" e `saldo_apos 10`; `PUT` com `estoqueQtd` no corpo → 400 "use uma movimentação"; entrada 5 → saldo 15; saída 20 com saldo 15 → 409 e saldo continua 15; ajuste para 7 grava delta `-8` e `saldo_apos 7`; saída/ajuste sem motivo → 400; `baixarParaPedido` com `UPDATE … WHERE estoque_qtd >= ?` (3 baixas de 4 num saldo de 10: terceira falha e saldo = 2, sem negativo); `estornarPedido` devolve exatamente as quantidades baixadas pelo pedido (movimentos `VENDA` → `ESTORNO`), e estornar duas vezes devolve só uma; bebida inativa não pode ser baixada; `critico` quando saldo ≤ mínimo; excluir bebida com movimentos além do inicial ou usada em pedido → 409 "Em uso" (desativar); nome duplicado sem acento → 409; B lê e não escreve (403); C → 403; auditoria de toda movimentação.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** (`nome_norm`, transação por operação de estoque avulsa; usa `ehViolacaoDeChave`). **Step 4:** PASS. **Step 5: Commit** `feat: bebidas e controle de estoque`.

### Task 3: Telefone e clientes

**Files:**
- Create: `src/domain/phone.js`, `src/infrastructure/repositories/ClienteRepository.js`, `src/application/ClienteService.js`, `test/phone.test.js`, `test/clientes.test.js`
- Modify: `src/compositionRoot.js`

**Interfaces:**
- Produces: `normalizarTelefone(texto) → '+55DDDNÚMERO'` (lança `ValidationError`); `ClienteService.registrar({ nome, telefone }) → Cliente` (idempotente por telefone; nome diferente atualiza o nome do cadastro e `atualizado_em`); `ClienteService.buscar({ q }) → Cliente[]` (nome sem acento/maiúsculas ou dígitos do telefone); `Cliente = { id, nome, telefone, criadoEm }`.

- [ ] **Step 1: Testes** `phone.test.js`: `"(11) 99999-8888"`, `"+55 11 99999-8888"`, `"11999998888"`, `"011999998888"`, `"+5511999998888"` → `"+5511999998888"`; fixo `"(11) 3333-4444"` → `"+551133334444"`; `"99998888"` (sem DDD), `"123"`, `"abc"`, `""`, DDD inexistente `"(00) 99999-8888"`, 14+ dígitos → `ValidationError`. `clientes.test.js`: registrar duas vezes o mesmo telefone → um cliente; nome novo atualiza; nome vazio ou > 80 caracteres → 400; buscar por parte do nome com acento e por `"99999"`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4:** PASS. **Step 5: Commit** `feat: telefone normalizado e cadastro de clientes`.

### Task 4: Domínio do pedido (status, permissões, estimativa)

**Files:**
- Create: `src/domain/pedido/{status,estimativa}.js`, `test/pedido-status.test.js`
- Modify: `src/domain/pedido/ItemValidator.js` (aceitar `tipo: 'BEBIDA'`), `test/pedido-domain.test.js`

**Interfaces:**
- Produces: `STATUS`; `podeTransitar(de, para) → boolean` (matriz do spec §4, incluindo `RECEBIDO→ABERTO` e `PRONTO_*→EM_PREPARO`; nada sai de `CANCELADO`/`FINALIZADO`); `podeMudarStatus(nivel, de, para) → boolean` (matriz do spec §5: `C` só `RECEBIDO→EM_PREPARO`, `EM_PREPARO→PRONTO_*`, `PRONTO_*→FINALIZADO`, `PRONTO_*→EM_PREPARO`; `B` também `ABERTO→RECEBIDO`, `RECEBIDO→ABERTO`, cancelamentos e `PRONTO_*→FINALIZADO`; `A` todas as válidas); `estimarPreparo(itens: [{ tipo, tempoPreparoMin }], modo = 'MAXIMO') → minutos` (`SOMA` soma por unidade × quantidade só de pratos; bebidas valem 0; lista vazia → 0); `validarItem` com bebida: `{ tipo:'BEBIDA', itemId, quantidade, observacao }` não aceita `remover`/`adicionar`.

- [ ] **Step 1: Testes** (valores exatos): matriz completa de `podeTransitar` (cada par possível = esperado); `podeMudarStatus('C','RECEBIDO','CANCELADO') = false`, `('C','EM_PREPARO','PRONTO_ENTREGA') = true`, `('B','PRONTO_RETIRADA','FINALIZADO') = true`, `('B','RECEBIDO','EM_PREPARO') = false`; chaves de protótipo (`'__proto__'`, `'constructor'`) → falso; `estimarPreparo` com pratos de 15 e 25 min → 25 (MAXIMO) e 40 (SOMA com quantidade 1 cada) e `2 × 15 + 25 = 55` (SOMA com quantidade 2); só bebidas → 0; bebida com `remover` → erro.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4:** PASS. **Step 5: Commit** `feat: domínio de status e estimativa de preparo`.

### Task 5: Pedido — refatoração do serviço (migração 4)

**Files:**
- Modify: `src/infrastructure/database/migrations.js` (migração 4 no lugar, conforme spec §3), `src/infrastructure/repositories/PedidoRepository.js`, `src/application/{PedidoService,MontadorDeItens}.js`, `src/infrastructure/repositories/MesaRepository.js` e `MesaService.js` (remover `pedidoAberto`), `src/compositionRoot.js`, `test/pedido-service.test.js`, `test/api-pedidos.test.js` (adaptar o que depender do serviço), `test/mesas.test.js`
- Remover do serviço (voltam na fase de mesas, estão no commit `54844cc`): comanda de mesa, rodadas/`enviarCozinha`, `cancelarItem`, `mover`, `aplicarDesconto`, `finalizar`.

**Interfaces:**
- Consumes: `EstoqueService` (Tarefa 2), `ClienteService` (Tarefa 3), `status.js`/`estimativa.js` (Tarefa 4), `ConfigService`, `AuditTrail`, `EventBus`.
- Produces (`PedidoService`, `user` sempre primeiro):
  - `criarRascunho(user, { cliente?: { nome, telefone }, itens: ItemInput[], observacao? }) → Pedido` · `atualizarRascunho(user, id, mesmos campos)` · `confirmar(user, id) → Pedido` · `reabrir(user, id) → Pedido` · `cancelar(user, id, motivo) → Pedido` · `mudarStatus(user, id, status) → Pedido` · `listar(filtros) → Pedido[]` (por `id` crescente) · `obter(id) → Pedido` · `listarCozinha() → Pedido[]` (RECEBIDO/EM_PREPARO/PRONTO_*, `confirmado_em` crescente).
  - `ItemInput = { tipo: 'PRATO'|'BEBIDA', itemId, quantidade, observacao?, remover?: number[], adicionar?: [{ ingredienteId, quantidade }] }`.
  - `Pedido = { id /* número */, status, cliente: { id, nome, telefone }|null, itens: [{ id, tipo, itemId, nome, precoUnitCents, adicionaisCents, quantidade, totalCents, observacao, tempoPreparoMin, modificacoes }], subtotalCents, totalCents, quantidadeTotal, tempoEstimadoMin, observacao, criadoEm, confirmadoEm, criadoPor, historico: [{ de, para, usuario, em }] }`.
  - Porta de pós-commit: o construtor recebe `aposMudarStatus(pedido, user) → void` (padrão no-op; a Tarefa 7 liga o WhatsApp).
  - Eventos `pedido` `{ id, status }` e `estoque` publicados **depois** do commit.

- [ ] **Step 1: Testes** (reescrever `pedido-service.test.js`; nomes exatos): `confirmar sem nome ou sem telefone do cliente → 400`; `confirmar sem itens → 400`; `confirmar baixa o estoque das bebidas e grava VENDA com o pedido`; `confirmar com bebida acima do saldo → 409 listando a bebida, estoque e status intactos`; `confirmar duas vezes o mesmo pedido → 409 e estoque baixado uma vez`; `10 pedidos de 3 unidades num estoque de 25: 8 passam, o 9º falha, saldo final 1, nunca negativo`; `reabrir estorna o estoque e volta a ABERTO`; `cancelar RECEBIDO estorna; cancelar ABERTO não mexe no estoque; cancelar FINALIZADO → 409`; `cancelar exige motivo 1–200`; `mudarStatus grava histórico (anterior, novo, usuário, instante) na mesma transação; falha forçada no histórico reverte o status`; `mudarStatus inválido (RECEBIDO→FINALIZADO) → 409`; `nível C não confirma/cancela/reabre (403) e muda RECEBIDO→EM_PREPARO`; `tempoEstimadoMin = máximo dos pratos` e `SOMA` com `cozinha.estimativa`; `quantidadeTotal soma as quantidades`; `preço do cliente ignorado e retrato mantido ao mudar o preço do prato/bebida depois`; `prato inativo e bebida inativa não podem ser pedidos`; `número do pedido é o id e cresce`; `cliente é criado/atualizado pelo telefone ao confirmar e o pedido guarda o retrato do nome/telefone`; `eventos pedido/estoque só após o commit (nenhum evento quando a transação falha)`; `aposMudarStatus chamado só depois do commit, com o pedido atualizado`; auditoria de confirmar/reabrir/cancelar/mudarStatus.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** (reaproveitar `MontadorDeItens`, `#escrever`, publicação pós-commit; atualizar `pedido_itens` para `item_tipo`/`bebida_id`/`item_nome`/`tempo_preparo_min`). **Step 4:** `npm test` inteiro verde (adaptar testes antigos de mesas/pedidos que dependiam do que foi removido).
- [ ] **Step 5: Commit** `feat: pedido com status operacional, estoque e clientes`.

### Task 6: API de pedidos e cozinha

**Files:**
- Modify: `src/presentation/http/controllers/PedidoController.js`, `src/presentation/http/validacaoHttp.js`, `src/presentation/http/controllers/MesaController.js` (nada novo), `test/api-pedidos.test.js`
- Create: `src/presentation/http/controllers/CozinhaController.js`, `test/api-cozinha.test.js`

**Interfaces:**
- Produces: `POST /api/pedidos` (rascunho) · `PUT /api/pedidos/:id` · `POST /api/pedidos/:id/confirmar|reabrir|cancelar` (A, B) · `POST /api/pedidos/:id/status` `{ status }` (A, B, C: `cozinha: true`) · `GET /api/pedidos` filtros `de, ate, status, q` (`q` = nº, parte do nome ou dígitos do telefone), A e B · `GET /api/pedidos/:id` (A, B) · `GET /api/pedidos.csv` (mantido, colunas novas: nº, data, hora, cliente, telefone, itens, total, tempo estimado, status) · `GET /api/cozinha` (`cozinha: true`) com os pedidos de `listarCozinha()`. Rotas antigas (itens, enviar-cozinha, mover, finalizar, desconto, itens/:id/cancelar) são removidas.

- [ ] **Step 1: Testes HTTP**: fluxo completo rascunho → confirmar → status até FINALIZADO com os códigos esperados; `C` em `GET /api/cozinha` 200 e em `GET /api/pedidos` 403; `C` `POST …/confirmar` 403; `B` `POST …/status` para EM_PREPARO → 403; busca `q` por número, por nome com acento e por `99999`; `status` inválido → 400; ids não numéricos → 400; corpo vazio → 400; CSV com injeção de fórmula neutralizada e acentos preservados.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4:** PASS. **Step 5: Commit** `feat: API de pedidos por status e endpoint da cozinha`.

### Task 7: Histórico de clientes (backend)

**Files:**
- Modify: `src/application/ClienteService.js`, `src/infrastructure/repositories/ClienteRepository.js`, `src/compositionRoot.js`
- Create: `src/presentation/http/controllers/ClienteController.js`, `test/clientes-historico.test.js`

**Interfaces:**
- Produces: `ClienteService.historico(id) → { cliente, qtdPedidos, totalGastoCents, ultimaCompra, ultimosPedidos }` (qtd, gasto e última compra consideram só `FINALIZADO`; `ultimosPedidos` = 10 últimos confirmados — qualquer status ≠ `ABERTO` — com id, data, total, status); `GET /api/clientes?q=` e `GET /api/clientes/:id` (A, B).

- [ ] **Step 1: Testes**: cliente com 2 finalizados (R$ 40 e R$ 60), 1 cancelado e 1 rascunho → `qtdPedidos 2`, `totalGastoCents 10000`, `ultimaCompra` do mais recente finalizado, `ultimosPedidos` com 3 (finalizados + cancelado, sem rascunho); cliente sem pedidos → zeros e `ultimaCompra null`; busca por telefone parcial e nome; `C` → 403.
- [ ] **Step 2–5:** FAIL → implementar → PASS → commit `feat: histórico de clientes`.

### Task 8: Notificações de WhatsApp (serviço, porta e simulado)

**Files:**
- Create: `src/application/ports/Mensageiro.js`, `src/domain/errors/MensageiroError.js` (extends `ExternalServiceError`, campo `code`), `src/infrastructure/whatsapp/MensageiroSimulado.js`, `src/infrastructure/repositories/NotificacaoRepository.js`, `src/application/NotificacaoService.js`, `src/presentation/http/controllers/NotificacaoController.js`, `test/notificacoes.test.js`
- Modify: `src/application/ConfigService.js` (DEFAULTS), `src/compositionRoot.js` (liga `aposMudarStatus`)

**Interfaces:**
- Produces: `Mensageiro`: `estado() → 'DESCONECTADO'|'AGUARDANDO_QR'|'CONECTANDO'|'CONECTADO'`, `enviar({ telefoneE164, texto }) → Promise<{ id }>` (lança `MensageiroError`); `MensageiroSimulado` com `enviadas[]` e `falharProxima(code)`; `NotificacaoService.aoMudarStatus(pedido, user)` (dispara em `PRONTO_RETIRADA`/`PRONTO_ENTREGA`, sem bloquear), `reenviar(user, pedidoId)`, `historico(pedidoId)`, `renderizar(modelo, { nome, numero })`, `aguardarPendentes()` (para testes); chaves de config `whatsapp.modelo_retirada`, `whatsapp.modelo_entrega`, `whatsapp.numero_empresa` com os textos exatos das Global Constraints; rotas `GET /api/pedidos/:id/notificacoes`, `POST /api/pedidos/:id/notificacoes/reenviar` (A, B), `GET/PUT /api/config/whatsapp` (A); evento `notificacao` `{ pedidoId, situacao, erro? }`.

- [ ] **Step 1: Testes**: ao ir para `PRONTO_RETIRADA` o simulado recebe exatamente o texto de retirada para o telefone do pedido (cliente `"João Silva"` → `Olá, João!`; pedido 1025 → `nº 1025`); `PRONTO_ENTREGA` → texto de entrega; `EM_PREPARO` e `FINALIZADO` não enviam; falha (`falharProxima('NUMERO_SEM_WHATSAPP')`) grava `FALHOU` com o erro, publica `notificacao` e o status do pedido continua `PRONTO_*`; timeout idem; `reenviar` cria nova linha (`automatica 0`, `enviada_por` do usuário) e só vale com status `PRONTO_*` (senão 409); nome com acento/emoji/vazio (usa `"cliente"`); modelo com `{numero}` repetido e marcador desconhecido preservado; `PUT` de modelo vazio ou > 1000 caracteres → 400; `B` pode reenviar mas não editar modelos; `C` → 403; `aposMudarStatus` não é chamado quando a transação falha.
- [ ] **Step 2–5:** FAIL → implementar → PASS → commit `feat: notificações de WhatsApp na mudança de status`.

### Task 9: WhatsApp real (whatsapp-web.js)

**Files:**
- Create: `src/infrastructure/whatsapp/{WhatsAppWebMensageiro,criarClienteWhatsApp,detectarNavegador}.js`, `src/presentation/http/controllers/WhatsAppController.js`, `test/whatsapp.test.js`, `.npmrc` (`puppeteer_skip_download=1`)
- Modify: `src/compositionRoot.js`, `electron-main.js` (iniciar depois da janela, `parar()` ao sair), `electron-builder.config.js`, `src/presentation/http/controllers/EventController.js` (QR só para nível A)

**Interfaces:**
- Produces: `WhatsAppWebMensageiro({ criarCliente, relogio, bus, timeoutMs = 20000 })` cumprindo `Mensageiro` + `iniciar()`, `parar()`, `qrAtual()`; `detectarNavegador({ existe }) → caminho do msedge.exe|null`; rotas `GET /api/whatsapp/estado`, `POST /api/whatsapp/conectar|desconectar|teste` (A); evento `whatsapp` `{ estado, qr? }`.

- [ ] **Step 1: Testes com cliente falso**: `qr → AGUARDANDO_QR e publica o QR`; `ready → CONECTADO`; `enviar usa getNumberId com 55DDDNÚMERO`; `número sem WhatsApp → MensageiroError NUMERO_SEM_WHATSAPP`; `sem resposta em 20 s → TIMEOUT`; `enviar desconectado → NAO_CONECTADO`; `disconnected → nova tentativa em 5, 10, 20… até 60 s`; `parar chama destroy`; `detectarNavegador` escolhe o Edge e devolve null sem ele; `evento com QR não chega a B/C`.
- [ ] **Step 2–4:** FAIL → implementar (`npm i whatsapp-web.js`; `LocalAuth` em `%APPDATA%\pdv-restaurante\whatsapp-session`) → PASS.
- [ ] **Step 5: Verificação manual:** ler o QR, enviar teste em < 10 s, derrubar a internet e conferir que a mudança de status segue funcionando e a falha aparece. **Commit** `feat: integração real com WhatsApp`.

### Task 10: Relatórios (serviço e API)

**Files:**
- Create: `src/domain/relatorio/{tipos,periodo}.js`, `src/infrastructure/repositories/RelatorioRepository.js`, `src/application/RelatorioService.js`, `src/presentation/http/controllers/RelatorioController.js`, `test/relatorios.test.js`

**Interfaces:**
- Produces: `RelatorioService.gerar(tipo, { de, ate, agrupar, limite }) → { titulo, periodo, colunas: [{ chave, titulo, tipo: 'texto'|'inteiro'|'dinheiro'|'duracao'|'data' }], linhas, totais }` para `pedidos-periodo`, `pedidos-finalizados`, `pedidos-cancelados`, `tempo-medio-preparo` (média de `EM_PREPARO` → primeiro `PRONTO_*` no histórico), `faturamento` (`agrupar` = `dia|mes|ano`, só `FINALIZADO` pela data local da finalização), `ticket-medio`, `bebidas-mais-vendidas`, `estoque-atual`, `estoque-critico`, `clientes-frequentes`, `clientes-maior-gasto`; `GET /api/relatorios/:tipo?…` (JSON; só A); `GET /api/relatorios` lista os tipos.

- [ ] **Step 1: Testes** (relógio e fuso controlados pelo helper de data local): faturamento diário com pedido finalizado às 23:50 e outro às 00:10 caem em dias diferentes; mensal e anual somam certo; cancelados e rascunhos fora do faturamento; `ticket-medio = faturamento / finalizados` (arredondado em centavos, 0 quando não há pedidos); tempo médio em minutos com 2 pedidos de 10 e 20 min = 15; bebidas mais vendidas ordenadas por quantidade (empate por nome); estoque crítico só com saldo ≤ mínimo; clientes frequentes/maior gasto contam só finalizados; período sem dados → `linhas: []` e totais zerados; `de > ate` → 400; tipo inexistente → 404; `B` e `C` → 403.
- [ ] **Step 2–5:** FAIL → implementar → PASS → commit `feat: relatórios`.

### Task 11: Exportação para Excel e PDF

**Files:**
- Create: `src/application/ports/ExportadorRelatorio.js`, `src/infrastructure/export/{ExcelExportador,PdfExportador}.js`, `test/exportadores.test.js`
- Modify: `RelatorioController.js` (parâmetro `formato=json|xlsx|pdf`), `src/compositionRoot.js`, `package.json` (`exceljs`, `pdfkit`)

**Interfaces:**
- Produces: `ExcelExportador.exportar(relatorio) → Promise<Buffer>` (cabeçalho em negrito, dinheiro como número com formato `R$ #,##0.00`, texto iniciado por `= + - @` neutralizado); `PdfExportador.exportar(relatorio, { comprimir = true }) → Promise<Buffer>` (A4 paisagem, título, período, data de geração, tabela com quebra de página, totais); respostas com `Content-Type` e `Content-Disposition: attachment; filename="relatorio-<tipo>-AAAA-MM-DD.<ext>"`.

- [ ] **Step 1: Testes**: o `.xlsx` gerado é relido com `exceljs` e traz cabeçalho, linhas e totais com valores numéricos corretos; célula `=1+1` e nome `"+55 Lanches"` saem como texto seguro; nome com acento e emoji preservado; o PDF começa com `%PDF`, com `comprimir: false` contém o título e um nome com acento; relatório com 500 linhas gera várias páginas sem erro; relatório vazio exporta "Nenhum dado no período"; formato inválido → 400.
- [ ] **Step 2–5:** FAIL → implementar → PASS → commit `feat: exportação de relatórios para Excel e PDF`.

### Task 12: Log estruturado, título com versão e /api/sistema

**Files:**
- Create: `src/infrastructure/logging/JsonLineLogger.js`, `src/desktop/titulo.js`, `src/presentation/http/controllers/SistemaController.js`, `test/logging.test.js`, `test/titulo.test.js`
- Modify: `electron-main.js`, `src/compositionRoot.js`, `src/presentation/http/HttpServer.js` (usa o logger; id da requisição), serviços de autenticação/pedido/notificação (log de eventos importantes)

**Interfaces:**
- Produces: `new JsonLineLogger({ pasta, relogio, nivelMinimo = 'info', manter = 14 })` com `debug|info|warn|error(msg, contexto)` gravando uma linha JSON `{ ts, nivel, msg, ...contexto }` em `pdv-AAAA-MM-DD.log` (campos `senha`, `token`, `cookie`, `authorization` e `hash` mascarados; falha de escrita nunca derruba o app); `tituloDaJanela(nome, versao) → 'PDV Restaurante — v0.1.0'`; `GET /api/sistema → { nome, versao }` (qualquer usuário logado, inclusive C).

- [ ] **Step 1: Testes**: linha é JSON válido com `ts` ISO; mascaramento de segredos aninhados; rotação por dia e retenção de 14 arquivos sem apagar arquivos estranhos; erro de escrita é engolido e contado; `tituloDaJanela('PDV Restaurante','1.2.3')`; `/api/sistema` devolve a versão do `package.json`; erro 500 gera linha `error` com o id da requisição e sem stack na resposta.
- [ ] **Step 2–4:** FAIL → implementar (`win.setTitle(tituloDaJanela(app.getName(), app.getVersion()))`, mantendo `page-title-updated` bloqueado) → PASS. **Step 5: Commit** `feat: log estruturado, título com versão e endpoint do sistema`.

### Task 13: Telas — base (crédito, menu) e Cardápio

**Files:**
- Create: `public/js/components/creditos.js`, `public/js/views/cardapio.js`, `src/presentation/http/controllers/CardapioController.js` (rota `GET /api/cardapio/completo`: pratos e bebidas com `ativo`, `tempoPreparoMin`, estoque; A e B), `test/front-base.test.js`
- Modify: `public/index.html`, `public/style.css`, `public/js/{main,niveis}.js`, `public/js/views/{login,sobre}.js`

**Interfaces:**
- Produces: `renderCreditos() → HTML` com `<a href="https://kaio-gomes-site.vercel.app/" target="_blank" rel="noopener noreferrer">Desenvolvido por Kaio Gomes</a>` exibido em todas as telas (login, cada view, cozinha) e em Sobre; menu por nível do spec §8 (A: Novo pedido, Pedidos, Cozinha, Cardápio, Clientes, Cadastros▸Ingredientes/Pratos/Bebidas, Relatórios, Gestão▸Configurações/Usuários/Auditoria, Sobre; B: Novo pedido, Pedidos, Cardápio, Clientes, Sobre; C: só Cozinha, sem menu); Sobre mostra nome e versão (`/api/sistema`).

- [ ] **Step 1: Testes**: `renderCreditos` contém o `href` exato e `rel="noopener noreferrer"`; o HTML servido em `/` carrega o rodapé; `niveis` devolve os itens corretos para A, B e C; `GET /api/cardapio/completo` inclui inativos com `ativo false`, `B` 200, `C` 403; clique no crédito é aberto fora do app (teste de `protegerNavegacao` existente: `https://kaio-gomes-site.vercel.app/` → `shell.openExternal`).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** a view Cardápio: abas **Pratos** (nome, descrição, valor, tempo de preparo, status Disponível/Indisponível) e **Bebidas** (nome, valor, estoque, status; selo "Estoque baixo"), busca por nome e filtros (disponibilidade, categoria, estoque baixo), somente leitura. **Step 4:** PASS + verificação manual no navegador embutido (A, B e C). **Step 5: Commit** `feat: rodapé de crédito, menu por perfil e tela de cardápio`.

### Task 14: Telas — cadastros (ingredientes, pratos, bebidas e estoque)

**Files:**
- Modify: `public/js/views/{ingredientes,pratos,pratoForm}.js`, `public/js/niveis.js`
- Create: `public/js/views/{bebidas,movimentacoes}.js`, `test/front-estoque.test.js`

**Interfaces:**
- Produces: telas no padrão de grid: Ingredientes (unidade de medida, observação), Pratos (campo tempo de preparo em minutos; salvar bloqueado sem ingrediente com mensagem), Bebidas (nome, valor, estoque, mínimo, status, selo "Estoque baixo"; modal sem campo de estoque após criar; ações **Repor**, **Saída**, **Ajustar**, **Movimentações**); funções puras testadas: `validarMovimento({ tipo, quantidade, saldo })`.

- [ ] **Step 1: Testes** das funções puras: saída maior que o saldo recusada; quantidade 0/negativa/1.5 recusada; ajuste exige motivo.
- [ ] **Step 2–4:** FAIL → implementar as telas → PASS → verificação manual: cadastrar 3 ingredientes, 3 pratos (um sem ingrediente é recusado), 3 bebidas; repor, dar saída, ajustar e ver o histórico; selo de estoque baixo. **Step 5: Commit** `feat: telas de cadastros e estoque`.

### Task 15: Tela — Novo pedido

**Files:**
- Create: `public/js/views/pedidoNovo.js`, `public/js/components/{personalizarDialog,carrinho}.js`, `public/js/pedidoCalc.js`, `test/front-calc.test.js`

**Interfaces:**
- Produces: `calcularCarrinho(itens, modo = 'MAXIMO') → { subtotalCents, quantidadeTotal, tempoEstimadoMin }` (itens `{ tipo, precoUnitCents, adicionaisCents, quantidade, tempoPreparoMin }`), em paridade com o servidor.

- [ ] **Step 1: Testes de paridade**: mesmos casos do servidor (`(2800 + 400) × 2 = 6400`, tempo máximo 25, soma 40, bebidas 0 minuto, carrinho vazio zerado).
- [ ] **Step 2–3:** FAIL → implementar a tela: campos **nome** e **telefone** (máscara `(11) 99999-8888`, validação no cliente), abas Pratos/Bebidas com busca, cartões grandes, bebida sem saldo desabilitada e quantidade limitada ao estoque, modal de personalização (observação ≤ 140 por item, ingredientes padrão removíveis e adicionais com preço), carrinho com quantidade/remover/observação, **total, quantidade total e tempo estimado atualizados em tempo real**, rascunho em `localStorage` (com try/catch), **Confirmar pedido** (cria rascunho e confirma; mostra "Pedido nº N confirmado" e limpa).
- [ ] **Step 4:** PASS + verificação manual: pedido com 1 prato personalizado e 2 bebidas; bebida acima do estoque bloqueada; telefone inválido recusado; erro do servidor (409 de estoque) mostrado sem perder o carrinho. **Step 5: Commit** `feat: tela de novo pedido`.

### Task 16: Tela — Pedidos (lista, detalhe, histórico e notificações)

**Files:**
- Create: `public/js/views/{pedidos,pedidoDetalhe}.js`, `public/js/components/statusBadge.js`

- [ ] **Step 1:** Grid (nº, data, hora, cliente, telefone, qtd. de itens, total, tempo estimado, status) com pesquisa por nome, telefone ou número, filtros de status e período, atualização pelos eventos `pedido`; ordem de cadastro. **Step 2:** Detalhe: itens com observações em destaque, totais, **histórico de status** (de → para, quem, quando), **notificações de WhatsApp** (situação, erro, horário, botão **Reenviar**), ações por permissão: Reabrir (RECEBIDO), Cancelar (motivo), Finalizar (PRONTO_*), Confirmar rascunho; alerta visível quando houver notificação `FALHOU` (evento `notificacao`).
- [ ] **Step 3: Verificação manual** com A, B e C (C não abre esta tela). **Step 4: Commit** `feat: tela de pedidos com histórico e notificações`.

### Task 17: Tela — Cozinha e acesso por tablet

**Files:**
- Create: `public/js/views/cozinha.js`, `src/presentation/http/LanListener.js`, `test/lan.test.js`
- Modify: `src/presentation/http/HttpServer.js` (opções `host`, `port`, `rotasPermitidas`, `apenasNivel`), `EventController.js` (nível C só recebe `pedido`), `src/compositionRoot.js`, `electron-main.js`, `public/style.css`

- [ ] **Step 1: Testes** (`lan.test.js`): login nível C pela rede → 200; nível A/B pela rede → 403; C na rede em `/api/pedidos`, `/api/cardapio`, `/api/usuarios` → 404; `GET /api/cozinha` e `POST /api/pedidos/:id/status` na rede → 200 com C; `/api/eventos` na rede só entrega eventos `pedido`; `GET /api/cozinha/endereco` devolve `http://<ipv4 privado>:<porta>/` (interfaces de rede injetáveis).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** o listener restrito (porta `rede.porta_local`, padrão 8420; lista fechada: arquivos estáticos, `/api/login`, `/api/logout`, `/api/me`, `/api/sistema`, `/api/cozinha*`, `/api/pedidos/:id/status`, `/api/eventos` filtrado) e a tela: cartões em **ordem cronológica** com nº, cliente, horário, tempo estimado e tempo decorrido (verde/amarelo/vermelho), itens com **observações em destaque**, status e botão do próximo passo (Iniciar preparo → Pronto para retirada / Pronto para entrega → Finalizar), som de novo pedido, faixa "Sem conexão", layout responsivo para tablet (abas por status na vertical). Mostrar a falha de WhatsApp ao marcar pronto (o atendente reenvia).
- [ ] **Step 4:** PASS + verificação manual em tablet/celular na mesma rede (sessão do usuário C não expira). **Step 5: Commit** `feat: tela da cozinha e acesso por tablet na rede local`.

### Task 18: Telas — Clientes e Relatórios

**Files:**
- Create: `public/js/views/{clientes,clienteDetalhe,relatorios}.js`

- [ ] **Step 1:** Clientes: busca por nome/telefone; abrir mostra quantidade de pedidos, valor total gasto, últimos pedidos (link para o detalhe) e data da última compra. **Step 2:** Relatórios (só A): seletor de tipo, período, agrupamento (dia/mês/ano), tabela com totais, botões **Exportar Excel** e **Exportar PDF** (download via rota com `formato`), estado vazio "Nenhum dado no período".
- [ ] **Step 3: Verificação manual** com dados semeados; abrir os arquivos exportados. **Step 4: Commit** `feat: telas de clientes e relatórios`.

### Task 19: Tela — Configurações

**Files:**
- Create: `public/js/views/configuracoes.js`

- [ ] **Step 1:** Abas (só A): **WhatsApp** (estado da sessão, QR de pareamento, conectar/desconectar, enviar teste, número da empresa com aviso se diferir do número conectado, edição dos dois modelos com pré-visualização usando `João`/`1025`), **Cozinha** (estimativa MAXIMO/SOMA, alerta/crítico em minutos, som, endereço do tablet com QR e a dica de Firewall do Windows em redes privadas), **Restaurante** (nome). **Step 2: Verificação manual.** **Step 3: Commit** `feat: tela de configurações`.

### Task 20: Documentação final, schema.sql e aceite

**Files:**
- Create: `scripts/dump-schema.js` (gera `docs/schema.sql` a partir de um banco migrado em memória: tabelas, índices, gatilhos), `test/schema-dump.test.js`
- Modify: `docs/{README,banco-de-dados,api,interface,regras-de-negocio,roadmap}.md`, `docs/superpowers/specs/2026-10-26-lanchonete-design.md` (estado)

- [ ] **Step 1: Teste**: `dump-schema` gera SQL que, executado em um banco vazio, cria o mesmo esquema (compara `sqlite_master` normalizado). **Step 2:** Gerar `docs/schema.sql`; atualizar o DER e as tabelas em `docs/banco-de-dados.md`, a lista de rotas em `docs/api.md`, o fluxo de telas e o menu em `docs/interface.md`, as regras (status, estoque, WhatsApp, permissões) em `docs/regras-de-negocio.md`, e marcar no `roadmap.md` o que foi entregue e o que ficou para a fase de mesas/fila/PIX/maquininha.
- [ ] **Step 3: Aceite**: `npm test` verde; percorrer um pedido ponta a ponta (atendente cria e confirma → cozinha prepara e marca pronto para retirada → WhatsApp enviado → atendente finaliza → relatório de faturamento em Excel e PDF); conferir título `PDV Restaurante — v0.1.0` e o link do crédito; `npm run dist` gera o instalador. **Step 4: Commit** `docs: esquema SQL, DER e documentação do escopo lanchonete`.
