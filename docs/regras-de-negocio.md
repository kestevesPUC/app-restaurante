# Regras de negócio

Convenções: valores monetários em **centavos inteiros**; datas e horas em ISO 8601 (gravadas em UTC, exibidas no fuso local).
Regras marcadas com **(proposta)** são decisões do arquiteto pendentes de validação.

## RN-01 · Acesso

| Nível | Nome | Pode |
| --- | --- | --- |
| **A** | Administrador | Tudo: cardápio, configurações (PIX, WhatsApp, maquininha), usuários, auditoria, backup, cancelar pedido pago |
| **B** | Atendente | Criar e cobrar pedidos, cancelar pedido **não pago**, ver a lista de pedidos, gerenciar mesas e fila de espera, consultar o cardápio, abrir o andon |
| **C** | Cozinha | Somente a tela de andon: ver pedidos e avançar a situação de preparo (proposta) |

- Só funcionários têm login; não existe cadastro público nem acesso de clientes.
- O primeiro acesso cria o usuário `ADMIN` com senha provisória exibida uma única vez; a troca é obrigatória.
- Usuários novos nascem com senha provisória e precisam trocá-la no primeiro acesso.
- Senha com no mínimo 6 caracteres; após **3 tentativas erradas** o usuário fica bloqueado por **5 minutos**.
- Sessão expira após **12 horas** de inatividade (proposta). Ao expirar, a tela volta para o login sem perder o pedido em montagem
  (o rascunho fica guardado no navegador até o novo login).
- O servidor valida o nível em toda requisição; a interface só esconde botões, ela não é a proteção.
- Um usuário não pode excluir a si mesmo nem rebaixar o último administrador.

## RN-02 · Categorias (proposta)

- Agrupam os pratos na tela de pedido (ex.: Lanches, Pratos executivos, Bebidas, Sobremesas).
- `vai_para_cozinha` (padrão: sim) define se os itens da categoria aparecem no andon (RN-12).
- Nome obrigatório e único; `ordem` define a posição dos botões na tela de pedido.
- Categoria com pratos vinculados não pode ser excluída; pode ser desativada.

## RN-03 · Ingredientes

- Nome obrigatório e único (comparação sem acento e sem maiúsculas).
- **Preço de adicional** ≥ 0: valor cobrado quando o ingrediente é acrescentado a um item. Zero = adicional gratuito.
- `pode_ser_adicional`: quando falso, o ingrediente não aparece na lista de adicionais (ex.: "Pão").
- Ingrediente usado em algum prato ou pedido não pode ser excluído, apenas **desativado**.
  Desativado: some das listas de adicionais e não pode ser incluído em novos pratos; pratos que já o têm continuam funcionando.

## RN-04 · Pratos

- Campos obrigatórios: nome (único), categoria, preço de venda > 0.
- Opcionais: descrição, código curto (atalho de teclado na tela de pedido) e foto.
- Cada prato tem **zero ou mais ingredientes padrão**. Para cada um:
  - `removivel` (padrão: sim): se falso, o atendente não consegue removê-lo no pedido (ex.: "Pão" de um sanduíche);
  - `quantidade` é informativa (ex.: "2 fatias"), não entra em cálculo.
- O mesmo ingrediente não pode aparecer duas vezes no mesmo prato.
- Prato pode ser **desativado** (some da tela de pedido). Prato que já foi pedido não pode ser excluído.
- Alterar o preço ou os ingredientes de um prato **não altera pedidos já registrados** (ver RN-06, "retrato").

## RN-05 · Pedido

### Dois modelos de pedido

O sistema aceita os dois modelos ao mesmo tempo; o atendente escolhe ao abrir o pedido (`tipo`).

| | **Balcão** (`BALCAO`) | **Comanda de mesa** (`MESA`) |
| --- | --- | --- |
| Identificação | nome do cliente (obrigatório) | mesa (obrigatória) + nome opcional |
| Itens | montados de uma vez | acrescentados durante a refeição, em **rodadas** |
| Cozinha | uma única rodada, enviada conforme `cozinha.enviar_em` (padrão: ao pagar) | cada rodada vai à cozinha quando o atendente clica **Enviar para a cozinha** |
| Pagamento | ao **finalizar** o pedido | ao **fechar a conta** |
| Mesa | — | fica **Ocupada** enquanto a comanda estiver aberta |

### Criação

- O pedido nasce na situação **Em aberto**, com o funcionário que o criou e a data/hora de cadastro.
- **Número do pedido:** sequencial por dia, reiniciando em 1 a cada data (ex.: "Pedido 37"). O identificador interno (`id`) é global e crescente.
- Ao abrir uma comanda numa mesa **Livre** ou **Reservada**, ela passa para **Ocupada**.
- Cada mesa tem **no máximo uma comanda em aberto**. Tocar numa mesa ocupada abre a comanda existente.
- Pedido sem itens não pode ser finalizado nem fechado.
- Trocar a comanda de mesa (cliente mudou de lugar) é permitido para a mesa destino Livre (proposta).

