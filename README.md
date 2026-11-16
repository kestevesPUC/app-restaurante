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

## Cópia para o Supabase/Postgres na nuvem (opcional)

Uma rotina separada lê o SQLite a cada poucos segundos e envia à nuvem só o que foi criado, alterado ou apagado. O app não muda.

**Modo HTTPS (recomendado — funciona em redes que bloqueiam a porta do Postgres).** No `.env`:
```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=...   # Project Settings → API Keys → secret. Nunca publique.
PDV_DB=C:/Users/SEU-USUARIO/AppData/Roaming/pdv-restaurante/pdv.sqlite
```
1. Rode `npm run sync:ddl` e cole o SQL no SQL Editor do Supabase (cria as tabelas, trancadas por RLS). Repita se o app ganhar colunas novas.
2. Com o app aberto, rode `npm run sync:postgres` em outro terminal.

**Modo Postgres direto:** use `DATABASE_URL=postgres://...` no lugar das duas chaves acima.

`usuarios.senha_hash` e `pratos.foto` não são enviados. Opcionais: `SYNC_INTERVALO` (segundos, padrão 3), `PG_SSL=0`. O progresso fica em `sync-postgres-estado.json`, ao lado do banco; apague-o para reenviar tudo.

**Dentro do app (desktop):** com as duas chaves no `.env` (na raiz do projeto em desenvolvimento, ou em `%APPDATA%pdv-restaurante.env` no app instalado), o próprio app faz a cópia a cada 5 s, sem precisar do terminal. Na tela **Andon da cozinha** aparece o botão **Sincronizar**, que copia na hora e reinicia essa contagem de 5 s. Não rode `npm run sync:postgres` ao mesmo tempo.

**Nos dois sentidos.** Além de enviar, a rotina TRAZ da nuvem o que foi criado ou alterado por outro aparelho nas tabelas de pedidos (`clientes`, `pedidos`, `pedido_envios`, `pedido_itens`, `item_modificacoes`, `pedido_status_historico`) e grava no SQLite; o Andon e a lista de pedidos recarregam sozinhos. Se a mesma linha mudou dos dois lados, o SQLite local vence. Linhas que violam uma regra local (ex.: senha repetida no mesmo dia, cliente ou prato inexistente) não são importadas e o motivo aparece ao lado do botão Sincronizar. Cada aparelho deve criar pedidos só com numeração própria: dois aparelhos criando pedidos ao mesmo tempo podem repetir número de pedido e senha. `SYNC_PUXAR=0` desliga a importação.

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
