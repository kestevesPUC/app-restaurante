'use strict';
const ValidationError = require('../errors/ValidationError');
const { validarNome, booleano, mesclar } = require('../cardapio/validators');
const { inteiro, exigirObjeto, ESTOQUE_MAXIMO } = require('./movimentos');

const PRECO_MAXIMO_CENTS = 100_000_000;

const BEBIDA_PADRAO = { nome: undefined, precoCents: undefined, estoqueMinimo: 0, ativo: true };

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
    precoCents: inteiro(d.precoCents, 'O preço (precoCents)', 1, PRECO_MAXIMO_CENTS),
    estoqueMinimo: inteiro(d.estoqueMinimo, 'O estoque mínimo', 0, ESTOQUE_MAXIMO),
    ativo: booleano(d.ativo, 'ativo'),
    estoqueInicial: atual ? 0 : inteiro(body.estoqueQtd ?? 0, 'O estoque inicial', 0, ESTOQUE_MAXIMO),
  };
}

module.exports = { validarBebida, PRECO_MAXIMO_CENTS };
