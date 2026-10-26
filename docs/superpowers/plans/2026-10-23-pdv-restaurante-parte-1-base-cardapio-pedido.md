# PDV Restaurante — Parte 1 (Fases 0–2: base, cardápio, pedido) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema desktop instalável em que o funcionário faz login, cadastra categorias/ingredientes/pratos e registra pedidos de balcão e comandas de mesa com personalização, vendo-os na lista em ordem de cadastro.

**Architecture:** Clone da arquitetura do CCP: Electron sobe um servidor HTTP Node em `127.0.0.1`; camadas domínio → aplicação → infraestrutura → apresentação, ligadas só em `src/compositionRoot.js`; SQLite via `node:sqlite`; SPA em JavaScript puro. Tema azul-escuro no lugar do verde.

**Tech Stack:** Node ≥ 22.13 (CommonJS no back, ES modules no front), `node:sqlite`, `node:test`, Electron, electron-builder, electron-updater.

**Spec:** `docs/README.md` (índice). Em especial `docs/regras-de-negocio.md` (RN-01 a RN-07), `docs/banco-de-dados.md`, `docs/api.md`, `docs/interface.md`, `docs/arquitetura.md`.

**Origem do código reaproveitado:** `CCP = C:\Users\kaiocorrea\Downloads\Nova pasta (4)\CCP-JRP-ENGENHARIA` (ignorar `CCP\.claude\worktrees`). Onde a tarefa diz "copiar do CCP", leia o arquivo de mesmo caminho relativo, copie para este projeto e adapte nomes (`ccp` → `pdv`), níveis e domínio.

## Global Constraints

- Node.js `>=22.13`; banco `node:sqlite`; testes `node --test` (`npm test` = `node --test --test-timeout=30000 --test-reporter=spec test/*.test.js`). Sem bundler no front.
- SQLite: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`. Dinheiro em **centavos inteiros** (`*_cents`); datas/horas ISO 8601 UTC; `data_local` = `AAAA-MM-DD` local.
- Uma classe por arquivo; arquivos < 500 linhas; validar entrada nas fronteiras; textos de interface e mensagens de erro em português do Brasil.
- Servidor da janela escuta só `127.0.0.1`. Cookie de sessão `sid` com `HttpOnly; SameSite=Strict`. Senha com scrypt + sal. 3 senhas erradas bloqueiam por 5 min. Sessão A/B expira em 12 h; nível C não expira por inatividade.
- Níveis: `A` Administrador, `B` Atendente, `C` Cozinha. Primeiro acesso cria `ADMIN` com senha provisória e troca obrigatória (senha mínima 6).
- Valores de pedido são **sempre recalculados no servidor**; preços enviados pelo cliente são ignorados.
- Tokens de cor (claro): `--bg:#f3f5f9; --surface:#ffffff; --surface-2:#f8fafc; --ink:#0f1b2d; --mute:#56667c; --line:#e2e8f0; --line-strong:#cbd5e1; --brand:#1e3a8a; --brand-ink:#ffffff; --brand-soft:#e3eafc; --side:#0b1f44; --side-ink:#b9c7e3; --side-on:#ffffff; --side-on-bg:#1d3a73`. Escuro: `--brand:#8fb0ff; --brand-ink:#0a1633; --brand-soft:#16264a; --side:#071430; --side-ink:#a9b9da`. Demais tokens iguais ao `CCP\public\style.css`.
- Limites: observação do item 140 caracteres; motivo de cancelamento 200; foto até 300 KB; nº do pedido sequencial por dia; rodadas numeradas 1, 2, 3 por pedido.
- Pasta de dados `%APPDATA%\pdv-restaurante\pdv.sqlite`; backup diário em `Documentos\PDV Restaurante Backups`, 14 arquivos mais recentes.
- Commits sem trailer `Co-Authored-By` (regra do `C:\Users\kaiocorrea\CLAUDE.md`). Rodar `npm test` antes de cada commit.

## Review Focus

1. Criação de muitos pedidos em sequência rápida (mesmo milissegundo, virada de dia) nunca repete nem pula `numero_dia` (Tarefa 11).
2. Comanda cujos itens foram todos cancelados tem total 0: não pode ser fechada nem cobrada (Tarefa 11).
3. Nome/cidade/ingrediente com acento, `&`, emoji ou 100 caracteres não quebram nenhuma tela nem o CSV (Tarefas 6, 12).
4. Duas pessoas editando a mesma comanda: segunda gravação sobre item já enviado é recusada, não sobrescreve (Tarefa 11).
5. Ingrediente/prato desativado continua aparecendo em pedidos antigos e em pratos que já o usam (Tarefas 6, 7, 11).

