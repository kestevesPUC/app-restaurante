'use strict';
const ValidationError = require('../../../domain/errors/ValidationError');
const { idPositivo } = require('../validacaoHttp');

const Q_MAX = 80;

/** Rotas de /api/clientes (A e B): busca e histórico. */
class ClienteController {
  /** @param {import('../../../application/ClienteService')} clientes */
  constructor(clientes) {
    this.clientes = clientes;
  }

  register(router) {
    router.add('GET', '/api/clientes', (ctx) => this.clientes.buscar(ctx.user, this.#filtros(ctx.query)));
    router.add('GET', '/api/clientes/:id', (ctx) => this.clientes.historico(ctx.user, idPositivo(ctx.params.id, 'O cliente')));
  }

  #filtros(query = {}) {
    const filtros = {};
    if (query.limite !== undefined) {
      filtros.limite = idPositivo(query.limite, 'O limite');
      if (filtros.limite > 200) throw new ValidationError('O limite deve ser um inteiro entre 1 e 200');
    }
    if (typeof query.q === 'string') {
      if ([...query.q].length > Q_MAX) throw new ValidationError(`A busca deve ter no máximo ${Q_MAX} caracteres`);
      filtros.q = query.q;
    }
    return filtros;
  }
}

module.exports = ClienteController;
