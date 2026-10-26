# API HTTP

JSON sobre HTTP, consumida apenas pela interface do próprio sistema. Servida em `127.0.0.1`; na rede local só as rotas marcadas
com 🌐 (andon no tablet e Moderninha Smart), ver [Arquitetura → Segurança](arquitetura.md#segurança).
Autenticação por cookie de sessão `sid` (`HttpOnly; SameSite=Strict`). Erros: `{ "error": "mensagem", "code": "CODIGO" }` com o status
adequado (400 validação, 401 não autenticado, 403 sem permissão, 404, 409 conflito de situação, 429 muitas tentativas, 502 serviço externo, 500).
Valores monetários em **centavos** (inteiros); datas `AAAA-MM-DD`; data/hora ISO 8601.

**Acesso:** `todos` = Administrador e Atendente (o nível C, Cozinha, só acessa as rotas indicadas em [Cozinha](#cozinha-andon)); `A` = somente Administrador. Enquanto a senha provisória não for trocada, só `/api/me` e `/api/me/senha` respondem.

## Acesso

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/login` | público | `{usuario, senha}` |
| POST | `/api/logout` | público | encerra a sessão |
| GET | `/api/me` | todos | usuário logado |
| POST | `/api/me/senha` | todos | `{atual, nova}` |

## Cardápio

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/cardapio` | todos | categorias ativas + pratos ativos + ingredientes padrão + adicionais disponíveis (tudo que a tela de pedido precisa, numa chamada) |
| GET/POST | `/api/categorias` | todos / A | listar / criar `{nome, ordem}` |
| PUT/DELETE | `/api/categorias/:id` | A | alterar / excluir (409 se em uso) |
| GET/POST | `/api/ingredientes` | todos / A | listar / criar `{nome, precoAdicionalCents, podeSerAdicional}` |
| PUT/DELETE | `/api/ingredientes/:id` | A | alterar / excluir (409 se em uso → desativar) |
| GET/POST | `/api/pratos` | todos / A | listar / criar `{nome, codigo, categoriaId, descricao, precoCents, ingredientes:[{ingredienteId, removivel, quantidade}]}` |
| PUT/DELETE | `/api/pratos/:id` | A | alterar / excluir (409 se já pedido → desativar) |
| PUT/DELETE | `/api/pratos/:id/foto` | A | `{foto: "data:image/...;base64,..."}` até 300 KB / remover |

## Pedidos

Pedido da lanchonete: `ABERTO` (rascunho) → `RECEBIDO` → `EM_PREPARO` → `PRONTO_RETIRADA`/`PRONTO_ENTREGA` → `FINALIZADO`; `CANCELADO` com motivo. As escritas respondem 200 com o `Pedido` completo (itens e histórico). Erros: 400 (validação), 403 (nível), 404, 409 (transição inválida, estoque insuficiente). A autorização é decidida pelo serviço.

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/pedidos` | A, B | filtros `de`, `ate` (AAAA-MM-DD válidos, `de <= ate`; padrão: hoje), `status`, `q` (nº, parte do nome sem distinguir acento/caixa, ou dígitos do telefone; até 80 caracteres; se repetido vale o último), `limite` (1–1000); **ordem por `id` crescente** |
| GET | `/api/pedidos/:id` | A, B | pedido com itens e histórico |
| POST | `/api/pedidos` | A, B | cria rascunho: `{cliente?: {nome, telefone}, itens: [ItemInput] (até 100), observacao?}` |
| PUT | `/api/pedidos/:id` | A, B | atualiza o rascunho (só `ABERTO`; 409 nos demais) |
| POST | `/api/pedidos/:id/confirmar` | A, B | `ABERTO → RECEBIDO`; exige cliente (nome e telefone) e itens; baixa o estoque das bebidas (409 se faltar saldo) |
| POST | `/api/pedidos/:id/reabrir` | A, B | `RECEBIDO → ABERTO`; estorna o estoque |
| POST | `/api/pedidos/:id/cancelar` | A, B | `{motivo}` (texto, até 200 caracteres) |
| POST | `/api/pedidos/:id/status` | A, B, C | `{status: "EM_PREPARO"|"PRONTO_RETIRADA"|"PRONTO_ENTREGA"|"FINALIZADO"}`; quem pode cada mudança é decidido pelo serviço (403 se não puder) |
| GET | `/api/pedidos.csv` | A, B | exportação com os mesmos filtros; colunas: Nº, Data (`dd/mm/aaaa`), Hora (`hh:mm`), Cliente, Telefone, Itens, Total (R$), Tempo estimado (min), Status |

`ItemInput`:
```json
{ "tipo": "PRATO" | "BEBIDA", "itemId": 12, "quantidade": 1, "observacao": "sem cebola" }
```
Preços, totais e nomes enviados no corpo são ignorados; o servidor usa o cardápio atual. Corpo ausente ou que não seja um objeto JSON → 400. Ids de rota devem ser inteiros positivos (senão 400). Foram removidas as rotas de mesa/comanda (`itens`, `enviar-cozinha`, `mover`, `finalizar`, `desconto`, `itens/:id/cancelar`, `/api/mesas/:id/comanda`).

## Pagamentos

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/pedidos/:id/pagamentos` | todos | `{forma: "CREDITO"|"DEBITO"|"PIX"}` → `202 {pagamentoId, situacao:"PENDENTE", pix?:{payload, qrSvg, expiraEm}}` |
| POST | `/api/pedidos/:id/pagamentos/manual` | todos | contingência: `{forma, nsu?, observacao}` → aprovado com `manual=1` |
| GET | `/api/pagamentos/:id` | todos | situação atual (fallback do SSE) |
| POST | `/api/pagamentos/:id/cancelar` | todos | cancela cobrança pendente (maquininha ou PIX) |
| POST | `/api/pagamentos/:id/confirmar-pix` | todos | atendente confirma o recebimento do PIX |

## Cozinha

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/cozinha` | A, B, C | pedidos em `RECEBIDO`, `EM_PREPARO`, `PRONTO_RETIRADA` e `PRONTO_ENTREGA`, na ordem de confirmação |
| POST | `/api/pedidos/:id/status` | A, B, C | muda o status operacional (ver Pedidos); a cozinha (C) só avança `RECEBIDO → EM_PREPARO → PRONTO_*` |

O nível **C (Cozinha)** só acessa estas rotas, `/api/eventos` e as rotas de acesso (`/api/me`, `/api/logout`).

## Terminal (Moderninha Smart) 🌐

Autenticação por cabeçalho `Authorization: Bearer <token do terminal>` (gerado no pareamento), não por cookie.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/terminal/cobrancas/proxima` | próxima cobrança pendente para este terminal `{pagamentoId, valorCents, forma}` ou `204` |
| POST | `/terminal/cobrancas/:id` | resultado `{situacao, nsu, autorizacao, bandeira, mensagem}` (idempotente) |
| GET | `/terminal/cobrancas/:id/cancelamento` | `{cancelar: bool}` — o app consulta durante a cobrança para saber se deve chamar `abort()` |

## Mesas e fila

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/mesas` | todos | mesas com situação e pedido em aberto |
| POST/PUT/DELETE | `/api/mesas[/:id]` | A | cadastro `{numero, capacidade, ativo}` |
| POST | `/api/mesas/:id/liberar` | todos | `→ LIVRE`; resposta inclui `sugestaoFila` (primeiro que cabe) |
| POST | `/api/mesas/:id/ocupar` | todos | `→ OCUPADA` |
| GET | `/api/fila` | todos | clientes `AGUARDANDO`/`CHAMADO` em ordem de chegada |
| POST | `/api/fila` | todos | `{clienteNome, telefone, pessoas, observacao}` |
| POST | `/api/fila/:id/chamar` | todos | `{mesaId}` → envia o WhatsApp; `502` com `code` se falhar (cliente continua aguardando) |
| POST | `/api/fila/:id/chamado-manual` | todos | `{mesaId}` → segue o fluxo sem WhatsApp |
| POST | `/api/fila/:id/sentar` · `/desistir` · `/nao-compareceu` | todos | encerra o atendimento da fila |

## Configurações (A)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/PUT | `/api/config` | restaurante, modelo de mensagem, tolerância, validade do PIX, tempo limite da maquininha, andon (`enviarEm`, `alertaMin`, `criticoMin`, `som`) |
| GET/POST | `/api/pix/chaves` | listar / criar `{tipo, chave, nomeRecebedor, cidade}` |
| POST | `/api/pix/chaves/:id/ativar` | ativa (desativa as outras) |
| POST | `/api/pix/chaves/:id/teste` | gera QR Code de R$ 0,01 para conferência |
| GET | `/api/whatsapp/estado` | estado + QR de pareamento (se aguardando) |
| POST | `/api/whatsapp/conectar` · `/desconectar` | inicia / encerra a sessão |
| POST | `/api/whatsapp/teste` | `{telefone}` envia mensagem de teste |
| GET/PUT | `/api/maquininha` | provedor e configuração (segredos nunca voltam na resposta) |
| POST | `/api/maquininha/teste` | cobrança de teste no modo simulado ou verificação de conexão do provedor |

## Gestão (A)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/POST/PUT/DELETE | `/api/usuarios[/:id]` | cadastro de usuários; `POST /api/usuarios/:id/resetar-senha` |
| GET | `/api/auditoria` | filtros `de`, `ate`, `usuario`, `entidade`, `q` |
| GET | `/api/backup` | baixa cópia do banco (`VACUUM INTO`) |

## Eventos (SSE)

`GET /api/eventos` (todos) — `text/event-stream`:

| Evento | Dados |
| --- | --- |
| `pedido` | `{id, situacao}` — criado/alterado |
| `pagamento` | `{id, pedidoId, situacao, mensagem}` |
| `mesa` | `{id, situacao}` |
| `fila` | `{id, situacao}` |
| `whatsapp` | `{estado, qr?}` (QR só para nível A) |
| `cozinha` | `{envioId, pedidoId, cozinhaSituacao, novo: bool}` — o andon recarrega o cartão e toca o aviso quando `novo` |

O nível C recebe apenas eventos `cozinha`.
