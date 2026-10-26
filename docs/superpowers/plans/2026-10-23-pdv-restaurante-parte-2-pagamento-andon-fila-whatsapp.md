# PDV Restaurante — Parte 2 (Fases 3–5: pagamento/PIX, andon, fila, WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrar pedidos (maquininha simulada, PIX com QR Code, contingência manual), mostrar rodadas no andon da cozinha (monitor e tablet), gerir a fila de espera e avisar o cliente pelo WhatsApp.

**Architecture:** Sobre a Parte 1. Integrações externas ficam atrás de portas (`TerminalPagamento`, `Mensageiro`, `GeradorPix`) com implementação simulada para testes; cobrança é assíncrona (responde `202`, resultado por SSE). Um segundo listener HTTP restrito atende a rede local (tablet do andon).

**Tech Stack:** o da Parte 1 + `qrcode` e `whatsapp-web.js`.

**Spec:** `docs/README.md` (índice). Em especial `docs/regras-de-negocio.md` (RN-08 a RN-12), `docs/integracoes.md`, `docs/arquitetura.md` (Operações longas, Segurança), `docs/api.md`, `docs/interface.md`.

**Pré-requisito:** Parte 1 concluída (`2026-10-23-pdv-restaurante-parte-1-base-cardapio-pedido.md`). `CCP` = `C:\Users\kaiocorrea\Downloads\Nova pasta (4)\CCP-JRP-ENGENHARIA`.

## Global Constraints

- As Global Constraints da Parte 1 valem aqui (Node ≥ 22.13, `node:sqlite`, centavos, uma classe por arquivo, < 500 linhas, português, commits sem `Co-Authored-By`).
- Valores: validade do QR PIX `15` min (`pix.validade_min`); tempo limite da maquininha `120` s (`maquininha.timeout_s`); tolerância da fila `10` min; telefone anonimizado após `30` dias; alerta do andon `10` min, crítico `20` min; desfazer no andon `10` s; cartão cancelado some após `60` s; porta da rede local `8420` (`rede.porta_local`); envio de WhatsApp com limite de `20` s; reconexão do WhatsApp com espera de `5` s dobrando até `60` s.
- `txid` do PIX = `PED` + `id` do pedido com 6 dígitos (ex.: `PED000123`). BR Code conforme `docs/integracoes.md` (IDs `00,26,52,53,54,58,59,60,62,63`). Nome do recebedor ≤ 25 e cidade ≤ 15 caracteres, só `[A-Z0-9 ]` maiúsculos, sem acento.
- Um pagamento `PENDENTE` por pedido e um `APROVADO` por pedido (índices únicos parciais). Pagamento `PENDENTE` encontrado ao iniciar nunca vira `APROVADO` sozinho: vira `EXPIRADO`.
- O listener da rede local só serve: arquivos do andon, `/api/login`, `/api/logout`, `/api/me`, `/api/cozinha*`, `/api/eventos` (somente eventos `cozinha`). Só nível `C` faz login por ele; qualquer outra rota → 404. Nenhum preço, pagamento ou telefone passa por ele.
- Nenhuma mensagem de WhatsApp é enviada sem a ação explícita "Chamar" do funcionário.
- Segredos de integração nunca em texto puro nem em logs; sessão do WhatsApp em `%APPDATA%\pdv-restaurante\whatsapp-session`, fora do banco e do backup.

## Review Focus

1. Nome/cidade com acento, `&`, cedilha ou mais de 25 caracteres geram BR Code válido (CRC confere, só `[A-Z0-9 ]`) (Tarefa 15).
2. Reiniciar o sistema com cobrança `PENDENTE` nunca a marca como aprovada (Tarefa 17).
3. Duplo clique em "Crédito"/"Cobrar" não cria duas cobranças (Tarefa 17).
4. Telefones digitados como `(11) 99999-8888`, `+55 11 99999-8888`, `011999998888`, `99998888` e `abc` são normalizados ou recusados com mensagem clara (Tarefa 21).
5. Tablet nível C na rede não acessa nenhuma tela além do andon e login nível A pela rede é recusado (Tarefa 19).

