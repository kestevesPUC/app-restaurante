'use strict';
const NotFoundError = require('../../../domain/errors/NotFoundError');

/** Consulta da auditoria — somente nível A. Não há rotas de alteração: a trilha é imutável. */
class AuditController {
  /** @param {import('../../../infrastructure/repositories/AuditRepository')} repository */
  constructor(repository) {
    this.repository = repository;
  }

  register(router) {
    const admin = { nivel: 'A' };
    router.add('GET', '/api/auditoria', (ctx) => this.repository.search(ctx.query), admin);
    router.add('GET', '/api/auditoria/:id', (ctx) => this.#obter(ctx.params.id), admin);
  }

  #obter(id) {
    const registro = this.repository.findById(id);
    if (!registro) throw new NotFoundError('Registro de auditoria não encontrado');
    return registro;
  }
}

module.exports = AuditController;