(As entradas de pagamento, PIX, telefone e rede ficam na Parte 2.)

---

### Task 1: Projeto, banco e migração 1

**Files:**
- Create: `package.json`, `.gitignore`, `src/infrastructure/database/SqliteDatabase.js` (copiar do CCP), `src/infrastructure/database/migrations.js`, `test/database.test.js`

**Interfaces:**
- Produces: `new SqliteDatabase(path|':memory:')` com `.exec(sql)`, `.prepare(sql)`, `.transaction(fn)`; `migrations` = array ordenado de `{ version, up(db) }`; aplica pendentes na abertura e grava `PRAGMA user_version`.

- [ ] **Step 1:** `git init` na raiz `C:\Users\kaiocorrea\Downloads\restaurante`. Criar `package.json` (`name: pdv-restaurante`, `main: electron-main.js`, scripts `start`, `desktop`, `test`, `dist`, engines Node `>=22.13`; devDependencies electron/electron-builder e dependency electron-updater com as versões do `CCP\package.json`) e `.gitignore` (node_modules, dist, data, .env, whatsapp-session).
- [ ] **Step 2: Escrever `test/database.test.js`** com: `aplica a migração 1 e grava user_version = 1`; `usuarios.nivel rejeita valor fora de A, B, C`; `usuario é único sem diferenciar maiúsculas`; `auditoria rejeita UPDATE e DELETE com a mensagem "auditoria é imutável"`; `em arquivo temporário, journal_mode é wal e foreign_keys é 1`.
- [ ] **Step 3: Rodar** `npm test` → falha (módulos ausentes).
- [ ] **Step 4: Implementar** migração 1 conforme `docs/banco-de-dados.md`: `usuarios`, `configuracoes`, `auditoria` + gatilhos `auditoria_sem_update`/`auditoria_sem_delete`. Copiar `SqliteDatabase.js` do CCP ajustando os PRAGMAs (acrescentar `busy_timeout = 5000`).
- [ ] **Step 5: Rodar** `npm test` → PASS.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: projeto base, SQLite e migração 1"`.

### Task 2: Autenticação, usuários, auditoria e configurações

**Files:**
- Create (copiar do CCP e adaptar): `src/domain/errors/*.js`, `src/infrastructure/security/{PasswordHasher,LoginThrottle,SessionStore}.js`, `src/infrastructure/repositories/{UsuarioRepository,AuditRepository}.js`, `src/application/{AuthService,UsuarioService,AuditTrail,AdminBootstrap}.js`
- Create: `src/domain/niveis.js`, `src/application/ConfigService.js`, `test/auth.test.js`

**Interfaces:**
- Produces:
  - `NIVEIS = { A: 'Administrador', B: 'Atendente', C: 'Cozinha' }`
  - `AuthService.login(usuario, senha) → { sid, user }` (lança `UnauthorizedError`, `TooManyAttemptsError`); `resolveUser(sid) → user|null`; `logout(sid)`; `trocarSenha(user, atual, nova)`
  - `UsuarioService.criar(actor, { usuario, nome, nivel }) → { user, senhaProvisoria }`; `atualizar(actor, id, dados)`; `resetarSenha(actor, id)`; `listar()`
  - `AuditTrail.record({ actor, acao, entidade, entidadeId, descricao, antes, depois })`
  - `AdminBootstrap.run() → { senhaProvisoria } | null` (cria `ADMIN` só se não houver usuários)
  - `ConfigService.get(chave) → string`, `set(actor, chave, valor)`, `todas()`; `DEFAULTS` com as chaves de `docs/banco-de-dados.md` (`cozinha.enviar_em='PAGO'`, `cozinha.alerta_min='10'`, `cozinha.critico_min='20'`, `cozinha.som='1'`, `pix.validade_min='15'`, `fila.tolerancia_min='10'`, `maquininha.timeout_s='120'`, `rede.porta_local='8420'`, `restaurante.nome`, `whatsapp.modelo_chamada`)

