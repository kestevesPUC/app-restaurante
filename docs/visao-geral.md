# Visão geral

## Objetivo

Tornar o momento do pedido rápido e sem erro: o funcionário monta o pedido a partir do cardápio cadastrado,
ajusta os ingredientes de cada prato conforme o cliente pede e cobra o total direto na maquininha ou por PIX,
sem digitar valores à mão. Quando o restaurante está cheio, o sistema mantém a fila de espera e avisa o cliente
pelo WhatsApp assim que uma mesa é liberada.

## Como saberemos que deu certo

- Um pedido com 3 pratos personalizados é registrado e cobrado em menos de 1 minuto.
- O valor cobrado é sempre o total calculado pelo sistema: o funcionário nunca redigita o valor na maquininha
  (exceto no modo de contingência).
- Nenhum pedido "some": todo pedido aparece na lista, com a situação do pagamento.
- O cliente da fila recebe a mensagem em segundos após a mesa ser liberada.

## Escopo (versão 1)

| Área | Inclui |
| --- | --- |
| Acesso | Login de funcionários, níveis Administrador, Atendente e Cozinha, troca obrigatória de senha provisória |
| Cardápio | Categorias, ingredientes (com preço de adicional) e pratos (com lista de ingredientes) |
| Pedido | Dois modelos: **balcão** (paga ao finalizar) e **comanda de mesa** (itens acrescentados durante a refeição, enviados à cozinha em rodadas, pagos ao fechar a conta). Personalização por item (remover/adicionar), observação, quantidade |
| Pedidos | Lista em ordem de cadastro, filtros por dia e situação, detalhes, cancelamento |
| Pagamento | Crédito e débito pela maquininha, PIX com QR Code gerado a partir da chave cadastrada, modo de contingência manual |
| Cozinha | Tela de andon com os pedidos em produção (na fila, em preparo, pronto), itens, personalizações, observações e tempo decorrido |
| Mesas e fila | Cadastro de mesas, situação (livre/ocupada), fila de espera com telefone e aviso por WhatsApp |
| Configurações | Chave PIX, conexão do WhatsApp (pareamento por QR Code), maquininha, modelo de mensagem, dados do restaurante |
| Gestão | Usuários, auditoria imutável, backup diário, atualização automática |

## Fora do escopo (versão 1)

- Emissão de documento fiscal (NFC-e / SAT): confirmado pelo dono do produto que o sistema **não** emite.
- Impressão de comanda para a cozinha (a cozinha usa a tela de andon).
- Controle de estoque de ingredientes.
- Cardápio digital, pedido feito pelo próprio cliente, delivery.
- PIX com confirmação automática (exige conta em um PSP com API); a v1 usa PIX estático com confirmação pelo funcionário.
- Vários caixas/computadores compartilhando o mesmo banco (a v1 roda em um computador; o andon pode estar num segundo monitor ou num tablet na rede).

## Anti-objetivos (o que tornaria o sistema um fracasso mesmo funcionando)

- Cobrar um valor diferente do total do pedido.
- Travar o atendimento porque a maquininha ou o WhatsApp estão fora do ar: sempre há uma saída manual.
- Exigir muitos cliques na tela de pedido: ela é otimizada para velocidade, não para completude.
- Enviar mensagem de WhatsApp sem que um funcionário tenha disparado a ação.

## Perfis de usuário

| Perfil | Quem é | Usa principalmente |
| --- | --- | --- |
| **Administrador (A)** | Dono ou gerente | Cardápio, configurações (PIX, WhatsApp, maquininha), usuários, auditoria, cancelamento de pedido pago |
| **Atendente (B)** | Caixa, garçom, recepcionista | Novo pedido, lista de pedidos, cobrança, mesas e fila de espera |
| **Cozinha (C)** | Cozinheiros | Somente o andon: ver pedidos e marcar em preparo / pronto / entregue |

## Glossário

| Termo | Significado |
| --- | --- |
| **Prato** | Item do cardápio vendido ao cliente (ex.: "X-Burger"), com preço e lista de ingredientes |
| **Ingrediente** | Componente de um prato (ex.: "Cebola"). Tem um preço de adicional usado quando o cliente pede a mais |
| **Ingrediente padrão** | Ingrediente que já faz parte do prato; pode ser removido no pedido se estiver marcado como removível |
| **Adicional** | Ingrediente acrescentado a um item do pedido; soma o seu preço de adicional ao item |
| **Item do pedido** | Um prato dentro de um pedido, com quantidade, personalizações e observação |
| **Pedido** | Conjunto de itens de um atendimento, com número sequencial e situação |
| **Maquininha** | Terminal de pagamento com cartão (POS) |
| **Chave PIX** | Identificador do recebedor (CPF/CNPJ, e-mail, telefone ou aleatória) cadastrado pelo administrador |
| **BR Code / PIX Copia e Cola** | Texto no padrão EMV do Banco Central que vira o QR Code |
| **Andon** | Painel visual na cozinha que mostra os pedidos a preparar e o tempo de cada um, com cores de alerta |
| **Fila de espera** | Lista de clientes aguardando mesa, com telefone para aviso por WhatsApp |
| **Contingência** | Modo manual usado quando uma integração falha: o funcionário cobra fora do sistema e confirma no sistema |
