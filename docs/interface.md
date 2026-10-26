# Interface

SPA em JavaScript puro (ES modules), sem bundler: `public/index.html` carrega `public/js/main.js`. Mesma linguagem visual e
de navegação do **CCP (JRP Engenharia)**: menu lateral escuro, área de conteúdo clara, cartões com cantos de 12 px, grid padrão
com barra de ferramentas, formulários em modal, avisos temporários e tema claro/escuro. A cor predominante passa a ser o **azul-escuro**.

## Identidade visual — tokens de cor

Mesma estrutura de tokens do `style.css` do CCP, trocando a família verde-petróleo por azul-escuro.

```css
:root{
  --bg:#f3f5f9;--surface:#ffffff;--surface-2:#f8fafc;--ink:#0f1b2d;--mute:#56667c;--line:#e2e8f0;--line-strong:#cbd5e1;
  --brand:#1e3a8a;--brand-ink:#ffffff;--brand-soft:#e3eafc;          /* botões principais, links, foco */
  --ok:#14703f;--ok-soft:#e3f5ea;--bad:#b42318;--bad-soft:#fdeceb;--warn:#9a5b00;--warn-soft:#fdf1dc;
  --side:#0b1f44;--side-ink:#b9c7e3;--side-on:#ffffff;--side-on-bg:#1d3a73;  /* menu lateral */
  --shadow:0 1px 2px rgba(15,27,45,.06),0 4px 14px rgba(15,27,45,.05);
  --radius:12px;--font:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
}
/* tema escuro */
  --bg:#0a1120;--surface:#111a2d;--surface-2:#16213a;--ink:#e8edf6;--mute:#9db0c8;--line:#22314b;--line-strong:#344665;
  --brand:#8fb0ff;--brand-ink:#0a1633;--brand-soft:#16264a;
  --side:#071430;--side-ink:#a9b9da;--side-on:#ffffff;--side-on-bg:#1d3a73;
```

Cores de situação (sempre com ícone + texto, nunca só cor):

| Situação | Cor |
| --- | --- |
| Em aberto | `--brand-soft` / `--brand` |
| Aguardando pagamento | `--warn-soft` / `--warn` |
| Pago, Mesa livre, WhatsApp conectado | `--ok-soft` / `--ok` |
| Cancelado, Recusado, WhatsApp desconectado | `--bad-soft` / `--bad` |
| Mesa ocupada / reservada | `--surface-2` com borda `--line-strong` / `--warn-soft` |