---

### Task 15: Domínio PIX (BR Code, CRC16, chaves)

**Files:**
- Create: `src/domain/pix/{crc16,BrCode,chavePix}.js`, `test/pix-domain.test.js`

**Interfaces:**
- Produces:
  - `crc16(texto: string) → string` (CCITT-FALSE, poli `0x1021`, inicial `0xFFFF`, 4 hex maiúsculos)
  - `normalizarTexto(texto: string, max: number) → string` (maiúsculas, sem acento, só `[A-Z0-9 ]`, aparado, no máximo `max`)
  - `txidDoPedido(pedidoId: number) → string`
  - `montarBrCode({ chave, nomeRecebedor, cidade, valorCents, txid }) → string`
  - `validarChavePix(tipo: 'CPF'|'CNPJ'|'EMAIL'|'TELEFONE'|'ALEATORIA', chave: string) → string` (chave normalizada; lança `ValidationError`)

- [ ] **Step 1: Testes**: `crc16("123456789") é "29B1"`; `BR Code termina em 6304 + CRC calculado sobre todo o texto anterior`; `decodificando os campos TLV: 00=01, 26/00=br.gov.bcb.pix, 26/01=chave, 52=0000, 53=986, 54="57.90" para 5790 centavos, 58=BR, 62/05=PED000123`; `5 centavos → "0.05" e 100000 → "1000.00"`; `nome "José da Conceição & Filhos Ltda ME 2024" e cidade "São Paulo" viram só [A-Z0-9 ], sem acento, ≤25 e ≤15, e o CRC continua válido`; `txidDoPedido(123) = "PED000123"`; `CPF com dígito errado → erro, CPF válido ok`; `CNPJ (reusar CCP src/domain/cnpj.js, inclusive alfanumérico)`; `e-mail inválido → erro`; `"(11) 99999-8888" vira "+5511999998888"`; `UUID aleatória aceita, texto livre recusado`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: domínio PIX (BR Code e CRC16)`.

### Task 16: Chaves PIX, QR Code e migração 5

**Files:**
- Modify: `migrations.js` (migração 5: `chaves_pix`, `pagamentos`, índices `ux_chave_pix_ativa`, `ux_pagamento_pendente`, `ux_pagamento_aprovado`)
- Create: `src/infrastructure/repositories/{ChavePixRepository,PagamentoRepository}.js`, `src/infrastructure/pix/QrCodeGenerator.js`, `src/application/PixKeyService.js`, `src/presentation/http/controllers/PixController.js`, `test/pix-chaves.test.js`

**Interfaces:**
- Produces: `QrCodeGenerator.svg(payload) → Promise<string>` (`<svg…>`, correção de erro M); `PixKeyService.criar(actor, { tipo, chave, nomeRecebedor, cidade })`, `ativar(actor, id)`, `chaveAtiva() → ChavePix|null`, `gerarTeste(actor, id) → { payload, qrSvg }` (R$ 0,01). Rotas `GET/POST /api/pix/chaves`, `POST /api/pix/chaves/:id/ativar|teste` (só A).

- [ ] **Step 1: Testes**: `ativar uma chave desativa as outras`; `o banco recusa duas chaves ativas (índice único)`; `chave inválida → 400 com mensagem do tipo`; `gerarTeste devolve payload com valor 0.01 e CRC válido`; `QrCodeGenerator.svg começa com "<svg"`; `nível B → 403 em todas as rotas /api/pix`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** (`npm i qrcode`). **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: chaves PIX e geração de QR Code`.

### Task 17: Pagamento (maquininha simulada, PIX, contingência)

**Files:**
- Create: `src/application/ports/{TerminalPagamento,GeradorPix}.js` (documentação do contrato), `src/infrastructure/pagamento/TerminalSimulado.js`, `src/application/PagamentoService.js`, `src/presentation/http/controllers/PagamentoController.js`, `test/pagamento.test.js`