### Rodadas (envios à cozinha)

- Itens novos ficam **pendentes de envio** (podem ser editados ou removidos livremente).
- **Enviar para a cozinha** cria uma rodada (`envio`) com todos os itens pendentes; cada rodada vira um cartão no andon (RN-12).
- Item **já enviado** não pode ser editado. Pode ser **cancelado** com motivo (nível A e B): deixa de contar no total, e se a rodada
  ainda estiver no andon, a linha aparece riscada com "CANCELADO".
- No balcão a rodada é criada automaticamente com todos os itens no momento definido em `cozinha.enviar_em`.
- Itens de categorias que não vão para a cozinha (ex.: bebidas) entram na conta, mas não geram cartão no andon.

### Itens e personalização

- Um item = um prato + quantidade (inteiro ≥ 1) + personalizações + observação livre (até 140 caracteres).
- **Remover ingrediente:** só ingredientes padrão do prato marcados como removíveis. **Não reduz o preço** (proposta).
- **Adicionar ingrediente:** qualquer ingrediente ativo com `pode_ser_adicional`, inclusive um que já é padrão no prato
  (vira "dose extra"). Cada adicional tem quantidade (≥ 1) e soma `preço de adicional × quantidade` ao item.
- O mesmo ingrediente não pode ser removido e adicionado no mesmo item.
- **Preço do item** = (`preço do prato` + Σ adicionais) × `quantidade do item`.
- Dois itens do mesmo prato com personalizações diferentes são linhas separadas. Itens idênticos podem ser agrupados somando a quantidade.

### Totais

