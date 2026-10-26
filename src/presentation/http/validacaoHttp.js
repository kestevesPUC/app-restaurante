'use strict';
const ValidationError = require('../../domain/errors/ValidationError');

const { STATUS } = require('../../domain/pedido/status');

const Q_MAX = 80;

/** Inteiro positivo vindo de rota ou query (texto); nunca devolve NaN. */
function idPositivo(valor, rotulo = 'O identificador') {
  const texto = String(valor ?? '');
  const numero = Number(texto);
  if (!/^\d{1,15}$/.test(texto) || !Number.isSafeInteger(numero) || numero < 1) throw new ValidationError(`${rotulo} é inválido`);
  return numero;
}

/** Data AAAA-MM-DD que existe no calendário. */
function dataIso(valor, rotulo) {
  const texto = String(valor ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!d || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new ValidationError(`${rotulo} deve estar no formato AAAA-MM-DD`);
  }
  return texto;
}

/** Filtros de listagem de pedidos (query string): de, ate (de <= ate), status, q (até 80 caracteres; repetido vale o último), limite (1–1000). */
function filtrosDePedidos(query = {}) {
  const filtros = {};
  if (query.de !== undefined) filtros.de = dataIso(query.de, 'A data inicial');
  if (query.ate !== undefined) filtros.ate = dataIso(query.ate, 'A data final');
  if (query.status !== undefined && query.status !== '') {
    if (!STATUS.includes(query.status)) throw new ValidationError('Status inválido');
    filtros.status = query.status;
  }
  if (query.limite !== undefined && query.limite !== '') {
    filtros.limite = idPositivo(query.limite, 'O limite');
    if (filtros.limite > 1000) throw new ValidationError('O limite deve ser um inteiro entre 1 e 1000');
  }
  if (typeof query.q === 'string' && query.q.trim()) {
    if ([...query.q].length > Q_MAX) throw new ValidationError(`A busca deve ter no máximo ${Q_MAX} caracteres`);
    filtros.q = query.q;
  }
  if (filtros.de && filtros.ate && filtros.de > filtros.ate) throw new ValidationError('A data inicial não pode ser posterior à data final');
  return filtros;
}

module.exports = { idPositivo, dataIso, filtrosDePedidos };