- [ ] **Step 1: Testes em `test/auth.test.js`** (relógio falso injetável): `login correto devolve sid e user sem senha_hash`; `3 senhas erradas bloqueiam por 5 minutos e liberam depois`; `usuário novo nasce com must_change = 1`; `trocarSenha exige senha atual e mínimo de 6`; `não rebaixa nem desativa o último administrador`; `usuário não exclui a si mesmo`; `sessão nível A expira após 12 h sem uso`; `sessão nível C não expira por inatividade`; `AdminBootstrap cria ADMIN uma única vez`; `ConfigService devolve DEFAULTS e persiste set com auditoria`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** copiando do CCP e trocando a regra de níveis para A/B/C acima (no CCP `C` era "Consulta"; aqui é Cozinha). `SessionStore` recebe `ttlPorNivel`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: autenticação, usuários, auditoria e configurações`.

### Task 3: Servidor HTTP, permissões por nível e eventos

**Files:**
- Create (copiar do CCP): `src/presentation/http/{HttpServer,Router,StaticFileHandler,FileResponse,requestParsing}.js`, `src/presentation/http/controllers/{AuthController,UsuarioController,AuditController}.js`
- Create: `src/infrastructure/events/EventBus.js`, `src/presentation/http/controllers/EventController.js`, `src/compositionRoot.js`, `src/server.js`, `test/helpers/createTestApp.js`, `test/api-auth.test.js`

**Interfaces:**
- Produces:
  - `Router.add(method, path, handler, { public?, nivel?: 'A', cozinha?: boolean })` — padrão: exige nível A ou B; nível C só em rotas com `cozinha: true`; `nivel: 'A'` só administrador; `public` sem login. Enquanto `must_change`, só `/api/me` e `/api/me/senha`.
  - `EventBus.publish(tipo, dados)`, `subscribe(fn) → unsubscribe`; `GET /api/eventos` (SSE, `text/event-stream`) entrega eventos `{tipo, dados}`.
  - `buildApplication({ dbPath, relogio?, ...fakes }) → { server, services, bus, db, close() }` (único lugar com `new` de classes concretas).
  - `createTestApp(overrides) → { request(method, path, { body, user }), login(usuario, senha), bus, db, relogio }` com banco `:memory:`.

- [ ] **Step 1: Testes em `test/api-auth.test.js`**: `POST /api/login correto define cookie sid HttpOnly e SameSite=Strict`; `rota protegida sem cookie → 401`; `nível B em /api/usuarios → 403`; `nível C em /api/usuarios → 403`; `4ª tentativa após 3 erradas → 429`; `com senha provisória, /api/auditoria → 403 e /api/me → 200`; `GET /api/eventos entrega o evento publicado no EventBus`; `exceção inesperada → 500 {error} sem stack`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** rotas de `docs/api.md` seção Acesso, `/api/usuarios`, `/api/auditoria`, `/api/eventos`. `server.js`: `npm start` em `http://localhost:3000` com banco `data/pdv.sqlite` (ou `PDV_DB`).
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: servidor HTTP, permissões por nível e SSE`.

### Task 4: Interface base azul-escuro (login, menu, usuários, auditoria, sobre)

**Files:**
- Create: `public/index.html`, `public/style.css`, `public/js/{main,api,ui,theme,icons,format,state,niveis}.js`, `public/js/components/{grid,filterDialog,passwordToggle}.js`, `public/js/views/{login,usuarios,auditoria,sobre}.js`, `public/js/events.js`, `public/img/` (logo provisório), `test/static.test.js`
- Copiar do CCP os equivalentes e adaptar (`CCP\public\...`); logos novos.

**Interfaces:**
- Produces: `api.get/post/put/del(path, body)` (erro 401 dispara `pdv:session-expired`); `events.js`: `conectar(onEvento)` com reconexão automática; `openDialog`, `confirmDialog`, `notify` iguais ao CCP; roteador por hash (`#/pedido-novo`, `#/pedidos`, `#/andon`...); menu montado por nível (A tudo; B sem Gestão; C só Andon sem menu).

