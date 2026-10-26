'use strict';
const ValidationError = require('../errors/ValidationError');

const NOME_MAX = 60;

/** Minúsculas e sem acento: base da unicidade de nomes ("Pão" == "pao"). */
function normalizarNome(nome) {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function validarNome(valor) {
  const nome = typeof valor === 'string' ? valor.trim() : '';
  if (!nome) throw new ValidationError('Informe o nome');
  if ([...nome].length > NOME_MAX) throw new ValidationError(`O nome deve ter no máximo ${NOME_MAX} caracteres`);
  return nome;
}

function inteiroNaoNegativo(valor, rotulo) {
  if (!Number.isInteger(valor) || valor < 0) throw new ValidationError(`${rotulo} deve ser um inteiro maior ou igual a zero`);
  return valor;
}

function booleano(valor, rotulo) {
  if (typeof valor !== 'boolean') throw new ValidationError(`${rotulo} deve ser verdadeiro ou falso`);
  return valor;
}

/** Aplica `body` sobre `base`: campos ausentes mantêm o valor atual (ou o padrão, na criação). */
function mesclar(base, body) {
  const informado = Object.fromEntries(Object.entries(body || {}).filter(([, v]) => v !== undefined));
  return { ...base, ...informado };
}

const CATEGORIA_PADRAO = { nome: undefined, ordem: 0, vaiParaCozinha: true, ativo: true };
const INGREDIENTE_PADRAO = { nome: undefined, precoAdicionalCents: 0, podeSerAdicional: false, ativo: true };

function validarCategoria(body, atual = CATEGORIA_PADRAO) {
  const d = mesclar(atual, body);
  return {
    nome: validarNome(d.nome),
    ordem: inteiroNaoNegativo(d.ordem, 'A ordem'),
    vaiParaCozinha: booleano(d.vaiParaCozinha, 'vaiParaCozinha'),
    ativo: booleano(d.ativo, 'ativo'),
  };
}

function validarIngrediente(body, atual = INGREDIENTE_PADRAO) {
  const d = mesclar(atual, body);
  return {
    nome: validarNome(d.nome),
    precoAdicionalCents: inteiroNaoNegativo(d.precoAdicionalCents, 'precoAdicionalCents'),
    podeSerAdicional: booleano(d.podeSerAdicional, 'podeSerAdicional'),
    ativo: booleano(d.ativo, 'ativo'),
  };
}

module.exports = { normalizarNome, validarNome, booleano, mesclar, validarCategoria, validarIngrediente, NOME_MAX };
