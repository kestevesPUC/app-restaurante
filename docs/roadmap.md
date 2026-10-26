# Roadmap

Entregas em fases; cada fase termina com sistema instalável e testes passando. As integrações reais vêm depois do fluxo
completo funcionar com os adaptadores **simulados**.

| Fase | Entrega | Critério de aceite |
| --- | --- | --- |
| **0 · Base** | Projeto Electron + servidor + SQLite + migrações, login, níveis A/B/C, usuários, auditoria, tema azul-escuro, menu | Instalador abre o sistema; `ADMIN` troca a senha; auditoria registra login |
| **1 · Cardápio** | Categorias (com "vai para a cozinha"), ingredientes, pratos com ingredientes (removível, ordem), foto | Cadastrar 10 pratos com ingredientes; desativar ingrediente em uso funciona; excluir em uso é bloqueado |
| **2 · Pedido** | Tela Novo pedido nos dois modelos (balcão e comanda de mesa com rodadas), personalização (remover/adicionar), cancelamento de item enviado, lista de pedidos em ordem de cadastro, cancelamento | Pedido de balcão com 3 itens personalizados registrado em < 1 min; comanda de mesa com 2 rodadas e 1 item cancelado fecha com total correto; lista na ordem de cadastro |
| **3 · Pagamento simulado + PIX** | Fluxo de pagamento com `TerminalSimulado`, contingência manual, cadastro de chave PIX, BR Code + QR Code, confirmação do PIX, SSE | QR Code lido e valor correto em 2 apps de banco diferentes; payload bate com exemplos do Bacen; recusa e tempo esgotado tratados |
| **3b · Andon da cozinha** | Rodadas no andon, janela no segundo monitor, listener restrito na rede local, andon no tablet (responsivo, abas na vertical), som de aviso | Rodada enviada aparece em < 2 s no monitor e no tablet ao mesmo tempo; cozinha avança até "Entregue"; item/pedido cancelado aparece em vermelho; tablet não acessa nenhuma outra tela |
| **4 · Mesas e fila** | Mapa de mesas ligado às comandas, fila de espera, `MensageiroSimulado` | Mesa com comanda não paga não pode ser liberada; liberar mesa sugere o primeiro da fila que cabe; tolerância destaca o cliente |
| **5 · WhatsApp real** | `WhatsAppWebMensageiro`, pareamento por QR, estado no topo, mensagem de teste | Mensagem chega ao cliente em < 10 s; queda do WhatsApp não trava a fila |
| **6 · Maquininha real** | Moderninha Smart: app Android "PDV Cobrança" (PlugPagServiceWrapper), pareamento por QR Code, rotas `/terminal/*` na rede local, homologação no PagBank | Cobranças aprovada, recusada, cancelada e queda no meio do pagamento conferidas na maquininha real |
| **7 · Acabamento** | Backup diário, atualização automática, exportação CSV, anonimização da fila, documentação final | Checklist de homologação completo |

As fases 0–5 não dependem do PagBank. A fase 6 só começa depois da resposta do PagBank (P11); vale abrir esse contato já,
porque homologação costuma levar semanas.

## Pendências

Decisões que só o dono do produto pode tomar e que mudam o que será construído:

| # | Pergunta | Impacto | Valor assumido até a resposta |
| --- | --- | --- | --- |
| **P11** | O PagBank libera o **app próprio na Moderninha Smart** para a conta do restaurante? Quais as etapas de homologação? Existe API em nuvem que dispense o app? | Sem liberação, a fase 6 não acontece e fica a contingência manual; com API em nuvem, o app Android deixa de ser necessário | App Android + homologação |
| **P12** | A comanda de mesa cobra **taxa de serviço** (10%)? Opcional para o cliente? | Cálculo do total e tela de fechar conta | Sem taxa de serviço |
| **P4** | Aceita **dinheiro**? Precisa de controle de caixa (abertura, sangria, fechamento)? | Nova forma de pagamento e telas de caixa | Não aceito na v1 |
| **P8** | Pagamento **dividido** (parte cartão, parte PIX; dividir a conta da mesa entre pessoas)? | Mais provável agora que há comanda de mesa; muda o modelo de pagamento e as telas | Uma forma pelo total |
| **P5** | Além do andon, a cozinha precisa de **comanda impressa**? | Integração com impressora térmica (ESC/POS) | Não; só o andon |
| **P6** | Haverá **mais de um computador de caixa** usando o sistema ao mesmo tempo? | SQLite local atende um computador; vários exigem servidor central | Um computador (tablet do andon não conta) |
| **P7** | Remover um ingrediente **reduz o preço**? | Regra de cálculo | Não reduz |
| **P10** | No **balcão**, o pedido vai para a cozinha **depois de pago** ou **assim que finalizado**? | Ordem de produção | Depois de pago (configurável) |

### Resolvidas

| # | Decisão |
| --- | --- |
| P1 | Maquininha: **Moderninha Smart (PagBank)**, integrada por app Android próprio |
| P2 | **Não** emite NFC-e/SAT |
| P3 | **Os dois modelos**: balcão (paga ao finalizar) e comanda de mesa (rodadas à cozinha, paga ao fechar a conta) |
| P9 | Andon no **segundo monitor**, quando houver, e/ou em **tablet** na rede local |

## Decisões tomadas pelo arquiteto (para revisão)

- Reaproveitar arquitetura, padrões de tela e segurança do CCP; trocar verde-petróleo por azul-escuro (`--side:#0b1f44`, `--brand:#1e3a8a`).
- Categorias de pratos, para organizar a tela de pedido.
- Número do pedido sequencial por dia; lista ordenada pelo `id` (ordem de cadastro), sem reordenação por coluna.
- Retrato do pedido (nomes e preços copiados no momento do pedido).
- Comanda de mesa em **rodadas** enviadas por clique; item enviado não se edita, só se cancela com motivo; uma comanda aberta por mesa.
- Andon mostra **rodadas** (não pedidos inteiros), em três colunas, com nível de usuário "Cozinha", cronômetro 10/20 min,
  som de aviso e categorias que não vão para a cozinha (ex.: bebidas).
- Rede local: listener separado com lista fechada de rotas (andon + Moderninha), só usuários nível C fazem login por ela; HTTP sem TLS
  dentro do Wi-Fi da equipe.
- Pagamento assíncrono com SSE; maquininha e WhatsApp sempre com caminho manual.
- PIX estático com confirmação pelo atendente; PIX dinâmico como evolução.
- WhatsApp usando o Microsoft Edge instalado como navegador do Puppeteer.
- Mesa só é liberada manualmente; pagar não libera a mesa; mesa com comanda não paga não pode ser liberada.
- Mensagem de WhatsApp só por clique do atendente; telefones anonimizados após 30 dias.
- Tolerância da fila 10 min; validade do QR Code 15 min; tempo limite da maquininha 120 s; sessão 12 h (tablet do andon sem expiração por inatividade).
