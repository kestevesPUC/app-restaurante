'use strict';

/** Rotas de /api/mesas: leitura, ocupar e liberar para A/B; cadastro só para o nível A. */
class MesaController {
  /** @param {import('../../../application/MesaService')} service */
  constructor(service) {
    this.service = service;
  }

  register(router) {
    const admin = { nivel: 'A' };
    const id = (ctx) => Number(ctx.params.id);
    router.add('GET', '/api/mesas', () => this.service.list());
    router.add('POST', '/api/mesas', (ctx) => this.service.create(ctx.user, ctx.body), admin);
    router.add('PUT', '/api/mesas/:id', (ctx) => this.service.update(ctx.user, id(ctx), ctx.body), admin);
    router.add('DELETE', '/api/mesas/:id', (ctx) => this.service.remove(ctx.user, id(ctx)), admin);
    router.add('POST', '/api/mesas/:id/ocupar', (ctx) => this.service.ocupar(ctx.user, id(ctx)));
    router.add('POST', '/api/mesas/:id/liberar', (ctx) => this.service.liberar(ctx.user, id(ctx)));
  }
}

module.exports = MesaController;
