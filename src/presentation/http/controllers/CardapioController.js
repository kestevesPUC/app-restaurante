'use strict';

/** GET /api/cardapio: categorias, pratos e adicionais ativos numa única chamada (A e B). */
class CardapioController {
  /** @param {import('../../../application/PratoService')} service */
  constructor(service) {
    this.service = service;
  }

  register(router) {
    router.add('GET', '/api/cardapio', () => this.service.cardapio());
  }
}

module.exports = CardapioController;