- [ ] **Step 1: Testes em `test/static.test.js`**: `GET / serve index.html`; `style.css contém --brand:#1e3a8a e --side:#0b1f44 no tema claro e --brand:#8fb0ff no escuro`; `GET /../package.json → 404`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** `style.css` com os tokens das Global Constraints (cópia do CCP trocando as cores); telas de login com troca obrigatória de senha, Usuários (grid + modal + backup), Auditoria, Sobre. Menu conforme o desenho de `docs/interface.md`.
- [ ] **Step 4: Rodar** `npm test` → PASS.
- [ ] **Step 5: Verificação manual:** `npm start`; abrir `http://localhost:3000`; entrar com `ADMIN` (senha provisória impressa no console), trocar a senha, criar um usuário nível B e um nível C; conferir menu azul-escuro, tema escuro (SO) e que o usuário C só vê o Andon (vazio por enquanto).
- [ ] **Step 6: Commit** `feat: interface base azul-escuro`.

### Task 5: Casca Electron, backup diário e instalador

**Files:**
- Create: `electron-main.js`, `electron-builder.config.js`, `src/desktop/ElectronUpdater.js`, `src/infrastructure/update/NoUpdater.js` (copiar do CCP), `src/infrastructure/backup/DailyBackup.js`, `test/backup.test.js`

**Interfaces:**
- Produces: `new DailyBackup({ db, pasta, relogio, manter = 14 }).run() → caminho|null` (uma vez por dia, `pdv-AAAA-MM-DD.sqlite` via `VACUUM INTO`).

- [ ] **Step 1: Testes**: `grava pdv-AAAA-MM-DD.sqlite uma única vez por dia`; `mantém só os 14 mais recentes`; `o backup abre como SQLite válido`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** `DailyBackup`. `electron-main.js` (base: `CCP\electron-main.js`): `userData` fixo `%APPDATA%\pdv-restaurante`, `requestSingleInstanceLock`, `contextIsolation: true`, `nodeIntegration: false`, bloqueio de navegação externa, backup ao abrir e a cada 6 h. `electron-builder.config.js`: `appId: 'br.com.pdvrestaurante.app'`, `productName: 'PDV Restaurante'`, `files` por lista permitida, NSIS por usuário, `deleteAppDataOnUninstall: false`.
- [ ] **Step 4: Rodar** `npm test` → PASS.
- [ ] **Step 5: Verificação manual:** `npm run desktop` abre a janela com o login; fechar e reabrir mantém os dados; `npm run dist` gera o instalador em `dist/`.
- [ ] **Step 6: Commit** `feat: casca Electron, backup diário e empacotamento`.

### Task 6: Categorias e ingredientes

**Files:**
- Modify: `src/infrastructure/database/migrations.js` (migração 2: `categorias`, `ingredientes`, `pratos`, `prato_ingredientes` conforme o DER)
- Create: `src/domain/cardapio/validators.js`, `src/infrastructure/repositories/{CrudRepository (copiar CCP),CategoriaRepository,IngredienteRepository}.js`, `src/application/{CadastroService (copiar/adaptar CCP)}.js`, `src/presentation/http/controllers/CadastroController.js` (copiar/adaptar), `test/cardapio-cadastros.test.js`

**Interfaces:**
- Produces: rotas `GET/POST /api/categorias`, `PUT/DELETE /api/categorias/:id`, idem `/api/ingredientes` (GET para A/B; escrita só A). Colunas auxiliares `nome_norm` (minúsculas, sem acento) com `UNIQUE` em `categorias` e `ingredientes`.
  - Categoria: `{ nome, ordem, vaiParaCozinha, ativo }`. Ingrediente: `{ nome, precoAdicionalCents, podeSerAdicional, ativo }`.