**Interfaces:**
- Consumes: `PedidoService` (Tarefa 11), `PixKeyService`, `QrCodeGenerator`, `ConfigService`, `EventBus`, relógio.
- Produces:
  - `TerminalPagamento`: `cobrar({ pagamentoId, valorCents, forma, descricao }) → Promise<{ situacao: 'APROVADO'|'RECUSADO'|'CANCELADO', nsu?, autorizacao?, bandeira?, referenciaExterna?, mensagem? }>`; `cancelar(pagamentoId) → Promise<void>`; `consultar(pagamentoId) → Promise<resultado|null>`
  - `TerminalSimulado({ relogio })` com `definirProximo({ situacao, atrasoMs, nsu })`
  - `PagamentoService.iniciar(user, pedidoId, forma) → { pagamento, pix?: { payload, qrSvg, expiraEm }, concluido: Promise<Pagamento> }`; `registrarManual(user, pedidoId, { forma, nsu?, observacao }) → Pagamento`; `confirmarPix(user, pagamentoId)`; `cancelar(user, pagamentoId)`; `obter(id)`; `recuperarPendentes()` (chamada na inicialização)
  - Rotas de `docs/api.md` seção Pagamentos; eventos `pagamento` `{ id, pedidoId, situacao, mensagem }`.

