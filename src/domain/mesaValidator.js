'use strict';
const ValidationError = require('./errors/ValidationError');
const { booleano, mesclar } = require('./cardapio/validators');

const NUMERO_MAX = 10;
const MESA_PADRAO = { numero: undefined, capacidade: undefined, ativo: true };

/** Valida o corpo de uma mesa (`atual` = mesa existente, no PUT). Devolve `{ numero, capacidade, ativo }`. */
function validarMesa(body, atual = MESA_PADRAO) {
  const d = mesclar(atual, body);
  const numero = typeof d.numero === 'string' ? d.numero.trim() : '';
  if (!numero) throw new ValidationError('Informe o número da mesa');
  if ([...numero].length > NUMERO_MAX) throw new ValidationError(`O número da mesa deve ter no máximo ${NUMERO_MAX} caracteres`);
  if (!Number.isInteger(d.capacidade) || d.capacidade < 1) throw new ValidationError('A capacidade deve ser um inteiro maior ou igual a 1');
  return { numero, capacidade: d.capacidade, ativo: booleano(d.ativo, 'ativo') };
}

module.exports = { validarMesa, NUMERO_MAX };
