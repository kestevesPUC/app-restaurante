'use strict';

/**
 * Porta: exporta um relatório (`RelatorioService.gerar`) para um arquivo.
 * @typedef {object} ExportadorRelatorio
 * @property {string} extensao extensão sem ponto (ex.: "xlsx")
 * @property {string} contentType tipo MIME da resposta
 * @property {(relatorio: object) => Promise<Buffer>} exportar gera o arquivo
 */
module.exports = {};