- [ ] **Step 1: Testes** (relógio e terminal falsos): `crédito aprovado: pagamento APROVADO, pedido PAGO e pago_em preenchido`; `o valor enviado ao terminal é o total_cents do banco`; `recusado: pagamento RECUSADO e o pedido aceita nova forma`; `sem resposta em 120 s: EXPIRADO e terminal.cancelar é chamado`; `segunda cobrança com outra PENDENTE → 409 (duplo clique)`; `pedido fora de AGUARDANDO_PAGAMENTO → 409`; `PIX sem chave ativa → 409 "Cadastre a chave PIX"`; `PIX devolve payload, qrSvg e expiraEm = agora + 15 min`; `confirmarPix → APROVADO, manual = 1, confirmado_por = usuário, pedido PAGO`; `confirmar PIX após expirar → 409`; `registrarManual cria APROVADO com provedor "manual" e auditoria`; `cancelar PENDENTE da maquininha chama terminal.cancelar`; `recuperarPendentes marca PENDENTE antigo como EXPIRADO e nunca como APROVADO`; `pedido de balcão pago com cozinha.enviar_em=PAGO ganha rodada no andon`; `evento "pagamento" é publicado a cada mudança`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** `PagamentoService` (cobrança em segundo plano com limite de tempo; resultado e mudança do pedido numa única transação).
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: pagamento com maquininha simulada, PIX e contingência`.

### Task 18: Telas de pagamento e configurações (Restaurante, PIX, Maquininha)

**Files:**
- Create: `public/js/components/{pagamentoDialog,qrDialog}.js`, `public/js/views/configuracoes.js`

- [ ] **Step 1:** Modal de pagamento conforme `docs/interface.md`: Crédito/Débito ("Siga as instruções na maquininha", **Cancelar cobrança**, resultado ✓/✕ com NSU/motivo, **Cobrei manualmente**), PIX (QR ≥ 280 px, valor, recebedor, contador de validade, **Copiar código**, **Confirmar recebimento**, **Cancelar**). Resultado vem pelo evento `pagamento`; fallback `GET /api/pagamentos/:id` a cada 2 s. Ao pagar: aviso "Pedido N pago" e nova comanda em branco.
- [ ] **Step 2:** `configuracoes.js` com abas Restaurante (nome, modelo da mensagem), PIX (cadastrar, ativar, **Testar** com QR de R$ 0,01), Maquininha (provedor `simulado`, tempo limite).
- [ ] **Step 3: Verificação manual (critério da Fase 3):** ler o QR PIX em 2 apps de banco diferentes e conferir valor e recebedor; testar aprovado, recusado e tempo esgotado com o terminal simulado.
- [ ] **Step 4: Commit** `feat: telas de pagamento e configurações`.

### Task 19: Andon: serviço e listener da rede local

**Files:**
- Create: `src/application/CozinhaService.js`, `src/presentation/http/controllers/CozinhaController.js`, `test/cozinha.test.js`, `test/lan.test.js`
- Modify: `src/presentation/http/HttpServer.js` (opções `host`, `port`, `rotasPermitidas`, `apenasNivel`), `EventController.js` (filtrar por nível), `compositionRoot.js` (iniciar o segundo listener em `rede.porta_local`), `test/helpers/createTestApp.js` (`requestLan`)

**Interfaces:**
- Produces:
  - `CozinhaService.listar() → Cartao[]` ordenados por `enviado_em`; `Cartao = { envioId, pedidoId, numeroDia, tipo, mesa?, cliente?, rodada, enviadoEm, situacao, observacaoPedido?, itens: [{ nome, quantidade, remover: string[], adicionar: [{ nome, quantidade }], observacao?, cancelado }], cancelado, motivoCancelamento? }` (sem preços)
  - `CozinhaService.acao(user, envioId, 'iniciar'|'pronto'|'entregue'|'desfazer') → Cartao`
  - Rotas `GET /api/cozinha`, `POST /api/cozinha/envios/:id`, `GET /api/cozinha/endereco` (A/B); evento `cozinha` `{ envioId, pedidoId, cozinhaSituacao, novo }`.

- [ ] **Step 1: Testes em `test/cozinha.test.js`**: `listar devolve NA_FILA, EM_PREPARO e PRONTO por ordem de envio`; `cartão traz SEM/+ e observação do item e do pedido, sem nenhum preço`; `itens de categoria que não vai à cozinha não aparecem`; `iniciar → pronto → entregue; transição inválida → 409`; `desfazer até 10 s volta a etapa; com 11 s → 409`; `pedido cancelado: cartão com cancelado=true por 60 s e depois some`; `item cancelado aparece com cancelado=true`; `entregue sai da lista`; `nível C pode agir; evento "cozinha" tem novo=true na criação da rodada`.
- [ ] **Step 2: Testes em `test/lan.test.js`** (`requestLan`): `login de nível C pela rede → 200`; `login de nível A ou B pela rede → 403`; `C na rede em /api/pedidos, /api/usuarios, /api/cardapio e /api/pix/chaves → 404`; `GET /api/cozinha na rede → 200`; `/api/eventos na rede só entrega eventos "cozinha"`; `nível C na janela local (127.0.0.1) em /api/pedidos → 403`.
- [ ] **Step 3: Rodar** → FAIL. **Step 4: Implementar.** **Step 5: Rodar** → PASS.
- [ ] **Step 6: Commit** `feat: andon da cozinha e listener restrito da rede local`.

### Task 20: Tela do andon, janela no segundo monitor e endereço do tablet

**Files:**
- Create: `public/js/views/andon.js`, `src/desktop/AndonWindow.js`
- Modify: `public/style.css` (modo andon sempre escuro), `public/js/views/configuracoes.js` (aba Cozinha), `electron-main.js` (item de menu **Andon**), `test/cozinha.test.js` (endereço)

**Interfaces:**
- Produces: `GET /api/cozinha/endereco → { url, qrSvg }` com o IPv4 privado da máquina e a porta `rede.porta_local` (função `os.networkInterfaces` injetável); `AndonWindow.abrir(displayId?)` (kiosk, `powerSaveBlocker`, id do monitor salvo nas preferências).

- [ ] **Step 1: Teste**: `endereco devolve http://<ipv4 privado>:8420/andon e um QR em SVG` (interfaces falsas).
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** o endpoint.
- [ ] **Step 4: Implementar a tela** conforme `docs/interface.md` ("Andon da cozinha"): três colunas (abas com contador em tablet vertical), cartão por rodada ("#37 · Mesa 4 · 2ª rodada"), faixa amarela da observação do pedido, **SEM** vermelho, **+** verde, observação do item, cronômetro verde/amarelo/vermelho (10/20 min), botão de avanço ≥ 56 px, **Desfazer** por 10 s, cartão cancelado vermelho, faixa "Sem conexão", som de aviso no evento `novo` (ligar/desligar), sem navegação para fora. Aba **Cozinha** em Configurações: endereço, QR, alerta/crítico, som, `cozinha.enviar_em`.
- [ ] **Step 5: Verificação manual (critério da Fase 3b):** abrir o andon na janela do segundo monitor e num tablet/celular no mesmo Wi-Fi com usuário C; enviar rodada → aparece nos dois em < 2 s; avançar até "Entregue" num dispositivo atualiza o outro; cancelar item/pedido aparece em vermelho; o tablet não abre nenhuma outra URL.
- [ ] **Step 6: Commit** `feat: tela do andon, janela dedicada e acesso por tablet`.