- [ ] **Step 1: Testes**: `rejeita ingrediente "Pao" quando existe "Pão"`; `rejeita nome vazio ou > 60 caracteres`; `precoAdicionalCents negativo → 400`; `excluir ingrediente em uso → 409 "Em uso"`; `PUT ativo=false desativa`; `categoria nova tem vaiParaCozinha = true`; `nível B faz GET e recebe 403 no POST`; `nome com emoji e & é gravado e devolvido intacto`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: categorias e ingredientes`.

### Task 7: Pratos com ingredientes e cardápio completo

**Files:**
- Create: `src/infrastructure/repositories/PratoRepository.js`, `src/application/PratoService.js`, `src/presentation/http/controllers/{PratoController,CardapioController}.js`, `src/domain/validation/FotoValidator.js` (adaptar `CCP ProfilePhotoValidator`), `test/pratos.test.js`

**Interfaces:**
- Produces: `PratoService.criar(actor, { nome, codigo?, categoriaId, descricao?, precoCents, ingredientes: [{ ingredienteId, removivel, quantidade?, ordem }] }) → Prato`; `atualizar`, `desativar`, `excluir` (409 se já pedido), `definirFoto(actor, id, dataUri)`. `GET /api/cardapio → { categorias, pratos, adicionais }` apenas ativos, `adicionais` = ingredientes com `podeSerAdicional` e ativos.

- [ ] **Step 1: Testes**: `preço 0 → 400`; `mesmo ingrediente duas vezes no prato → 400`; `ingrediente inativo não entra em prato novo`; `ingrediente desativado depois continua no prato existente`; `código curto duplicado → 409`; `GET /api/cardapio omite pratos e categorias inativos`; `foto > 300 KB → 400`; `foto com assinatura inválida → 400`; `alterar ingredientes substitui a lista em transação`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: pratos, ingredientes do prato e /api/cardapio`.

### Task 8: Telas do cardápio

**Files:**
- Create: `public/js/views/{categorias,ingredientes,pratos}.js`, `public/js/components/ingredientePicker.js`

- [ ] **Step 1:** Telas no padrão de grid do CCP (`components/grid.js`): categorias (ordem, "vai para a cozinha"), ingredientes (preço de adicional, "pode ser adicional", ativo), pratos (modal com aba **Ingredientes**: adicionar, marcar removível, reordenar, quantidade informativa; foto opcional). Nível B vê tudo sem botões de edição.
- [ ] **Step 2: Verificação manual (critério da Fase 1):** cadastrar 5 categorias e 10 pratos com ingredientes; desativar um ingrediente em uso funciona; excluir ingrediente em uso mostra "Em uso".
- [ ] **Step 3: Commit** `feat: telas do cardápio`.

### Task 9: Domínio do pedido (funções puras)

**Files:**
- Create: `src/domain/pedido/{calculos,situacoes}.js`, `src/domain/pedido/ItemValidator.js`, `test/pedido-domain.test.js`

**Interfaces:**
- Produces:
  - `calcularItem({ precoPratoCents, adicionais: [{ precoUnitCents, quantidade }], quantidade }) → { adicionaisCents, totalCents }`
  - `calcularPedido(itens: [{ totalCents, cancelado }], descontoCents = 0) → { subtotalCents, descontoCents, totalCents }` (lança `ValidationError` se desconto > subtotal)
  - `SITUACOES = ['ABERTO','AGUARDANDO_PAGAMENTO','PAGO','CANCELADO']`; `podeTransitar(de, para) → boolean`
  - `validarItem(entrada, prato, adicionaisDisponiveis) → ItemNormalizado` (lança `ValidationError`); `validarIdentificacao({ tipo, mesaId, clienteNome })`

- [ ] **Step 1: Testes** (valores exatos): `X-Burger 2800 + bacon 2×200, quantidade 2 → adicionaisCents 400 e totalCents 6400`; `remover ingrediente não altera o preço`; `itens cancelados não entram no subtotal`; `desconto maior que subtotal → ValidationError`; `ABERTO→AGUARDANDO_PAGAMENTO ok, PAGO→ABERTO não, PAGO→CANCELADO ok, CANCELADO→qualquer não`; `remover ingrediente não removível → erro`; `remover e adicionar o mesmo ingrediente → erro`; `adicionar ingrediente com podeSerAdicional falso → erro`; `adicionar de novo um ingrediente padrão (dose extra) → ok`; `observação com 141 caracteres → erro`; `quantidade 0 ou 1.5 → erro`; `MESA sem mesaId → erro`; `BALCAO sem clienteNome → erro`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: domínio do pedido`.

### Task 10: Mesas (migração 3)

**Files:**
- Modify: `migrations.js` (migração 3: `mesas`, `fila_espera`, `mensagens_whatsapp` conforme o DER — as duas últimas só ficam prontas aqui)
- Create: `src/infrastructure/repositories/MesaRepository.js`, `src/application/MesaService.js`, `src/presentation/http/controllers/MesaController.js`, `test/mesas.test.js`

**Interfaces:**
- Produces: `MesaService.ocupar(user, id)`, `liberar(user, id) → { mesa, sugestaoFila: null }` (a sugestão é preenchida na Parte 2), CRUD só A. Construtor recebe `comandaNaoPagaDaMesa(mesaId) → boolean` (implementada na Tarefa 11).

- [ ] **Step 1: Testes** (com função falsa para `comandaNaoPagaDaMesa`): `liberar mesa com comanda não paga → 409`; `liberar mesa sem comanda aberta → LIVRE`; `número de mesa duplicado → 409`; `B não cria mesa (403) mas lista (200)`; `capacidade < 1 → 400`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: mesas`.