## Navegação

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ [logo]       │  Título da tela                    WhatsApp ● Conectado  👤 │
│              │────────────────────────────────────────────────────────────│
│ ＋ Novo pedido│                                                            │
│ ☰ Pedidos    │                    conteúdo da tela                        │
│ ▦ Mesas      │                                                            │
│ ⏳ Fila      │                                                            │
│ 🍳 Andon ↗   │  (abre em janela própria)                                  │
│ ─ Cardápio ─ │                                                            │
│   Pratos     │                                                            │
│   Ingredient.│                                                            │
│   Categorias │                                                            │
│ ─ Gestão ─── │  (somente Administrador)                                   │
│   Configur.  │                                                            │
│   Usuários   │                                                            │
│   Auditoria  │                                                            │
│ Sobre        │                                                            │
└──────────────┴────────────────────────────────────────────────────────────┘
```

- Tela inicial após o login: **Novo pedido** (nível C: **Andon**, sem menu).
- Itens de Gestão só aparecem para o nível A. Atendente vê o Cardápio só para consulta.
- O indicador do WhatsApp fica fixo no topo; clicar leva a Configurações → WhatsApp (A) ou mostra o estado (B).
- Em telas estreitas o menu vira barra no topo (igual ao CCP).
- Atalhos: `F2` novo pedido, `/` foca a pesquisa, `Esc` fecha modal, `F8` enviar para a cozinha (mesa), `F9` finalizar / fechar conta.

## Telas

| Tela | Arquivo | Padrão | Observações |
| --- | --- | --- | --- |
| Login | `views/login.js` | cartão central | troca obrigatória de senha provisória |
| **Novo pedido** | `views/pedidoNovo.js` | **tela própria (toque)** | ver abaixo |
| **Pedidos** | `views/pedidos.js` | grid | ordem de cadastro; abrir mostra detalhes e pagamentos |
| **Andon da cozinha** | `views/andon.js` | **tela cheia, colunas** | ver abaixo; janela própria |
| Mesas | `views/mesas.js` | mapa de cartões | cada cartão: número, lugares, situação, comanda aberta (total parcial, tempo); tocar abre/cria a comanda; ações Liberar / Ocupar |
| Fila de espera | `views/fila.js` | lista + painel | "Chamar" envia o WhatsApp; cronômetro da tolerância |
| Pratos | `views/pratos.js` | grid + modal | modal com aba de ingredientes (adicionar, marcar removível, ordenar) |
| Ingredientes | `views/ingredientes.js` | grid + modal | preço de adicional, pode ser adicional, ativo |
| Categorias | `views/categorias.js` | grid + modal | ordem por arrastar ou setas |
| Configurações | `views/configuracoes.js` | abas | Restaurante · PIX · WhatsApp · Maquininha · Fila · Cozinha |
| Usuários (A) | `views/usuarios.js` | grid + modal | backup manual |
| Auditoria (A) | `views/auditoria.js` | grid | detalhes "antes → depois" |
| Sobre | `views/sobre.js` | cartão | versão e atualização |

### Novo pedido (tela principal)

```
┌─────────────────────────────────────────────────────┬───────────────────────────────┐
│ [🔍 Buscar prato ou código]                          │ Pedido 37 · Mesa [ 4 ▾ ]       │
│ [Lanches] [Executivos] [Bebidas] [Sobremesas]       │ ou Cliente [__________]        │
│                                                     │───────────────────────────────│
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ 1× X-Burger          R$ 32,00 │
│ │ X-Burger │ │ X-Salada │ │ X-Bacon  │ │ Veggie   │ │    sem cebola                 │
│ │ R$ 28,00 │ │ R$ 30,00 │ │ R$ 34,00 │ │ R$ 29,00 │ │    + bacon        R$ 4,00     │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ 2× Refrigerante      R$ 14,00 │
│ ┌──────────┐ ┌──────────┐ ...                       │                               │
│                                                     │───────────────────────────────│
│                                                     │ Subtotal             R$ 46,00 │
│                                                     │ TOTAL                R$ 46,00 │
│                                                     │ [Cancelar]   [ Finalizar F9 ] │
└─────────────────────────────────────────────────────┴───────────────────────────────┘
```

- No topo da comanda, o atendente escolhe **Balcão** (pede o nome do cliente) ou **Mesa** (escolhe a mesa). Também dá para chegar
  pela tela de Mesas: tocar numa mesa livre abre uma comanda nova nela; numa mesa ocupada, abre a comanda existente.
- **Comanda de mesa:** os itens aparecem agrupados por rodada ("1ª rodada · 12:10 · Em preparo", "2ª rodada · 12:35 · Na fila") e os novos
  em "A enviar". Os botões do rodapé ficam **Enviar para a cozinha** (principal, `F8`) e **Fechar conta** (`F9`). Itens já enviados têm só a
  ação **Cancelar item** (pede motivo) e aparecem riscados quando cancelados.
- **Balcão:** o rodapé mostra só **Finalizar** (`F9`), como no desenho acima.
- Cartões de prato grandes (≥ 96 px de altura), com foto opcional; um toque abre o **modal de personalização**.
- **Modal de personalização:** lista dos ingredientes padrão como caixas marcadas (desmarcar = remover; não removíveis aparecem travados
  com cadeado); seção "Adicionar" com busca de ingredientes e botões `−`/`+` mostrando o preço de cada um; quantidade; observação;
  preço do item atualizado ao vivo. Botão **Adicionar ao pedido**. Toque longo/duplo no prato = adiciona sem personalizar.
- Clicar num item da comanda reabre o modal para editar; ícone de lixeira remove.
- O rascunho fica guardado no navegador (`localStorage`) até finalizar, para sobreviver a um recarregamento.
- **Finalizar** grava o pedido e abre o modal de pagamento.

### Modal de pagamento

```
 Total: R$ 46,00
 [ 💳 Crédito ]  [ 💳 Débito ]  [ ▣ PIX ]
```
- **Crédito/Débito:** estado "Siga as instruções na maquininha…" com animação discreta e botão **Cancelar cobrança**;
  resultado aprovado (✓ verde, NSU) ou recusado (✕ vermelho, motivo, "Tentar outra forma"). Link **Cobrei manualmente** (contingência).
- **PIX:** QR Code grande (≥ 280 px), valor, nome do recebedor, contador de validade, **Copiar código**, **Confirmar recebimento**, **Cancelar**.
- Ao aprovar: aviso "Pedido 37 pago" e volta para um novo pedido em branco.

### Pedidos (grid)

Padrão de grid do CCP (`components/grid.js`):

```
[ 🔍 Nº ou cliente… ] [ Filtros ② ]                                 [ Exportar CSV ] [ + Novo pedido ]
 42 pedidos · Hoje · Todas as situações
 Nº │ Hora  │ Mesa/Cliente │ Itens │ Total     │ Pagamento │ Situação              │ Cozinha   │ Atendente │ ações
 1  │ 11:32 │ Mesa 4       │ 3     │ R$ 46,00  │ PIX       │ ✓ Pago                │ Pronto    │ MARIA     │ Ver ⋯
 2  │ 11:40 │ João (balcão)│ 1     │ R$ 28,00  │ —         │ ⏳ Aguardando pagam.  │ —         │ JOSE      │ Cobrar ⋯
