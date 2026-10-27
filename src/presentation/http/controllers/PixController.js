'use strict';

/** Rotas do PIX: cadastro de chaves só para o nível A; a cobrança de um pedido para A e B. */
class PixController {
  /** @param {import('../../../application/PixService')} service */
  constructor(service) {
    this.service = service;
  }

  register(router) {
    const admin = { nivel: 'A' };
    const id = (ctx) => Number(ctx.params.id);
    router.add('GET', '/api/pix/chaves', () => this.service.list(), admin);
    router.add('POST', '/api/pix/chaves', (ctx) => this.service.create(ctx.user, ctx.body), admin);
    router.add('PUT', '/api/pix/chaves/:id', (ctx) => this.service.update(ctx.user, id(ctx), ctx.body), admin);
    router.add('DELETE', '/api/pix/chaves/:id', (ctx) => this.service.remove(ctx.user, id(ctx)), admin);
    router.add('POST', '/api/pix/chaves/:id/padrao', (ctx) => this.service.definirPadrao(ctx.user, id(ctx)), admin);
    router.add('GET', '/api/pedidos/:id/pix', (ctx) => this.service.cobrancaDoPedido(ctx.user, id(ctx)));
  }
}

module.exports = PixController;
