# PDV Restaurante

Sistema desktop (Windows) de gestão de pedidos para restaurante/lanchonete: cardápio, estoque de bebidas, pedidos com cliente, tela da cozinha e aviso automático por WhatsApp quando o pedido fica pronto. Uso exclusivo da equipe (Administrador, Atendente e Cozinha).

> **Status:** em desenvolvimento. Back-end do escopo de lanchonete implementado e testado; já existem as telas de login, usuários, auditoria, cadastros, cardápio, novo pedido, pedidos, cozinha, clientes, relatórios e WhatsApp. Faltam ajustes finais de Configurações e a documentação do esquema do banco.

## Funcionalidades

- **Cardápio:** pratos (valor, tempo de preparo, ao menos um ingrediente, ativar/inativar) e bebidas.
- **Ingredientes:** nome, unidade de medida e observação.
- **Estoque de bebidas:** entrada, saída e ajuste com histórico, alerta de estoque baixo, bloqueio de venda sem saldo e baixa automática ao confirmar o pedido.
- **Pedidos:** cliente (nome e telefone obrigatórios), itens com quantidade e observação, total e tempo estimado de preparo.
- **Fluxo de status:** Recebido → Em preparo → Pronto para retirada/entrega → Finalizado (ou Cancelado), com histórico de data, hora e usuário.
- **WhatsApp automático** ao ficar pronto, reenvio manual, histórico de notificações e modelos de mensagem editáveis.
- **Clientes** com histórico de pedidos.
- **Relatórios** de pedidos, vendas, bebidas e clientes, exportáveis em Excel e PDF.
- **Perfis:** Administrador (tudo), Atendente (pedidos, cardápio, clientes) e Cozinha (somente a tela da cozinha).
- **Log estruturado** em JSON Lines, migrações automáticas do banco, backup diário e título da janela com nome e versão.

Fora do escopo desta fase: mesas, fila de espera, PIX e maquininha (ver [roadmap](docs/roadmap.md)).

## Tecnologias

Node.js ≥ 22.13 (`node:sqlite`), Electron, SQLite, interface SPA em JavaScript puro, `whatsapp-web.js`, ExcelJS e pdfkit. Arquitetura em camadas (domain, application, infrastructure, presentation), ligadas apenas em `src/compositionRoot.js`.

## Como rodar

```bash
npm install
npm start          # servidor local em http://localhost:3000
npm run desktop    # abre no Electron
npm test           # testes (node --test)
npm run dist       # gera o instalador Windows em dist/
```

Variáveis opcionais: `PORT` (padrão 3000), `PDV_DB` (caminho do SQLite, padrão `data/pdv.sqlite`) e `PDV_LOGS` (pasta de logs, padrão `data/logs`).

O WhatsApp usa o Edge instalado no Windows (o Chromium do Puppeteer não é baixado). Na primeira conexão é preciso ler o QR Code com o celular do estabelecimento.

## Estrutura

```
src/domain          regras de negócio puras
src/application     serviços (pedidos, estoque, clientes, relatórios...)
src/infrastructure  SQLite, WhatsApp, exportação, logs, backup
src/presentation    servidor HTTP, rotas e controllers
src/desktop         integração com o Electron
public/             interface (HTML, CSS e módulos ES)
test/               testes automatizados
docs/               documentação
```

## Documentação

Índice em [docs/README.md](docs/README.md). Fonte de verdade do escopo atual: [design da lanchonete](docs/superpowers/specs/2026-10-26-lanchonete-design.md); plano de implementação: [Parte 3](docs/superpowers/plans/2026-10-26-pdv-parte-3-escopo-lanchonete.md).

## Autor

Desenvolvido por [Kaio Gomes](https://kaio-gomes-site.vercel.app/). Licença [MIT](LICENSE).
