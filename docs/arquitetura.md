# Arquitetura

Aplicação Node.js em **camadas**, empacotada como app de desktop (Electron), seguindo o mesmo modelo do CCP.
O Electron sobe o servidor HTTP local numa porta livre em `127.0.0.1` e abre uma janela apontando para ele.
Um segundo listener, restrito, atende a rede local para o tablet do andon e para a Moderninha Smart ([Segurança](#segurança)).
O mesmo código roda no navegador com `npm start`, o que facilita o desenvolvimento e os testes.

```
┌────────────────────┐   HTTP/JSON    ┌──────────────────────────────────────────────────────────┐
│ Interface (SPA)    │ ─────────────▶ │ presentation   HttpServer, Router, controllers           │
│ public/js          │ ◀───────────── │ application    serviços / casos de uso                    │
│                    │   SSE (eventos)│ domain         regras puras, cálculo, validação, erros    │
└────────────────────┘                │ infrastructure SQLite, repositórios, adaptadores externos │
                                      └───────────┬───────────────┬───────────────┬──────────────┘
                                                  │               │               │
                                          whatsapp-web.js   Maquininha (porta)  PIX BR Code + qrcode
```

## Tecnologias

| Item | Escolha | Motivo |
| --- | --- | --- |
| Runtime | Node.js ≥ 22.13 | `node:sqlite` embutido, `node:test` |
| Desktop | Electron + electron-builder + electron-updater | igual ao CCP: instalador por usuário e atualização automática |
| Banco | SQLite (`node:sqlite`) | requisito; arquivo local, sem servidor |
| Interface | HTML + CSS + JavaScript puro (ES modules), sem bundler | igual ao CCP; sem etapa de build |
| WhatsApp | `whatsapp-web.js` (Puppeteer) | requisito |
| QR Code | `qrcode` (npm) | gera SVG/PNG do BR Code no servidor |
| Testes | `node --test` | sem dependências extras |

Dependências de produção mínimas: `whatsapp-web.js`, `qrcode`, `electron-updater` + o SDK da maquininha escolhida (se houver).

## Camadas (dependências apontam para dentro)

| Camada | Pasta | Responsabilidade |
| --- | --- | --- |
| Domínio | `src/domain` | Regras puras: cálculo de item/pedido, transições de situação, validação de chave PIX, montagem do BR Code, CRC16, telefone E.164, dinheiro, erros |
| Aplicação | `src/application` | Casos de uso: `PedidoService`, `CozinhaService`, `PagamentoService`, `CardapioService`, `MesaService`, `FilaService`, `AuthService`, `ConfigService`, `AuditTrail` |
| Portas | `src/application/ports` | Contratos: `TerminalPagamento`, `Mensageiro`, `Relogio`, repositórios |
| Infraestrutura | `src/infrastructure` | `SqliteDatabase`, repositórios, `WhatsAppWebMensageiro`, adaptadores de maquininha, gerador de QR Code, backup, segurança |
| Apresentação | `src/presentation/http` | `HttpServer`, `Router`, controladores, arquivos estáticos, canal de eventos (SSE) |
| Composição | `src/compositionRoot.js` | Único lugar que instancia as classes concretas e as injeta |
| Desktop | `electron-main.js`, `src/desktop` | Janela, pasta de dados, atualizador, backup diário, ciclo de vida do WhatsApp |

Princípios (os mesmos do CCP): uma classe por arquivo; responsabilidade única (validar, autorizar, persistir, orquestrar,
traduzir HTTP e auditar são classes diferentes); integrações externas sempre atrás de uma **porta**, com implementação
**simulada** para desenvolvimento e testes.

## Estrutura de pastas

```
restaurante/
├─ electron-main.js
├─ electron-builder.config.js
├─ package.json
├─ public/                      # interface (SPA)
│  ├─ index.html
│  ├─ style.css                 # tokens de cor (azul-escuro), claro/escuro
│  ├─ img/
│  └─ js/
│     ├─ main.js  api.js  state.js  ui.js  theme.js  format.js  icons.js  events.js
│     ├─ components/            # grid, filterDialog, confirmDialog, qrDialog, ingredientePicker
│     └─ views/                 # pedidoNovo, pedidos, andon, mesas, fila, pratos, ingredientes, categorias,
│                               # configuracoes, usuarios, auditoria, sobre, login
├─ src/
│  ├─ server.js
│  ├─ compositionRoot.js
│  ├─ domain/                   # pedido/, pagamento/, pix/, cardapio/, fila/, money.js, phone.js, errors/
│  ├─ application/              # *Service.js, ports/
│  ├─ infrastructure/
│  │  ├─ database/              # SqliteDatabase.js, migrations.js
│  │  ├─ repositories/
│  │  ├─ whatsapp/              # WhatsAppWebMensageiro.js, MensageiroSimulado.js
│  │  ├─ pagamento/             # TerminalSimulado.js, Terminal<Provedor>.js
│  │  ├─ pix/                   # QrCodeGenerator.js
│  │  ├─ security/              # PasswordHasher, SessionStore, LoginThrottle, SecretBox
│  │  └─ backup/
│  ├─ presentation/http/
│  └─ desktop/
├─ test/                        # *.test.js (node --test)
├─ scripts/
└─ docs/
```

## Fluxo de uma requisição

1. `HttpServer` lê o cookie de sessão → `AuthService.resolveUser`.
2. Autorização pelas opções da rota (`public`, `nivel: 'A'`, `allowMustChange`).
3. Controlador valida o formato da entrada e chama o serviço passando `ctx.user`.
4. Serviço aplica as regras do domínio, grava pelos repositórios **numa transação** e registra a auditoria.
5. Erros de negócio (`AppError` e filhas) viram resposta HTTP com o status da exceção; o resto vira `500` genérico (detalhe só no log).

## Operações longas: cobrança e WhatsApp

A cobrança na maquininha pode levar até 2 minutos (cliente digitando a senha). Para não prender a requisição:

1. `POST /api/pedidos/:id/pagamentos` cria o pagamento `PENDENTE` e responde `202` imediatamente.
2. O `PagamentoService` chama o adaptador em segundo plano, com tempo limite.
3. O resultado atualiza o pagamento e o pedido numa transação e publica um evento no **canal SSE** (`GET /api/eventos`).
4. A interface escuta o canal e troca a tela de "aguardando maquininha" pelo resultado. Se o SSE cair, ela consulta
   `GET /api/pagamentos/:id` a cada 2 s.

Os eventos SSE também atualizam a lista de pedidos, o andon da cozinha, o mapa de mesas e o estado do WhatsApp (conectado, aguardando QR, desconectado).

**Recuperação:** ao iniciar, pagamentos `PENDENTE` de execuções anteriores são consultados no adaptador (se ele suportar) ou marcados
`EXPIRADO` com aviso para o atendente conferir a maquininha. Nunca são marcados como aprovados sem confirmação.

## Segurança

- **Dois listeners:**
  - `127.0.0.1` (porta livre): o sistema completo, usado só pela janela do próprio computador.
  - **Rede local** (porta `rede.porta_local`, padrão 8420): atende **apenas** uma lista fechada de rotas — a página e os arquivos do andon,
    `/api/login`, `/api/logout`, `/api/me`, `/api/cozinha*`, `/api/eventos` (filtrado para eventos `cozinha`) e `/terminal/*`
    (Moderninha Smart, com token por terminal gerado no pareamento, ver [Integrações](integracoes.md)). Qualquer outra rota responde 404.
    Na rede local só fazem login usuários nível **C**. O instalador cria a regra no firewall do Windows só para redes privadas.
  - A rede local trafega em HTTP sem criptografia (proposta, aceitável dentro do Wi-Fi do restaurante): por isso nada de preços, pagamentos
    ou dados de clientes passa por ela além do nome/mesa no cartão do andon. Recomendar Wi-Fi da equipe separado do Wi-Fi dos clientes.
- A janela Electron bloqueia navegação externa; `contextIsolation` ligado e `nodeIntegration` desligado.
- Senhas com scrypt + sal; sessão em memória com cookie `HttpOnly; SameSite=Strict`; bloqueio após 3 falhas por 5 min.
- Toda rota de escrita checa o nível no servidor.
- Valores de pedido e pagamento são **sempre recalculados no servidor**.
- Segredos de integração (tokens de API da maquininha) são cifrados com `safeStorage` do Electron (DPAPI do Windows) antes de irem para
  `configuracoes`; nunca aparecem em logs, auditoria ou backups em texto puro.
- Sessão do WhatsApp (`LocalAuth`) fica em `%APPDATA%\pdv-restaurante\whatsapp-session`, fora do banco e fora do backup.
- Telefones de clientes: dado pessoal (LGPD); finalidade única (aviso de mesa); anonimização após 30 dias.
- Arquivos estáticos não saem da pasta `public`; fotos validadas por assinatura (magic bytes).

## Desktop

- Instalador por usuário (sem pedir administrador), atalho no menu Iniciar, atualização automática pelo `electron-updater`.
- Dados em `%APPDATA%\pdv-restaurante\` (banco, sessão do WhatsApp, logs). Backup diário em `Documentos\PDV Restaurante Backups`.
- Ao fechar a janela, o sistema encerra o cliente do WhatsApp de forma limpa (`client.destroy()`) para não corromper a sessão.
- **Janela do andon:** segunda `BrowserWindow` em tela cheia (`kiosk`) apontando para `/#/andon`, aberta no monitor escolhido
  (`screen.getAllDisplays()`; o id do monitor fica salvo nas preferências). Usa uma sessão própria restrita ao nível C, para que fechar
  ou deslogar a janela principal não derrube o andon. O computador não entra em descanso de tela enquanto ela estiver aberta
  (`powerSaveBlocker`).
- Uma única instância por computador (`app.requestSingleInstanceLock()`), porque o WhatsApp não aceita duas sessões no mesmo perfil.

## Testes

| Tipo | Cobre |
| --- | --- |
| Unidade (domínio) | cálculo de item/pedido com adicionais e remoções; transições de situação; BR Code (comparado com exemplos oficiais do Bacen) e CRC16; validação de chave PIX; telefone E.164 |
| Serviço | `PedidoService`, `CozinhaService` (entrada no andon conforme `cozinha.enviar_em`, transições, desfazer, itens que não vão à cozinha), `PagamentoService` (aprovado, recusado, tempo esgotado, contingência, recuperação), `FilaService` com `MensageiroSimulado` e `TerminalSimulado` |
| HTTP | rotas com banco `:memory:`: permissões por nível, 401/403/409, total recalculado no servidor |
| Manual (checklist de homologação) | maquininha real, WhatsApp real com número de teste, leitura do QR Code PIX em 2 apps de banco |

Comando: `npm test`. Relógio injetável (`Relogio`) para testar tolerância da fila, expiração do PIX e numeração diária.