```
- Ordem fixa por cadastro (nº crescente); cabeçalhos não reordenam esta tela (proposta, para respeitar o requisito).
- Coluna **Tipo** com selo "Balcão" ou "Mesa". Coluna **Cozinha** mostra a rodada mais atrasada (ex.: "2/3 prontas").
- Ação principal visível conforme a situação: **Cobrar** (aguardando), **Continuar** (em aberto), **Ver** (pago/cancelado).
  Menu "⋯": Marcar entregue, Cancelar.
- Atualiza sozinha pelos eventos do servidor.

### Andon da cozinha (`views/andon.js`)

Tela cheia, sem menu lateral, sempre em **tema escuro** (fundo `--side` azul-escuro, cartões `--surface` do tema escuro), fonte grande
para leitura a 2–3 metros. Três colunas por situação de preparo:

```
┌ ANDON · COZINHA ───────────────────────────────────────────── 12:41 · ● Conectado · 🔔 ┐
│ NA FILA (3)                 │ EM PREPARO (2)              │ PRONTO (1)                 │
│ ┌─────────────────────────┐ │ ┌─────────────────────────┐ │ ┌────────────────────────┐ │
│ │ #37 · Mesa 4    ⏱ 03:12 │ │ │ #35 · João     ⏱ 14:50 │ │ │ #33 · Mesa 2   ⏱ 18:05 │ │
│ │▌OBS: cliente alérgico  ▐│ │ │ 2× X-Salada             │ │ │ 1× Executivo frango    │ │
│ │▌a amendoim             ▐│ │ │    SEM tomate           │ │ │                        │ │
│ │ 1× X-Burger             │ │ │ 1× Batata média         │ │ │                        │ │
│ │    SEM cebola           │ │ │                         │ │ │                        │ │
│ │    + bacon (2)          │ │ │                         │ │ │                        │ │
│ │    » bem passado        │ │ │                         │ │ │                        │ │
│ │ [ Iniciar preparo ▶ ]   │ │ │ [ Pronto ✓ ]            │ │ │ [ Entregue ]           │ │
│ └─────────────────────────┘ │ └─────────────────────────┘ │ └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Nº do pedido e mesa/cliente em ≥ 28 px; itens em ≥ 22 px.
- **SEM …** em vermelho (`--bad`) e negrito; **+ …** em verde (`--ok`); observação do item com `»` em itálico;
  observação do pedido em faixa amarela (`--warn-soft`) no topo do cartão, com ícone ⚠.
- Cronômetro com borda/fundo verde → amarelo → vermelho (RN-12), sempre acompanhado do tempo em número.
- Botão de avanço ocupa a largura do cartão (≥ 56 px de altura, para mãos ocupadas/luvas); "Desfazer" aparece por 10 s num aviso.
- Cartão cancelado: fundo `--bad-soft`, texto "CANCELADO — motivo", some após 60 s.
- Muitos pedidos: a coluna rola; o contador no título mostra o total.
- Faixa vermelha fixa "Sem conexão — tentando reconectar" quando o SSE cai.
- 🔔 liga/desliga o som. Não há outros controles: nada de navegar para fora do andon.

**Como abrir:**
- **Segundo monitor:** o item **Andon** do menu (A/B) abre uma janela Electron em tela cheia no monitor escolhido (lembrado entre usos).
  Se o computador tiver um só monitor, o item mostra as instruções para o tablet.
- **Tablet:** Configurações → Cozinha mostra o endereço na rede local e um QR Code. No tablet, abrir no navegador, entrar com um usuário
  nível C e (recomendado) "Adicionar à tela inicial" para abrir em tela cheia. Layout responsivo: em tablet na vertical as três colunas
  viram abas com contador ("Na fila 3 · Em preparo 2 · Pronto 1").
- Segundo monitor e tablet podem estar abertos ao mesmo tempo; um toque em qualquer um atualiza o outro.

Cada cartão é uma **rodada**: numa comanda de mesa, "#37 · Mesa 4 · 2ª rodada".

## Componentes

| Módulo | Função |
| --- | --- |
| `ui.js` | `notify`, `openDialog`, `confirmDialog` (do CCP) |
| `components/grid.js` | grid padrão do CCP |
| `components/ingredientePicker.js` | busca e `−`/`+` de adicionais |
| `components/qrDialog.js` | QR Code PIX com contador e cópia |
| `components/statusBadge.js` | selo de situação com ícone + texto |
| `events.js` | conexão SSE com reconexão automática |
| `format.js` | moeda `R$ 1.234,56`, hora, telefone |

## Acessibilidade e UX

Foco visível, alvos de toque ≥ 44 px na tela de pedido (≥ 40 px nas demais), estados nunca só por cor, `aria-live` nos avisos e no
resultado do pagamento, respeito a `prefers-reduced-motion`, textos em português claro, confirmação antes de cancelar.