### Task 11: Persistência e serviço do pedido (migração 4)

**Files:**
- Modify: `migrations.js` (migração 4: `pedidos`, `pedido_envios`, `pedido_itens`, `item_modificacoes`, índices `ux_comanda_aberta` e `UNIQUE (data_local, numero_dia)`, `CHECK`s de `docs/banco-de-dados.md`)
- Create: `src/infrastructure/repositories/PedidoRepository.js`, `src/application/PedidoService.js`, `test/pedido-service.test.js`
- Modify: `src/compositionRoot.js` (ligar `comandaNaoPagaDaMesa` ao `PedidoRepository`)

**Interfaces:**
- Consumes: `calcularItem`, `calcularPedido`, `validarItem`, `podeTransitar` (Tarefa 9), `MesaService` (Tarefa 10), `ConfigService`, `AuditTrail`, `EventBus`.
- Produces (`PedidoService`, todos recebem `user` primeiro):
  - `criar(user, { tipo, mesaId?, clienteNome?, observacao?, itens: ItemInput[] }) → Pedido`
  - `adicionarItens(user, pedidoId, itens)`; `substituirPendentes(user, pedidoId, { mesaId?, clienteNome?, observacao?, itens })`
  - `enviarCozinha(user, pedidoId) → Envio` (cria rodada com os itens pendentes)
  - `cancelarItem(user, pedidoId, itemId, motivo)`; `mover(user, pedidoId, mesaId)`
  - `finalizar(user, pedidoId) → Pedido`; `reabrir(user, pedidoId)`; `cancelar(user, pedidoId, motivo)`; `aplicarDesconto(user, pedidoId, descontoCents)` (só A)
  - `listar({ de, ate, situacao, forma, mesaId, atendenteId, q }) → Pedido[]` por `id` crescente; `obter(id) → Pedido` com itens, modificações, envios, pagamentos
  - `ItemInput = { pratoId, quantidade, observacao?, remover: number[], adicionar: [{ ingredienteId, quantidade }] }`
  - Eventos publicados: `pedido` `{ id, situacao }`.

- [ ] **Step 1: Testes em `test/pedido-service.test.js`**: `numero_dia é sequencial no dia e volta a 1 no dia seguinte` (relógio falso); `50 pedidos criados em sequência no mesmo instante recebem 1..50 sem repetição`; `retrato: mudar o preço do prato depois não altera o item gravado`; `preço enviado pelo cliente é ignorado`; `abrir comanda em mesa livre deixa a mesa OCUPADA`; `segunda comanda na mesma mesa → 409`; `enviarCozinha cria a rodada 1 e depois a 2 com os itens pendentes`; `enviarCozinha sem itens pendentes → 400`; `rodada só com bebidas (categoria sem cozinha) tem vai_para_cozinha = 0`; `substituirPendentes não altera item já enviado`; `cancelarItem exige motivo, tira o item do subtotal e mantém a linha`; `finalizar comanda com itens pendentes → 409`; `finalizar quando todos os itens estão cancelados → 400 (total zero)`; `balcão com cozinha.enviar_em=FINALIZADO cria rodada ao finalizar; com PAGO não cria`; `cancelar pedido PAGO por nível B → 403, por A com motivo → ok`; `mover comanda para mesa ocupada → 409, para livre libera a antiga`; `prato já pedido: excluir → 409, desativar → ok`; `auditoria registra criar, enviar, cancelar`; `eventos "pedido" são publicados`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** `PedidoRepository` (transações; `numero_dia = MAX+1` no mesmo `BEGIN IMMEDIATE`) e `PedidoService` seguindo RN-05/RN-06. Retrato copiado em `pedido_itens`/`item_modificacoes`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: serviço de pedido, comanda de mesa e rodadas`.

### Task 12: API de pedidos e mesas

**Files:**
- Create: `src/presentation/http/controllers/PedidoController.js`, `src/infrastructure/csv/{CsvWriter (copiar CCP)}.js`, `test/api-pedidos.test.js`

**Interfaces:** rotas de `docs/api.md` seção Pedidos e Mesas (`POST /api/pedidos`, `PUT /api/pedidos/:id`, `/itens`, `/enviar-cozinha`, `/itens/:itemId/cancelar`, `/mover`, `/finalizar`, `/reabrir`, `/desconto` (A), `/cancelar`, `GET /api/pedidos`, `GET /api/pedidos/:id`, `GET /api/pedidos.csv`, `GET /api/mesas`, `GET /api/mesas/:id/comanda`, `POST /api/mesas/:id/liberar|ocupar`).

- [ ] **Step 1: Testes HTTP**: `GET /api/pedidos devolve ordem crescente de id e só o dia atual por padrão`; `filtro por situacao, por mesaId e q (nº ou cliente)`; `total enviado no corpo é ignorado`; `nível C → 403 em /api/pedidos`; `GET /api/mesas/:id/comanda → 404 sem comanda`; `pedidos.csv neutraliza célula começando com = + - @`; `nome de cliente com acento, emoji e & vai e volta intacto no JSON e no CSV`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: API de pedidos e mesas`.

