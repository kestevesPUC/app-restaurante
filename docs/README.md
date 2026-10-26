# PDV Restaurante — Documentação

Sistema desktop (Windows) para registrar pedidos no restaurante: cardápio com ingredientes, personalização do prato
(remover/adicionar ingredientes), cobrança na maquininha de cartão ou por PIX (QR Code) e fila de espera com aviso
ao cliente pelo WhatsApp quando a mesa fica livre. A cozinha acompanha os pedidos numa tela de andon.

Uso exclusivo dos funcionários: não há acesso do cliente ao sistema.

> **Escopo atual (2026-10-26):** o projeto passou a seguir o escopo de lanchonete descrito em [superpowers/specs/2026-10-26-lanchonete-design.md](superpowers/specs/2026-10-26-lanchonete-design.md), implementado pelo plano [Parte 3](superpowers/plans/2026-10-26-pdv-parte-3-escopo-lanchonete.md). Onde este índice e os documentos abaixo divergirem desse design, vale o design. Mesas, fila de espera, PIX e maquininha ficam para uma fase posterior.
>
> **Situação:** planejamento. Nenhum código foi escrito ainda. Os pontos em aberto estão em [Roadmap → Pendências](roadmap.md#pendências).
> Tudo que estiver marcado como **(proposta)** foi decisão do arquiteto e ainda precisa ser validado pelo dono do produto.

## Documentos

| Documento | Conteúdo |
| --- | --- |
| [Visão geral](visao-geral.md) | Objetivo, escopo, fora do escopo, perfis de usuário e glossário |
| [Regras de negócio](regras-de-negocio.md) | Pratos, ingredientes, pedido, personalização, pagamento, PIX, mesas, fila, andon da cozinha e permissões |
| [Banco de dados e DER](banco-de-dados.md) | Diagrama entidade-relacionamento, tabelas, campos, índices e migrações |
| [Arquitetura](arquitetura.md) | Camadas, estrutura de pastas, segurança, desktop e testes |
| [Integrações](integracoes.md) | WhatsApp (whatsapp-web.js), maquininha de cartão e PIX (BR Code + QR Code) |
| [Interface](interface.md) | Identidade visual (azul-escuro), navegação, telas e componentes |
| [API HTTP](api.md) | Rotas internas entre a interface e o servidor local |
| [Roadmap](roadmap.md) | Fases de entrega, critérios de aceite e pendências |

## Base técnica

O projeto reaproveita a arquitetura e a identidade visual do **CCP — Controle de Contas a Pagar (JRP Engenharia)**:
Electron + servidor HTTP Node.js local + SQLite (`node:sqlite`) + interface SPA em JavaScript puro, organizado em camadas
(domínio, aplicação, infraestrutura, apresentação). A cor predominante muda de verde-petróleo para **azul-escuro**.

## Requisitos de origem

1. O usuário cadastra os pratos previamente.
2. Cada prato tem uma lista de ingredientes.
3. No pedido, é possível remover ingredientes do prato ou adicionar outros.
4. Somente funcionários acessam o sistema.
5. Mensagem pelo WhatsApp (whatsapp-web.js) ao cliente quando uma mesa ficar disponível.
6. Ao finalizar o pedido, o valor é enviado para a maquininha de cartão.
7. A chave PIX é cadastrada previamente.
8. Pagamento por PIX gera um QR Code para o cliente escanear.
9. Tela com a lista de pedidos, em ordem de cadastro.
10. Banco de dados SQLite.
11. Tela de andon para a cozinha ver os pedidos e a observação de cada pedido.
