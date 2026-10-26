'use strict';

/** Rotas de /api/estoque: leitura para A/B. */
class EstoqueController {
  /** @param {import('../../../application/EstoqueService')} service */
  constructor(service) {
    this.service = service;
  }

  register(router) {
    router.add('GET', '/api/estoque/critico', () => this.service.criticas());
  }
}

module.exports = EstoqueController;
