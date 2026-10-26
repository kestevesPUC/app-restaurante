# Integrações

As três integrações ficam atrás de **portas** (interfaces) na camada de aplicação. Cada porta tem uma implementação
**simulada**, usada em desenvolvimento, nos testes e como demonstração, e uma ou mais implementações reais.
O provedor ativo é escolhido em Configurações e injetado pelo `compositionRoot`.

## 1. WhatsApp — `whatsapp-web.js`

### Como funciona

`whatsapp-web.js` controla uma sessão do **WhatsApp Web** por meio de um navegador Chromium automatizado (Puppeteer).
O restaurante pareia o número uma única vez, lendo um QR Code com o celular (WhatsApp → Aparelhos conectados).

### Porta

```js
// src/application/ports/Mensageiro.js
// estado(): 'DESCONECTADO' | 'AGUARDANDO_QR' | 'CONECTANDO' | 'CONECTADO'
// enviar({ telefoneE164, texto }) → Promise<{ id }>   (lança MensageiroError com código)
// WhatsAppWebMensageiro ainda expõe iniciar(), parar(), qrAtual() e numeroConectado()
```

Implementações: `WhatsAppWebMensageiro` (real) e `MensageiroSimulado` (grava em memória/log).

### Detalhes de implementação

- `new Client({ authStrategy: new LocalAuth({ dataPath }), puppeteer: { executablePath, headless: true, args: ['--no-sandbox'] } })`,
  criado só em `criarClienteWhatsApp` (o pacote é carregado sob demanda; testes nunca o carregam).
- **Navegador:** o **Microsoft Edge** já instalado (`detectarNavegador` procura `msedge.exe` em `%ProgramFiles(x86)%` e `%ProgramFiles%`;
  a configuração `whatsapp.navegador` pode apontar outro caminho). O Chromium **não** é baixado (`.npmrc`: `puppeteer_skip_download=1`).
  Sem o Edge, `iniciar()` não é chamado: o estado fica `DESCONECTADO` e `GET /api/whatsapp/estado` informa `erro: 'Navegador não encontrado'`.
- **Sessão:** `<userData>/whatsapp-session` (`%APPDATA%pdv-restaurantewhatsapp-session`), fora do banco, do backup e do instalador.
  O pareamento por QR é feito uma vez e sobrevive a reinicializações.
- O cliente é iniciado **depois** que a janela abre (não atrasa o sistema) e encerrado (`parar()`) ao sair do app.
- **Estados:** `DESCONECTADO` (inicial) → `CONECTANDO` → `AGUARDANDO_QR` (evento `qr`) → `CONECTADO` (`ready`). `auth_failure` e `disconnected`
  voltam a `DESCONECTADO`. Cada mudança é publicada no SSE (`whatsapp`); o QR só chega ao nível A.
- **Reconexão:** após `disconnected`, `auth_failure` ou falha ao abrir o navegador, nova tentativa após 5 s, 10 s, 20 s, 40 s e 60 s (depois, a cada 60 s);
  o contador reinicia ao conectar. `parar()` cancela a reconexão. Falhas são registradas no log e nunca derrubam o app.
- **Envio:** telefone normalizado para dígitos (`55DDDNÚMERO`), `client.getNumberId()` (sem WhatsApp → `NUMERO_SEM_WHATSAPP`), limite de 20 s
  (`TIMEOUT`), demais falhas `ERRO_ENVIO`; fora do estado `CONECTADO` → `NAO_CONECTADO`. Sem novas tentativas automáticas: o atendente decide reenviar.

### Riscos e cuidados

| Risco | Mitigação |
| --- | --- |
| A biblioteca **não é oficial**; o WhatsApp pode mudar o WhatsApp Web e quebrar o envio | Fixar a versão; testar antes de atualizar; falhas de envio ficam visíveis no histórico de notificações do pedido e podem ser reenviadas |
| Bloqueio do número por uso automatizado | Usar só para mensagens disparadas por clique e para clientes que deram o número; sem envio em massa; recomendar um número exclusivo do restaurante |
| Consumo de memória do navegador (~200–300 MB) | Uma única sessão; encerrar ao fechar o app |
| Alternativa oficial | Se a estabilidade virar problema, criar o adaptador `WhatsAppCloudApiMensageiro` (API oficial da Meta, paga por conversa) usando a mesma porta |

## 2. Maquininha de cartão

### Situação

