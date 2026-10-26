'use strict';
const ValidationError = require('../errors/ValidationError');
const { validarNome, booleano, mesclar } = require('../cardapio/validators');

const BEBIDA_PADRAO = { nome: undefined, precoCents: undefined, estoqueMinimo: 0, ativo: true };

function inteiro(valor, rotulo, minimo) {
  if (!Number.isInteger(valor) || valor < minimo) {
    throw new ValidationError(`${rotulo} deve ser um inteiro maior ou igual a ${minimo}`);
  }
  return valor;
}

function exigirObjeto(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('O corpo deve ser um objeto JSON');
}

/**
 * Valida os dados cadastrais da bebida. O saldo só entra na criação (`estoqueQtd` inicial);
 * depois dela, qualquer alteração de saldo passa por uma movimentação de estoque.
 * @returns {{nome:string, precoCents:number, estoqueMinimo:number, ativo:boolean, estoqueInicial:number}}
 */
function validarBebida(body, atual = null) {
  exigirObjeto(body);
  if (atual && body.estoqueQtd !== undefined) throw new ValidationError('Use uma movimentação de estoque para alterar o saldo');
  const d = mesclar(atual || BEBIDA_PADRAO, body);
  return {
    nome: validarNome(d.nome),
    precoCents: inteiro(d.precoCents, 'O preço (precoCents)', 1),
    estoqueMinimo: inteiro(d.estoqueMinimo, 'O estoque mínimo', 0),
    ativo: booleano(d.ativo, 'ativo'),
    estoqueInicial: atual ? 0 : inteiro(body.estoqueQtd ?? 0, 'O estoque inicial', 0),
  };
}

module.exports = { validarBebida, exigirObjeto, inteiro };
