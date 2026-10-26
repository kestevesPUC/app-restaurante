'use strict';
const FileResponse = require('../FileResponse');

/** Rotas de /api/pratos: leitura para A/B, escrita só para o nível A. */
class PratoController {
  /** @param {import('../../../application/PratoService')} service */
  constructor(service) {
    this.service = service;
  }

  register(router) {
    const admin = { nivel: 'A' };
    const id = (ctx) => Number(ctx.params.id);
    router.add('GET', '/api/pratos', () => this.service.list());
    router.add('POST', '/api/pratos', (ctx) => this.service.create(ctx.user, ctx.body), admin);
    router.add('PUT', '/api/pratos/:id', (ctx) => this.service.update(ctx.user, id(ctx), ctx.body), admin);
    router.add('DELETE', '/api/pratos/:id', (ctx) => this.service.remove(ctx.user, id(ctx)), admin);
    router.add('GET', '/api/pratos/:id/foto', (ctx) => {
      const { tipo, dados } = this.service.foto(id(ctx));
      return new FileResponse({ filename: `prato-${id(ctx)}`, contentType: tipo, body: dados, disposition: 'inline', cacheControl: 'private, no-cache' });
    });
    router.add('PUT', '/api/pratos/:id/foto', (ctx) => this.service.definirFoto(ctx.user, id(ctx), ctx.body.foto), admin);
    router.add('DELETE', '/api/pratos/:id/foto', (ctx) => this.service.removerFoto(ctx.user, id(ctx)), admin);
  }
}

module.exports = PratoController;
