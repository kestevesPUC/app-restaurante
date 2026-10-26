'use strict';
const ValidationError = require('../errors/ValidationError');
const { exigirObjeto, inteiro } = require('./bebidaValidator');

const MOTIVO_MAX = 200;
const TIPOS_AVULSOS = ['ENTRADA', 'SAIDA', 'AJUSTE'];
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;

function validarMotivo(valor, obrigatorio) {
  const motivo = typeof valor === 'string' ? valor.trim() : '';
  if (!motivo) {
    if (obrigatorio) throw new ValidationError('Informe o motivo');
    return null;
  }
  if ([...motivo].length > MOTIVO_MAX) throw new ValidationError(`O motivo deve ter no máximo ${MOTIVO_MAX} caracteres`);
  return motivo;
}

/**
 * Movimentação avulsa pedida pela API.
 * @returns {{tipo:string, quantidade?:number, novaQuantidade?:number, motivo:string|null}}
 */
function validarMovimentacao(body) {
  exigirObjeto(body);
  if (!TIPOS_AVULSOS.includes(body.tipo)) throw new ValidationError(`Informe o tipo (${TIPOS_AVULSOS.join(', ')})`);
  if (body.tipo === 'AJUSTE') {
    return { tipo: 'AJUSTE', novaQuantidade: inteiro(body.novaQuantidade, 'A nova quantidade', 0), motivo: validarMotivo(body.motivo, true) };
  }
  return { tipo: body.tipo, quantidade: inteiro(body.quantidade, 'A quantidade', 1), motivo: validarMotivo(body.motivo, body.tipo === 'SAIDA') };
}

/** `?limite=` das movimentações: inteiro de 1 a 500 (padrão 50). */
function validarLimite(valor) {
  if (valor === undefined) return LIMITE_PADRAO;
  if (!/^\d{1,4}$/.test(String(valor)) || Number(valor) < 1 || Number(valor) > LIMITE_MAXIMO) {
    throw new ValidationError(`O limite deve ser um inteiro de 1 a ${LIMITE_MAXIMO}`);
  }
  return Number(valor);
}

const critico = (bebida) => bebida.estoqueQtd <= bebida.estoqueMinimo;

module.exports = { validarMovimentacao, validarLimite, critico, TIPOS_AVULSOS, LIMITE_PADRAO, LIMITE_MAXIMO };
