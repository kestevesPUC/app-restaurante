'use strict';
const ValidationError = require('../../../domain/errors/ValidationError');
const { dataIso, idPositivo } = require('../validacaoHttp');
const { AGRUPAMENTOS, LIMITE_MAXIMO } = require('../../../domain/relatorio/tipos');

/** Rotas de /api/relatorios (só A; a autorização fica no serviço). */
class RelatorioController {
  /** @param {import('../../../application/RelatorioService')} relatorios */
  constructor(relatorios) {
    this.relatorios = relatorios;
  }

  register(router) {
    router.add('GET', '/api/relatorios', (ctx) => this.relatorios.listar(ctx.user));
    router.add('GET', '/api/relatorios/:tipo', (ctx) => this.relatorios.gerar(ctx.user, ctx.params.tipo, this.#filtros(ctx.query)));
  }

  #filtros(query = {}) {
    const filtros = {};
    if (query.de !== undefined) filtros.de = dataIso(query.de, 'A data inicial');
    if (query.ate !== undefined) filtros.ate = dataIso(query.ate, 'A data final');
    if (filtros.de && filtros.ate && filtros.de > filtros.ate) throw new ValidationError('A data inicial não pode ser posterior à data final');
    if (query.agrupar !== undefined) {
      if (!AGRUPAMENTOS.includes(query.agrupar)) throw new ValidationError('Agrupamento inválido: use dia, mes ou ano');
      filtros.agrupar = query.agrupar;
    }
    if (query.limite !== undefined) {
      filtros.limite = idPositivo(query.limite, 'O limite');
      if (filtros.limite > LIMITE_MAXIMO) throw new ValidationError(`O limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO}`);
    }
    return filtros;
  }
}

module.exports = RelatorioController;
