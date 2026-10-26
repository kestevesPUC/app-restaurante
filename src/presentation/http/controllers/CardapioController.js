'use strict';

/** Cardápio: /api/cardapio (só ativos, para o pedido) e /api/cardapio/completo (com inativos e estoque, para consulta). A e B. */
class CardapioController {
  /**
   * @param {import('../../../application/PratoService')} service
   * @param {import('../../../application/BebidaService')} bebidas
   */
  constructor(service, bebidas) {
    this.service = service;
    this.bebidas = bebidas;
  }

  register(router) {
    router.add('GET', '/api/cardapio', () => this.service.cardapio());
    router.add('GET', '/api/cardapio/completo', () => ({
      categorias: this.service.categorias.findAll(),
      pratos: this.service.list(),
      bebidas: this.bebidas.list(),
    }));
  }
}

module.exports = CardapioController;