### Task 21: Fila de espera e aviso (Mensageiro simulado)

**Files:**
- Create: `src/domain/phone.js`, `src/application/ports/Mensageiro.js`, `src/infrastructure/whatsapp/MensageiroSimulado.js`, `src/infrastructure/repositories/FilaRepository.js`, `src/application/FilaService.js`, `src/presentation/http/controllers/FilaController.js`, `test/fila.test.js`
- Modify: `src/application/MesaService.js` (receber `sugerirFila` e devolver `sugestaoFila` em `liberar`), `compositionRoot.js`

**Interfaces:**
- Produces:
  - `normalizarTelefone(texto) → '+55DDDNÚMERO'` (lança `ValidationError`)
  - `Mensageiro`: `estado() → 'DESCONECTADO'|'AGUARDANDO_QR'|'CONECTANDO'|'CONECTADO'`; `enviar({ telefoneE164, texto }) → Promise<{ id }>` (lança `MensageiroError` com `code`); `on('estado'|'qr', fn)`. `MensageiroSimulado` guarda `enviadas[]` e aceita `falharProxima(code)`.
  - `FilaService.entrar(user, { clienteNome, telefone, pessoas, observacao? })`, `listar()`, `sugerir(mesa) → Fila|null`, `chamar(user, filaId, mesaId)`, `chamadoManual(user, filaId, mesaId)`, `sentar|desistir|naoCompareceu(user, filaId)`, `anonimizarAntigos()` (telefone nulo após 30 dias). Rotas de `docs/api.md` seção Mesas e fila; eventos `fila` e `mesa`.

