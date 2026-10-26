'use strict';
const ValidationError = require('./errors/ValidationError');

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);
const MENSAGEM = 'Telefone inválido: informe DDD e número, como (11) 99999-8888';

/** Normaliza um telefone brasileiro para '+55' + DDD + número. @throws {ValidationError} */
function normalizarTelefone(texto) {
  if (typeof texto !== 'string' || !/^[\d\s()+-]+$/.test(texto)) throw new ValidationError(MENSAGEM);
  let digitos = texto.replace(/\D/g, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  const celular = numero.length === 9 && numero[0] === '9';
  const fixo = numero.length === 8 && /[2-5]/.test(numero[0]);
  if (digitos.length < 10 || !DDDS_VALIDOS.has(Number(ddd)) || !(celular || fixo)) throw new ValidationError(MENSAGEM);
  return `+55${ddd}${numero}`;
}

module.exports = { normalizarTelefone };
