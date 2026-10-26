'use strict';
const ValidationError = require('../errors/ValidationError');

const MODOS_ESTIMATIVA = ['MAXIMO', 'SOMA'];
const LIMITE_MINUTOS = 100000;

function inteiroPositivo(valor, rotulo) {
  if (!Number.isSafeInteger(valor) || valor < 1) throw new ValidationError(`${rotulo} deve ser um inteiro maior ou igual a 1`);
  return valor;
}

function limitar(minutos) {
  if (!Number.isSafeInteger(minutos) || minutos > LIMITE_MINUTOS) {
    throw new ValidationError(`A estimativa de preparo excede o limite de ${LIMITE_MINUTOS} minutos`);
  }
  return minutos;
}

/**
 * Estima o preparo em minutos. itens: [{ tipo: 'PRATO'|'BEBIDA', tempoPreparoMin, quantidade? }].
 * MAXIMO: maior tempo entre os pratos; SOMA: soma de tempo × quantidade dos pratos. Bebidas valem 0.
 */
function estimarPreparo(itens, modo = 'MAXIMO') {
  if (!MODOS_ESTIMATIVA.includes(modo)) throw new ValidationError('Modo de estimativa inválido');
  if (!Array.isArray(itens)) throw new ValidationError('Os itens devem ser uma lista');

  let resultado = 0;
  for (const item of itens) {
    if (!item || typeof item !== 'object') throw new ValidationError('Item inválido');
    if (item.tipo === 'BEBIDA') continue;
    if (item.tipo !== 'PRATO') throw new ValidationError('O tipo do item deve ser PRATO ou BEBIDA');
    const tempo = inteiroPositivo(item.tempoPreparoMin, 'O tempo de preparo');
    if (modo === 'MAXIMO') {
      resultado = Math.max(resultado, tempo);
    } else {
      const quantidade = item.quantidade === undefined ? 1 : inteiroPositivo(item.quantidade, 'A quantidade');
      resultado = limitar(resultado + limitar(tempo * quantidade));
    }
  }
  return limitar(resultado);
}

module.exports = { estimarPreparo, MODOS_ESTIMATIVA };
