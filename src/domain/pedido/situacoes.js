'use strict';

const SITUACOES = ['ABERTO', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO'];

const TRANSICOES = new Map([
  ['ABERTO', ['AGUARDANDO_PAGAMENTO', 'CANCELADO']],
  ['AGUARDANDO_PAGAMENTO', ['ABERTO', 'PAGO', 'CANCELADO']],
  ['PAGO', ['CANCELADO']],
  ['CANCELADO', []],
]);

/** Transições permitidas entre situações do pedido; qualquer outra (ou desconhecida) é falsa. */
function podeTransitar(de, para) {
  const destinos = TRANSICOES.get(de);
  return Boolean(destinos) && destinos.includes(para);
}

module.exports = { SITUACOES, podeTransitar };