### Task 13: Tela "Novo pedido" (balcão e comanda de mesa)

**Files:**
- Create: `public/js/views/pedidoNovo.js`, `public/js/components/personalizarDialog.js`, `public/js/pedidoCalc.js`, `test/front-calc.test.js`

**Interfaces:**
- Produces: `pedidoCalc.totalItem({ precoPratoCents, adicionais, quantidade }) → number` (exibição ao vivo; o servidor é a fonte da verdade).

- [ ] **Step 1: Teste de paridade** `test/front-calc.test.js` (import dinâmico do módulo ES): `totalItem dá os mesmos valores de calcularItem em 5 casos, incluindo 6400 do X-Burger`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** `pedidoCalc.js`.
- [ ] **Step 4: Implementar a tela** conforme `docs/interface.md` ("Novo pedido"): alternar Balcão/Mesa; cartões grandes por categoria; modal de personalização (ingredientes padrão como caixas, cadeado nos não removíveis, adicionais com −/+ e preço, quantidade, observação, preço ao vivo); comanda agrupada por rodada e "A enviar"; `F8` Enviar para a cozinha, `F9` Finalizar/Fechar conta; rascunho em `localStorage`; "Cancelar item" com motivo.
- [ ] **Step 5: Verificação manual (critério da Fase 2):** pedido de balcão com 3 itens personalizados em < 1 min; comanda com 2 rodadas e 1 item cancelado fecha com total correto; recarregar a página mantém o rascunho.
- [ ] **Step 6: Commit** `feat: tela de novo pedido`.

### Task 14: Lista de pedidos e mapa de mesas

**Files:**
- Create: `public/js/views/{pedidos,mesas}.js`, `public/js/components/statusBadge.js`

- [ ] **Step 1:** `pedidos.js` no padrão de grid: colunas nº, hora, tipo, mesa/cliente, itens, total, pagamento, situação, cozinha, atendente; **sem reordenar por coluna**; filtros (período, situação, forma, mesa, atendente); pesquisa por nº/cliente; detalhe com itens, personalizações ("sem cebola, + bacon") e rodadas; ação principal por situação (Continuar / Cobrar / Ver) e "⋯" (Marcar entregue, Cancelar com motivo); atualiza pelos eventos `pedido`.
- [ ] **Step 2:** `mesas.js`: cartões com número, lugares, situação, total parcial e tempo da comanda; tocar abre/cria a comanda; Liberar/Ocupar; mensagem clara quando a liberação é bloqueada.
- [ ] **Step 3: Verificação manual:** pedidos aparecem do mais antigo ao mais novo; cancelar pedido pede motivo; liberar mesa com comanda aberta é recusado.
- [ ] **Step 4: Rodar** `npm test` (tudo verde) e **Commit** `feat: lista de pedidos e mapa de mesas`.

**Fim da Parte 1:** sistema instalável com login, cardápio e pedidos (sem cobrança). Continuar em `2026-10-23-pdv-restaurante-parte-2-pagamento-andon-fila-whatsapp.md`.