- `subtotal` = Σ preço dos itens **não cancelados**.
- Taxa de serviço (10% do garçom) na comanda de mesa: ver [Pendências](roadmap.md#pendências) (P12).
- `desconto` (opcional, somente nível A ou com senha do administrador) — proposta; ≥ 0 e ≤ subtotal.
- `total` = `subtotal − desconto`. É **sempre recalculado no servidor**; o valor enviado pela interface é ignorado.

### Situações

```
Em aberto ──finalizar (balcão) / fechar conta (mesa)──▶ Aguardando pagamento ──pagamento aprovado──▶ Pago
    │                                                       │         ▲
    │                                                       │         └─ pagamento recusado/cancelado (volta e permite outra forma)
    └────────────────cancelar───────────────────────────────┴──cancelar──▶ Cancelado
Pago ──cancelar (só A, com motivo)──▶ Cancelado (estorno feito fora do sistema e registrado)
```

| Situação | Pode mexer em itens | Pode cobrar | Pode cancelar |
| --- | --- | --- | --- |
| Em aberto | sim (itens pendentes); cancelar item enviado com motivo | — | A e B; se já houver rodada enviada, só com motivo |
| Aguardando pagamento | não (voltar para "Em aberto" libera, desde que não haja cobrança pendente) | sim | A e B |
| Pago | não | — | só A, com motivo obrigatório |
| Cancelado | não | — | — |

- **Fechar conta** (mesa): mostra a conta conferida (itens, cancelados riscados, total) para o cliente antes de cobrar.
  Itens pendentes de envio impedem o fechamento até serem enviados ou removidos.
- Ao pagar uma comanda, a mesa **continua Ocupada** até o atendente liberá-la (RN-10).
- Cancelamento exige motivo (até 200 caracteres) e fica na auditoria.
- O pedido nunca é apagado do banco.

## RN-06 · Retrato do pedido

No momento em que um item entra no pedido, o sistema copia **nome do prato, preço do prato, nome e preço de cada adicional e nome
de cada ingrediente removido**. Mudanças posteriores no cardápio não afetam pedidos antigos, relatórios nem reimpressões.

## RN-07 · Lista de pedidos

- Ordenada pela **ordem de cadastro** (`id` crescente): o pedido mais antigo do dia aparece primeiro.
- Padrão: pedidos do dia atual. Filtros: período, situação, forma de pagamento, mesa, atendente; pesquisa por número ou nome do cliente.
- Colunas: nº, hora, tipo (balcão/mesa), mesa/cliente, qtd. de itens, total, forma de pagamento, situação, cozinha, atendente.
- Abrir um pedido mostra itens com personalizações (ex.: "X-Burger — sem cebola, + bacon (R$ 4,00)") e o histórico de pagamentos.
- A lista se atualiza sozinha a cada 10 s enquanto aberta (proposta), sem mudar a ordem.

## RN-08 · Pagamento

- Formas: **Crédito**, **Débito** (maquininha) e **PIX** (QR Code). Dinheiro: ver [Pendências](roadmap.md#pendências).
- A v1 cobra o pedido com **uma única forma de pagamento** pelo valor total (pagamento dividido fica para depois — proposta).
- Cada tentativa de cobrança gera um registro em `pagamentos`, mesmo recusada; o pedido fica **Pago** quando uma tentativa é **aprovada**.
- Só pode existir **uma tentativa pendente** por pedido ao mesmo tempo.
- O valor enviado à maquininha ou ao QR Code é o `total` do pedido calculado no servidor.

### Maquininha (crédito/débito)

1. Ao escolher Crédito ou Débito, o servidor cria o pagamento **Pendente** e envia valor, forma e identificador do pedido ao adaptador da maquininha.
2. A tela mostra "Siga as instruções na maquininha" com botão **Cancelar cobrança**.
3. Retorno **aprovado** → grava NSU, código de autorização e bandeira; pagamento **Aprovado**; pedido **Pago**.
4. Retorno **recusado**, **cancelado** ou **tempo esgotado** (padrão 120 s) → pagamento com essa situação; o pedido volta a aceitar outra cobrança.
5. Crédito parcelado: fora da v1 (proposta: só à vista).
6. **Contingência:** se a maquininha estiver indisponível, o atendente pode registrar "Cobrado manualmente na maquininha",
   informando o NSU ou os 4 últimos dígitos do comprovante. Fica marcado como `manual` e aparece destacado na auditoria.

### PIX

1. Requer uma **chave PIX ativa** cadastrada (RN-09). Sem ela, a opção PIX aparece desabilitada com o motivo.
2. O servidor gera o **BR Code estático com valor** (PIX Copia e Cola) contendo chave, nome do recebedor, cidade, valor e
   identificador `txid` = `PED` + id do pedido (ex.: `PED000123`).
3. A tela mostra o QR Code em tamanho grande, o valor, o nome do recebedor e o botão **Copiar código**.
4. Como o PIX estático não avisa o sistema, o atendente confere o recebimento no app do banco e clica **Confirmar recebimento**.
   O pagamento fica **Aprovado** com `confirmado_por` = usuário. **Cancelar** volta o pedido para escolher outra forma.
5. O QR Code expira para uso no sistema após **15 minutos** (proposta); depois é preciso gerar outro.

## RN-09 · Chave PIX

- Somente o administrador cadastra.
- Campos: tipo (CPF, CNPJ, e-mail, telefone, aleatória), chave, **nome do recebedor** (até 25 caracteres, sem acentos no código),
  **cidade** (até 15 caracteres, sem acentos no código).
- Validação por tipo: CPF/CNPJ com dígito verificador; e-mail válido; telefone no formato `+55DDDNÚMERO`; aleatória no formato UUID.
- Pode haver várias chaves cadastradas, mas **apenas uma ativa**. Ativar uma desativa as outras.
- Antes de salvar, a tela gera um QR Code de teste de R$ 0,01 para o administrador conferir no app do banco que o recebedor está certo (proposta).

## RN-10 · Mesas

- Cadastro: número (único), capacidade (lugares), ativa.
- Situações: **Livre**, **Ocupada**, **Reservada** (reservada = já chamada para alguém da fila).
- Ocupada → Livre: ação manual do atendente ("Liberar mesa"). Pagar o pedido **não** libera a mesa sozinho: o cliente pode continuar sentado.
- Mesa com comanda **não paga** (Em aberto ou Aguardando pagamento) não pode ser liberada.
- Ao liberar uma mesa, se houver clientes aguardando, o sistema sugere o primeiro da fila que caiba na mesa (RN-11).

## RN-11 · Fila de espera e aviso pelo WhatsApp

- Entrada na fila: nome, telefone celular (com DDD), nº de pessoas, observação. O horário de entrada define a ordem.
- Situações: **Aguardando** → **Chamado** → **Sentado**; ou **Desistiu** / **Não compareceu**.
- Ao liberar uma mesa, o sistema sugere o primeiro **Aguardando** cujo nº de pessoas ≤ capacidade da mesa.
  O atendente pode escolher outro da lista.
- **Chamar:** o atendente confirma e o sistema envia a mensagem pelo WhatsApp com o modelo configurado
  (variáveis `{nome}`, `{mesa}`, `{restaurante}`, `{tolerancia}`). A mesa fica **Reservada** e o cliente **Chamado**.
- Nenhuma mensagem é enviada sem clique do funcionário.
- Tolerância (padrão 10 min, configurável): passado o tempo, a tela destaca o cliente; o atendente decide marcar **Não compareceu**
  (a mesa volta a **Livre** e o próximo é sugerido) ou esperar.
- Ao marcar **Sentado**, a mesa fica **Ocupada**.
- Falha no envio (WhatsApp desconectado, número sem WhatsApp): o cliente continua **Aguardando**, a tela mostra o erro e oferece
  "Chamei de outra forma" para seguir o fluxo manualmente.
- Cada envio fica registrado (`mensagens_whatsapp`) com situação e erro.
- O telefone do cliente é dado pessoal (LGPD): usado só para o aviso e apagado (anonimizado) da fila após **30 dias** (proposta).

## RN-12 · Andon da cozinha

Tela para a cozinha acompanhar os pedidos em produção, com os itens, as personalizações e as observações bem visíveis.

### Quando o pedido aparece

O andon mostra **rodadas** (envios à cozinha), não pedidos inteiros: uma comanda de mesa pode ter várias rodadas, cada uma com seu cartão.

- **Comanda de mesa:** a rodada entra no andon quando o atendente clica **Enviar para a cozinha** (antes do pagamento).
- **Balcão:** a rodada única entra quando o pedido fica **Pago** (padrão, evita preparar pedido não pago) ou ao **finalizar**,
  conforme `cozinha.enviar_em` (`PAGO` | `FINALIZADO`).
- Itens de categorias marcadas como "não vai para a cozinha" (ex.: Bebidas) não aparecem (`categorias.vai_para_cozinha`).
  Uma rodada só com esses itens não gera cartão.

### Situação de preparo

Por rodada, independente da situação de pagamento:

```
Na fila ──iniciar──▶ Em preparo ──pronto──▶ Pronto ──entregue──▶ Entregue (sai da tela)
```

- A cozinha avança a situação com um toque no cartão. **Desfazer** fica disponível por 10 s após cada toque.
- **Entregue** pode ser marcado pela cozinha ou pelo atendente (detalhe do pedido).
- Cada mudança grava a hora (`enviado_em`, `preparo_iniciado_em`, `pronto_em`, `entregue_em`), o que permite medir o tempo de preparo.
- Pedido **cancelado** depois de entrar no andon: os cartões das rodadas não entregues ficam vermelhos com "CANCELADO" e o motivo por 60 s,
  e depois saem da tela. Item cancelado isoladamente aparece riscado no cartão.

### O que o cartão mostra

- Nº do pedido, mesa ou nome do cliente, **nº da rodada** na comanda de mesa (ex.: "Mesa 4 · 2ª rodada"), hora de envio e **tempo decorrido**.
- Cada item com quantidade e nome; logo abaixo, as personalizações:
  **SEM** ingrediente (destaque vermelho) e **+ ingrediente** com quantidade (destaque verde). O preço não aparece.
- Observação do item, em destaque, logo abaixo dele.
- **Observação do pedido**, em faixa amarela no topo do cartão.
- Cor do cronômetro conforme o tempo desde a entrada: verde até `cozinha.alerta_min` (padrão 10 min), amarelo até `cozinha.critico_min`
  (padrão 20 min), vermelho acima disso.

### Ordem e atualização

- Em cada coluna, os cartões aparecem por ordem de envio à cozinha (o mais antigo primeiro).
- A tela atualiza sozinha (eventos do servidor) e toca um aviso sonoro quando chega uma rodada nova (pode ser desligado).
- Se a conexão cair, a tela mostra "Sem conexão" em destaque e tenta reconectar; nunca mostra dados velhos como se fossem atuais.

### Onde o andon roda

- **Segundo monitor** ligado ao computador do caixa, quando houver: janela própria em tela cheia, aberta pelo menu.
- **Tablet** (ou TV com navegador) na mesma rede Wi-Fi: abre no navegador o endereço exibido em Configurações → Cozinha
  (ex.: `http://192.168.0.10:8420/andon`, também em QR Code) e entra com um usuário nível **C**.
- Os dois podem funcionar ao mesmo tempo. O tablet só acessa o andon: qualquer outra tela é recusada pelo servidor.
- A sessão do tablet não expira por inatividade enquanto o andon estiver aberto (proposta), mas pode ser encerrada pelo administrador
  em Usuários.

## RN-13 · Auditoria

Toda criação, alteração, cancelamento, confirmação manual de pagamento, mudança de configuração e login/logout gera um registro
imutável: quem, quando, ação, entidade e o antes/depois (JSON). Só o administrador consulta.

## RN-14 · Backup

- Cópia automática diária em `Documentos\PDV Restaurante Backups`, mantendo as 14 mais recentes.
- Backup manual (administrador) baixa uma cópia consistente do banco.
- A sessão do WhatsApp **não** entra no backup (exige novo pareamento ao restaurar).