- [ ] **Step 1: Testes**: telefone — `"(11) 99999-8888", "+55 11 99999-8888", "11999998888" e "011999998888" → "+5511999998888"`; `"99998888" (sem DDD), "123" e "abc" → ValidationError`; fila — `listar ordena por entrou_em`; `sugerir devolve o primeiro AGUARDANDO com pessoas ≤ capacidade`; `chamar envia o texto com {nome},{mesa},{restaurante},{tolerancia} substituídos, deixa a mesa RESERVADA, o cliente CHAMADO e registra mensagens_whatsapp ENVIADA`; `falha no envio: cliente continua AGUARDANDO, mensagem FALHOU, resposta 502 com code`; `chamadoManual segue o fluxo sem enviar`; `sentar → mesa OCUPADA`; `naoCompareceu → mesa LIVRE`; `listar marca atrasado após 10 min do chamado`; `anonimizarAntigos apaga telefone com mais de 30 dias`; `entrar e liberar mesa não enviam nenhuma mensagem (enviadas.length = 0)`; `liberar mesa devolve sugestaoFila`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat: fila de espera e chamada de clientes`.

### Task 22: Telas de fila e integração com mesas

**Files:**
- Create: `public/js/views/fila.js`
- Modify: `public/js/views/mesas.js`

- [ ] **Step 1:** `fila.js`: lista em ordem de chegada com cronômetro de tolerância (destaque após 10 min), formulário de entrada (nome, telefone com máscara, pessoas), ações Chamar (confirma antes de enviar) / Chamei de outra forma / Sentou / Desistiu / Não compareceu; erro de envio exibido com o motivo. `mesas.js`: ao liberar uma mesa, abre a sugestão do primeiro da fila que cabe.
- [ ] **Step 2: Verificação manual (critério da Fase 4):** liberar mesa sugere o primeiro que cabe; tolerância destaca; falha simulada do mensageiro mantém o cliente aguardando.
- [ ] **Step 3: Commit** `feat: telas de fila de espera`.

### Task 23: WhatsApp real (whatsapp-web.js)

**Files:**
- Create: `src/infrastructure/whatsapp/{WhatsAppWebMensageiro,criarClienteWhatsApp,detectarNavegador}.js`, `src/presentation/http/controllers/WhatsAppController.js`, `test/whatsapp.test.js`, `.npmrc` (`puppeteer_skip_download=1`)
- Modify: `compositionRoot.js`, `electron-main.js` (iniciar depois da janela abrir, `destroy()` ao sair), `electron-builder.config.js` (incluir/descompactar o necessário), `public/js/views/configuracoes.js` (aba WhatsApp), `public/js/main.js` (indicador no topo)

**Interfaces:**
- Produces: `WhatsAppWebMensageiro({ criarCliente, relogio, bus, timeoutMs = 20000 })` cumprindo a porta `Mensageiro`, mais `iniciar()`, `parar()`, `qrAtual()`; `criarCliente() → { on, initialize, sendMessage, getNumberId, destroy }`; `detectarNavegador({ existe }) → caminho do msedge.exe|null`. Rotas `GET /api/whatsapp/estado`, `POST /api/whatsapp/conectar|desconectar|teste` (só A); evento `whatsapp` `{ estado, qr? }` (QR só para nível A).

- [ ] **Step 1: Testes com cliente falso**: `evento qr → AGUARDANDO_QR e publica o QR`; `ready → CONECTADO`; `enviar usa getNumberId com 55DDDNÚMERO e envia para o id devolvido`; `número sem WhatsApp (getNumberId nulo) → MensageiroError NUMERO_SEM_WHATSAPP`; `sem resposta em 20 s → TIMEOUT`; `enviar desconectado → NAO_CONECTADO`; `disconnected → DESCONECTADO e nova tentativa em 5 s, 10 s, 20 s… até 60 s`; `parar chama destroy`; `detectarNavegador escolhe o Edge em Program Files (x86)/Program Files e devolve null se não houver`; `o evento com QR não chega a usuários nível B ou C`.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar** (`npm i whatsapp-web.js`; `LocalAuth` com `dataPath` em `%APPDATA%\pdv-restaurante\whatsapp-session`; `puppeteer.executablePath` = Edge detectado, configurável).
- [ ] **Step 4: Rodar** `npm test` → PASS.
- [ ] **Step 5: Verificação manual (critério da Fase 5):** em Configurações → WhatsApp ler o QR com o celular do restaurante; **Enviar teste** chega em < 10 s; chamar um cliente da fila de verdade; desligar o Wi-Fi do computador e conferir que a fila continua funcionando com "Chamei de outra forma".
- [ ] **Step 6: Commit** `feat: integração real com WhatsApp`.

### Task 24: Verificação de aceite das Fases 0–5

**Files:**
- Modify: `docs/README.md` (campo **Situação**), `docs/roadmap.md` (marcar fases entregues)

- [ ] **Step 1:** `npm test` completo → tudo verde.
- [ ] **Step 2:** Percorrer os critérios de aceite das Fases 0, 1, 2, 3, 3b, 4 e 5 em `docs/roadmap.md` e anotar o resultado de cada um.
- [ ] **Step 3:** `npm run dist`; instalar o `.exe` numa máquina limpa; confirmar que o banco fica em `%APPDATA%\pdv-restaurante` e sobrevive à reinstalação.
- [ ] **Step 4:** Atualizar a situação nos docs e **Commit** `docs: fases 0–5 concluídas`.

**Fora deste plano:** Fase 6 (app Android "PDV Cobrança" na Moderninha Smart; depende da resposta do PagBank, pendência P11) e Fase 7 (acabamento restante), a planejar depois.
