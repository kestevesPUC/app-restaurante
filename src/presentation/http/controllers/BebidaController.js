'use strict';
const { idPositivo } = require('../validacaoHttp');

/** Rotas de /api/bebidas: leitura para A/B, escrita e movimentações só para o nível A. */
class BebidaController {
  /**
   * @param {import('../../../application/BebidaService')} bebidas
   * @param {import('../../../application/EstoqueService')} estoque
   */
  constructor(bebidas, estoque) {
    this.bebidas = bebidas;
    this.estoque = estoque;
  }

  register(router) {
    const admin = { nivel: 'A' };
    const id = (ctx) => idPositivo(ctx.params.id, 'A bebida');
    router.add('GET', '/api/bebidas', () => this.bebidas.list());
    router.add('POST', '/api/bebidas', (ctx) => this.bebidas.create(ctx.user, ctx.body), admin);
    router.add('PUT', '/api/bebidas/:id', (ctx) => this.bebidas.update(ctx.user, id(ctx), ctx.body), admin);
    router.add('DELETE', '/api/bebidas/:id', (ctx) => this.bebidas.remove(ctx.user, id(ctx)), admin);
    router.add('POST', '/api/bebidas/:id/movimentacoes', (ctx) => this.estoque.movimentar(ctx.user, id(ctx), ctx.body), admin);
    router.add('GET', '/api/bebidas/:id/movimentacoes', (ctx) => this.estoque.listarMovimentacoes(id(ctx), ctx.query.limite));
  }
}

module.exports = BebidaController;
