'use strict';

/** Rotas CRUD de um cadastro simples (/api/<recurso>): leitura para A/B, escrita só para o nível A. */
class CadastroController {
  /**
   * @param {string} resource nome da rota (ex.: 'ingredientes')
   * @param {import('../../../application/CadastroService')} service
   */
  constructor(resource, service) {
    this.resource = resource;
    this.service = service;
  }

  register(router) {
    const base = `/api/${this.resource}`;
    const admin = { nivel: 'A' };
    router.add('GET', base, () => this.service.list());
    router.add('POST', base, (ctx) => this.service.create(ctx.user, ctx.body), admin);
    router.add('PUT', `${base}/:id`, (ctx) => this.service.update(ctx.user, Number(ctx.params.id), ctx.body), admin);
    router.add('DELETE', `${base}/:id`, (ctx) => this.service.remove(ctx.user, Number(ctx.params.id)), admin);
  }
}

module.exports = CadastroController;