Maquininha definida: **Moderninha Smart, do PagBank (PagSeguro)**. A integração será feita por um **app Android próprio** instalado
na maquininha (fluxo abaixo), implementado no desktop pelo adaptador `TerminalPagBankSmart`. Falta só a confirmação do PagBank
sobre a homologação ([Pendências](roadmap.md#pendências), P11). Até lá, e sempre que a maquininha falhar, valem o modo **simulado**
(desenvolvimento) e o **modo de contingência** manual.

### Moderninha PagBank: caminhos (pesquisa de out/2026, conferir com o PagBank antes de começar a fase 6)

| Modelo | Caminho | Avaliação |
| --- | --- | --- |
| **Moderninha Smart / Smart 2** (Android) ✔ **escolhido** | App Android próprio instalado na maquininha, usando a biblioteca oficial **PlugPagServiceWrapper**. O app recebe o pedido do sistema desktop pela rede local e dispara a cobrança no próprio terminal | **Caminho adotado.** Exige aprovação/homologação do app pelo PagBank e desenvolvimento em Android (Kotlin) |
| **Moderninha Pro / Wifi** | Biblioteca **PlugPag 1.x** para Windows, por Bluetooth | **Não recomendado:** a linha 1.x não recebe mais correções, e o repositório oficial avisa que novas integrações estão indisponíveis no momento |
| **Moderninha Plus, X, Minizinha** e outras | Não há biblioteca oficial para Windows | Só a contingência manual |

**Fluxo proposto com a Moderninha Smart:**

```
PDV (Windows)                         Moderninha Smart (app "PDV Cobrança")
  │ POST /api/pedidos/:id/pagamentos       │
  │  → pagamento PENDENTE                  │
  │ ◀── app consulta a cada 1 s ────────── │  GET /terminal/cobrancas/proxima  (rede local, token do terminal)
  │ ──── {pagamentoId, valor, forma} ────▶ │  PlugPag.doPayment(valor, tipo, à vista, código = pagamentoId)
  │                                        │  cliente insere/aproxima o cartão e digita a senha
  │ ◀── POST /terminal/cobrancas/:id ───── │  {situacao, nsu, autorizacao, bandeira} ou erro
  │  → APROVADO / RECUSADO + evento SSE    │
```

Consequências para o projeto:
- O servidor passa a escutar **também na rede local**, mas **só** as rotas `/terminal/*`, protegidas por um token gerado no pareamento
  (QR Code exibido em Configurações → Maquininha e lido pelo app). Esse listener é o mesmo usado pelo tablet do andon, com lista fechada de rotas (ver [Arquitetura → Segurança](arquitetura.md#segurança)).
- O computador e a maquininha precisam estar no **mesmo Wi-Fi**, e o firewall do Windows precisa liberar a porta (o instalador cria a regra).
- O app Android é um **segundo projeto** (Kotlin), com publicação e atualização próprias.
- Cancelar pela tela do PDV: o app chama `abort()` do PlugPag. Recuperação após queda: o app guarda a última transação e reenvia o resultado ao reconectar.
- Implementação no desktop: `TerminalPagBankSmart` (fila de cobranças + rotas `/terminal/*`), sem alterar serviços e telas.

**App Android "PDV Cobrança"** (repositório separado, ex.: `restaurante-cobranca-android`):
- Kotlin, `minSdk` conforme a exigência do PlugPagServiceWrapper; uma única tela: estado da conexão, "Aguardando cobrança",
  valor e forma da cobrança em andamento, resultado.
- Pareamento: lê o QR Code de Configurações → Maquininha (endereço IP:porta do PDV + token) e guarda com criptografia do Android Keystore.
- Débito e crédito à vista; impressão da via do cliente conforme o padrão do PlugPag.
- Sem dados de cartão no app nem no PDV: só NSU, autorização, bandeira e situação.

Antes de começar a fase 6, **confirmar com o PagBank** (canal de desenvolvedores / comercial):
1. se o app próprio na Moderninha Smart está liberado para a conta do restaurante e quais são as etapas de homologação;
2. se existe hoje alguma API em nuvem para enviar uma cobrança a uma maquininha vinculada à conta. Se existir, ela substitui o app Android
   e simplifica muito a integração.

### Porta

```js
// src/application/ports/TerminalPagamento.js
// cobrar({ pagamentoId, valorCents, forma: 'CREDITO'|'DEBITO', descricao }) → Promise<ResultadoCobranca>
// cancelar(pagamentoId) → Promise<void>          // cancela uma cobrança ainda em andamento
// consultar(pagamentoId) → Promise<ResultadoCobranca | null>   // usado na recuperação após queda
// ResultadoCobranca = { situacao: 'APROVADO'|'RECUSADO'|'CANCELADO', nsu, autorizacao, bandeira, referenciaExterna, mensagem }
```

### Caminhos de integração possíveis

| Caminho | Como funciona | Exemplos | Observações |
| --- | --- | --- | --- |
| **API em nuvem do adquirente** | O sistema chama a API do fornecedor; a cobrança aparece na maquininha (POS Android/Smart) vinculada à conta | Mercado Pago Point (API de "payment intents"), Stone Connect, PagBank/PagSeguro Connect, Cielo LIO (Order Manager) | Exige internet, credenciais do lojista e homologação; resultado por consulta ou webhook (no desktop usaremos consulta periódica, pois não há endereço público) |
| **TEF** | Um software de TEF instalado no computador conversa com o pinpad/maquininha | SiTef (Software Express), PayGo, TEF Dial | Mais comum em varejo grande; tem custo de licença e homologação |
| **Pinpad USB/Bluetooth com SDK local** | SDK do fabricante no Windows | depende do fornecedor | Poucos fornecedores oferecem para Windows |
| **Contingência manual** | O atendente digita o valor na maquininha e confirma no sistema | qualquer maquininha | Sempre disponível; registrado como `manual = 1` |

Cada provedor vira uma classe `Terminal<Provedor>` em `src/infrastructure/pagamento/`, sem alterar serviços ou telas.

### Regras do adaptador

- Valor sempre em centavos, vindo do pedido gravado no servidor.
- Identificador externo = `pagamentoId` (idempotência: chamar `cobrar` duas vezes com o mesmo id não pode gerar duas cobranças).
- Tempo limite configurável (padrão 120 s). Ao estourar, tenta `cancelar`; se não conseguir confirmar o cancelamento, o pagamento fica
  `EXPIRADO` com aviso "Confira a maquininha antes de cobrar de novo".
- Credenciais cifradas com `safeStorage` (ver [Arquitetura → Segurança](arquitetura.md#segurança)).

## 3. PIX — BR Code estático com QR Code

### Porta e componentes

- `domain/pix/BrCode.js`: monta o texto do PIX Copia e Cola (função pura, testável).
- `domain/pix/crc16.js`: CRC16-CCITT-FALSE (polinômio `0x1021`, valor inicial `0xFFFF`).
- `infrastructure/pix/QrCodeGenerator.js`: gera o SVG com a biblioteca `qrcode` (correção de erro nível M).

### Montagem do BR Code (padrão EMV® QRCPS-MPM, Manual de Padrões para Iniciação do Pix — Bacen)

Cada campo é `ID (2 dígitos) + TAMANHO (2 dígitos) + VALOR`.

| ID | Campo | Valor |
| --- | --- | --- |
| `00` | Payload Format Indicator | `01` |
| `26` | Merchant Account Information | subcampos `00` = `br.gov.bcb.pix`, `01` = chave PIX |
| `52` | Merchant Category Code | `0000` |
| `53` | Moeda | `986` (BRL) |
| `54` | Valor | total com ponto decimal, ex. `57.90` |
| `58` | País | `BR` |
| `59` | Nome do recebedor | até 25 caracteres, maiúsculas sem acento |
| `60` | Cidade | até 15 caracteres, maiúsculas sem acento |
| `62` | Dados adicionais | subcampo `05` = `txid` (até 25 alfanuméricos), ex. `PED000123` |
| `63` | CRC16 | `6304` + 4 dígitos hexadecimais calculados sobre todo o texto anterior, incluindo `6304` |

Exemplo (estrutura): `000201` `26..0014br.gov.bcb.pix01..<chave>` `52040000` `5303986` `5405` `57.90` `5802BR` `59..<NOME>` `60..<CIDADE>` `62..05..PED000123` `6304XXXX`.

Regras:
- Telefone como chave: formato `+5511999998888`. CPF/CNPJ: só dígitos. E-mail: minúsculas. Aleatória: UUID com hífens.
- Remover acentos e caracteres fora de `[A-Z0-9 ]` de nome e cidade antes de montar.
- Testes de unidade comparam a saída com payloads de exemplo publicados pelo Bacen e validam o CRC.

### Confirmação

PIX estático **não notifica** o sistema. O atendente confere o recebimento no app/extrato do banco e clica **Confirmar recebimento**
(fica registrado quem confirmou). Evolução futura: adaptador de **PIX dinâmico** com API de um PSP (cobrança imediata `cob` com
`txid` e consulta de situação), que confirma sozinho. A porta já prevê isso:

```js
// src/application/ports/GeradorPix.js
// gerar({ pagamentoId, valorCents, txid }) → Promise<{ payload, expiraEm }>
// consultar(txid) → Promise<'PENDENTE'|'PAGO'|null>   // null = não suportado (PIX estático)
```
