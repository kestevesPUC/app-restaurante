'use strict';

const STATUS = ['ABERTO', 'RECEBIDO', 'EM_PREPARO', 'PRONTO_RETIRADA', 'PRONTO_ENTREGA', 'FINALIZADO', 'CANCELADO'];

const TRANSICOES = new Map([
  ['ABERTO', new Set(['RECEBIDO', 'CANCELADO'])],
  ['RECEBIDO', new Set(['EM_PREPARO', 'ABERTO', 'CANCELADO'])],
  ['EM_PREPARO', new Set(['PRONTO_RETIRADA', 'PRONTO_ENTREGA', 'CANCELADO'])],
  ['PRONTO_RETIRADA', new Set(['FINALIZADO', 'EM_PREPARO', 'CANCELADO'])],
  ['PRONTO_ENTREGA', new Set(['FINALIZADO', 'EM_PREPARO', 'CANCELADO'])],
  ['FINALIZADO', new Set()],
  ['CANCELADO', new Set()],
]);

const PRONTOS = new Set(['PRONTO_RETIRADA', 'PRONTO_ENTREGA']);

/** Transições válidas; qualquer outra (inclusive mesma situação ou valor desconhecido) é falsa. */
function podeTransitar(de, para) {
  const destinos = TRANSICOES.get(de);
  return destinos !== undefined && destinos.has(para);
}

/** Transições que a Cozinha faz sozinha (nível C). */
function daCozinha(de, para) {
  return (de === 'RECEBIDO' && para === 'EM_PREPARO')
    || (de === 'EM_PREPARO' && PRONTOS.has(para))
    || (PRONTOS.has(de) && para === 'EM_PREPARO');
}

function finaliza(de, para) {
  return PRONTOS.has(de) && para === 'FINALIZADO';
}

/** Permissão por nível (A = tudo, B = sem cozinha, C = só cozinha e finalizar). */
function podeMudarStatus(nivel, de, para) {
  if (!podeTransitar(de, para)) return false;
  if (nivel === 'A') return true;
  if (nivel === 'B') return !daCozinha(de, para);
  if (nivel === 'C') return daCozinha(de, para) || finaliza(de, para);
  return false;
}

module.exports = { STATUS, podeTransitar, podeMudarStatus };
