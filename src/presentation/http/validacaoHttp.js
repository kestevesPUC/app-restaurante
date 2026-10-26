'use strict';
const ValidationError = require('../../domain/errors/ValidationError');

const SITUACOES_PEDIDO = ['ABERTO', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO'];

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

/** Filtros de listagem de pedidos (query string); o filtro `forma` é aceito e ignorado por enquanto. */
function filtrosDePedidos(query = {}) {
  const filtros = {};
  if (query.de !== undefined) filtros.de = dataIso(query.de, 'A data inicial');
  if (query.ate !== undefined) filtros.ate = dataIso(query.ate, 'A data final');
  if (query.situacao !== undefined && query.situacao !== '') {
    if (!SITUACOES_PEDIDO.includes(query.situacao)) throw new ValidationError('Situação inválida');
    filtros.situacao = query.situacao;
  }
  if (query.mesaId !== undefined && query.mesaId !== '') filtros.mesaId = idPositivo(query.mesaId, 'A mesa');
  if (query.atendenteId !== undefined && query.atendenteId !== '') filtros.atendenteId = idPositivo(query.atendenteId, 'O atendente');
  if (typeof query.q === 'string' && query.q.trim()) filtros.q = query.q;
  return filtros;
}

module.exports = { idPositivo, dataIso, filtrosDePedidos };
