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

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/pedidos` | todos | filtros `de`, `ate`, `situacao`, `forma`, `mesaId`, `atendenteId`, `q`; **ordem por `id` crescente**; máx. 1000 |
| GET | `/api/pedidos/:id` | todos | pedido com itens, modificações e pagamentos |
| POST | `/api/pedidos` | todos | cria em aberto: `{tipo: "BALCAO"|"MESA", mesaId?, clienteNome?, observacao?, itens:[ItemInput]}`; 409 se a mesa já tiver comanda aberta |
| PUT | `/api/pedidos/:id` | todos | substitui os itens **pendentes de envio** e a identificação (só `ABERTO`) |
| POST | `/api/pedidos/:id/itens` | todos | acrescenta itens pendentes a uma comanda `{itens:[ItemInput]}` |
| POST | `/api/pedidos/:id/enviar-cozinha` | todos | cria a próxima rodada com os itens pendentes (comanda de mesa) |
| POST | `/api/pedidos/:id/itens/:itemId/cancelar` | todos | `{motivo}` cancela item já enviado |
| POST | `/api/pedidos/:id/mover` | todos | `{mesaId}` troca a comanda de mesa (destino livre) |
| POST | `/api/pedidos/:id/finalizar` | todos | balcão: finalizar · mesa: fechar conta. `ABERTO → AGUARDANDO_PAGAMENTO`; 409 se houver itens pendentes de envio na comanda; recalcula e devolve o total |
| GET | `/api/mesas/:id/comanda` | todos | comanda aberta da mesa (404 se não houver) |
| POST | `/api/pedidos/:id/reabrir` | todos | `AGUARDANDO_PAGAMENTO → ABERTO` (409 se houver pagamento pendente) |
| POST | `/api/pedidos/:id/desconto` | A | `{descontoCents}` |
| POST | `/api/pedidos/:id/cancelar` | todos* | `{motivo}` (*pedido pago: só A) |
| GET | `/api/pedidos.csv` | todos | exportação com os mesmos filtros |

`ItemInput`:
```json
{ "pratoId": 12, "quantidade": 1, "observacao": "bem passado",
  "remover": [3, 7],
  "adicionar": [{ "ingredienteId": 9, "quantidade": 2 }] }
```
Preços enviados pela interface são ignorados; o servidor usa o cardápio atual e grava o retrato.

## Pagamentos

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/pedidos/:id/pagamentos` | todos | `{forma: "CREDITO"|"DEBITO"|"PIX"}` → `202 {pagamentoId, situacao:"PENDENTE", pix?:{payload, qrSvg, expiraEm}}` |
| POST | `/api/pedidos/:id/pagamentos/manual` | todos | contingência: `{forma, nsu?, observacao}` → aprovado com `manual=1` |
| GET | `/api/pagamentos/:id` | todos | situação atual (fallback do SSE) |
| POST | `/api/pagamentos/:id/cancelar` | todos | cancela cobrança pendente (maquininha ou PIX) |
| POST | `/api/pagamentos/:id/confirmar-pix` | todos | atendente confirma o recebimento do PIX |

## Cozinha (andon)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET 🌐 | `/api/cozinha` | todos | rodadas com `vai_para_cozinha = 1` em `NA_FILA`, `EM_PREPARO`, `PRONTO` (+ canceladas nos últimos 60 s), ordenadas por `enviado_em`; com nº do pedido, mesa/cliente, rodada, itens (cancelados marcados), personalizações e observações, **sem preços** |
| POST 🌐 | `/api/cozinha/envios/:id` | todos | `{acao: "iniciar"|"pronto"|"entregue"|"desfazer"}`; 409 se a transição não for válida |
| GET | `/api/cozinha/endereco` | A, B | endereço e QR Code para abrir o andon no tablet |

O nível **C (Cozinha)** só acessa estas rotas, `/api/eventos` e as rotas de acesso (`/api/me`, `/api/logout`). Login, logout, `/api/me` e `/api/eventos` também são 🌐.

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
