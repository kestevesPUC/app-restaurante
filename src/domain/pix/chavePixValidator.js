'use strict';
const ValidationError = require('../errors/ValidationError');
const { mesclar } = require('../cardapio/validators');
const { NOME_MAX, CIDADE_MAX } = require('./brcode');

const TIPOS = ['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA'];
const PADRAO = { descricao: undefined, tipo: undefined, chave: undefined, nomeRecebedor: undefined, cidade: undefined };

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');
const digitos = (valor) => texto(valor).replace(/\D/g, '');

/** Normaliza a chave conforme o tipo (o formato que vai no BR Code). */
function normalizarChave(tipo, valor) {
  if (tipo === 'CPF') {
    const d = digitos(valor);
    if (d.length !== 11) throw new ValidationError('O CPF deve ter 11 dígitos');
    return d;
  }
  if (tipo === 'CNPJ') {
    const d = digitos(valor);
    if (d.length !== 14) throw new ValidationError('O CNPJ deve ter 14 dígitos');
    return d;
  }
  if (tipo === 'EMAIL') {
    const e = texto(valor).toLowerCase();
    if (e.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('Informe um e-mail válido');
    return e;
  }
  if (tipo === 'TELEFONE') {
    let d = digitos(valor);
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    if (!/^55\d{10,11}$/.test(d)) throw new ValidationError('Informe o telefone com DDD');
    return `+${d}`;
  }
  const a = texto(valor).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a)) throw new ValidationError('A chave aleatória deve ser um código no formato 00000000-0000-0000-0000-000000000000');
  return a;
}

/** Valida o corpo de uma chave PIX (`atual` = chave existente, no PUT). */
function validarChavePix(body, atual = PADRAO) {
  const d = mesclar(atual, body);
  const descricao = texto(d.descricao);
  if (!descricao) throw new ValidationError('Informe a descrição');
  if (descricao.length > 60) throw new ValidationError('A descrição deve ter no máximo 60 caracteres');
  if (!TIPOS.includes(d.tipo)) throw new ValidationError('Tipo de chave inválido');
  const nomeRecebedor = texto(d.nomeRecebedor);
  if (!nomeRecebedor) throw new ValidationError('Informe o nome do recebedor');
  if (nomeRecebedor.length > NOME_MAX) throw new ValidationError(`O nome do recebedor deve ter no máximo ${NOME_MAX} caracteres`);
  const cidade = texto(d.cidade);
  if (!cidade) throw new ValidationError('Informe a cidade');
  if (cidade.length > CIDADE_MAX) throw new ValidationError(`A cidade deve ter no máximo ${CIDADE_MAX} caracteres`);
  return { descricao, tipo: d.tipo, chave: normalizarChave(d.tipo, d.chave), nomeRecebedor, cidade };
}

module.exports = { validarChavePix, TIPOS };
