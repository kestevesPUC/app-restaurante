'use strict';
const ValidationError = require('../../../domain/errors/ValidationError');
const { dataIso, idPositivo } = require('../validacaoHttp');
const FileResponse = require('../FileResponse');
const { AGRUPAMENTOS, LIMITE_MAXIMO } = require('../../../domain/relatorio/tipos');

/** Rotas de /api/relatorios (só A; a autorização fica no serviço). */
class RelatorioController {
  /**
   * @param {import('../../../application/RelatorioService')} relatorios
   * @param {Record<string, import('../../../application/ports/ExportadorRelatorio').ExportadorRelatorio>} exportadores por formato (xlsx, pdf)
   * @param {() => number} relogio
   */
  constructor(relatorios, exportadores = {}, relogio = Date.now) {
    this.relatorios = relatorios;
    this.exportadores = exportadores;
    this.relogio = relogio;
  }

  register(router) {
    router.add('GET', '/api/relatorios', (ctx) => this.relatorios.listar(ctx.user));
    router.add('GET', '/api/relatorios/:tipo', (ctx) => this.#gerar(ctx));
  }

  async #gerar(ctx) {
    const formato = ctx.query?.formato ?? 'json';
    const filtros = this.#filtros(ctx.query);
    const relatorio = this.relatorios.gerar(ctx.user, ctx.params.tipo, filtros);
    if (formato === 'json') return relatorio;
    const exportador = Object.hasOwn(this.exportadores, formato) ? this.exportadores[formato] : null;
    if (!exportador) throw new ValidationError('Formato inválido: use json, xlsx ou pdf');
    const d = new Date(this.relogio());
    const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return new FileResponse({
      filename: `relatorio-${ctx.params.tipo}-${dia}.${exportador.extensao}`, contentType: exportador.contentType, body: await exportador.exportar(relatorio),
    });
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
