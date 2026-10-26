'use strict';
const ExcelJS = require('exceljs');
const textoSeguro = require('../csv/textoSeguro');
const { duracao, data, totaisExibiveis, periodoTexto, geradoEm } = require('./formatosRelatorio');

const FORMATO_DINHEIRO = '"R$" #,##0.00';
const VAZIO = 'Nenhum dado no período';
const LINHA_CABECALHO = 5;

/** Exporta um relatório para .xlsx (dinheiro e inteiros como números; textos neutralizados contra injeção de fórmula). */
class ExcelExportador {
  constructor({ agora = () => new Date() } = {}) {
    this.agora = agora;
    this.extensao = 'xlsx';
    this.contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  async exportar(relatorio) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Relatório');
    const { colunas, linhas } = relatorio;
    ws.addRow([textoSeguro(relatorio.titulo)]).font = { bold: true, size: 14 };
    const periodo = periodoTexto(relatorio.periodo);
    ws.addRow([periodo ? `Período: ${periodo}` : 'Período: posição atual']);
    ws.addRow([`Gerado em: ${geradoEm(this.agora())}`]);
    ws.addRow([]);
    ws.addRow(colunas.map((c) => textoSeguro(c.titulo))).font = { bold: true };
    const larg = colunas.map((c) => Math.max(10, c.titulo.length + 2));
    for (const l of linhas) {
      const row = ws.addRow(colunas.map((c) => this.#valor(c, l[c.chave])));
      colunas.forEach((c, i) => {
        if (c.tipo === 'dinheiro') row.getCell(i + 1).numFmt = FORMATO_DINHEIRO;
        larg[i] = Math.min(50, Math.max(larg[i], String(row.getCell(i + 1).text).length + 2));
      });
    }
    larg.forEach((w, i) => { ws.getColumn(i + 1).width = i === 0 ? Math.max(w, 24) : w; });
    ws.autoFilter = { from: { row: LINHA_CABECALHO, column: 1 }, to: { row: LINHA_CABECALHO, column: colunas.length } };
    if (linhas.length === 0) ws.addRow([VAZIO]);
    else this.#totais(ws, relatorio.totais);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  #valor(coluna, v) {
    if (v === null || v === undefined || v === '') return null;
    switch (coluna.tipo) {
      case 'dinheiro': return Number(v) / 100;
      case 'inteiro': return Number(v);
      case 'duracao': return duracao(v);
      case 'data': return textoSeguro(data(v));
      default: return textoSeguro(v);
    }
  }

  #totais(ws, totais) {
    const itens = totaisExibiveis(totais);
    if (itens.length === 0) return;
    ws.addRow([]);
    ws.addRow(['Totais']).font = { bold: true };
    for (const t of itens) {
      const row = ws.addRow([t.rotulo, t.tipo === 'dinheiro' ? t.valor / 100 : t.tipo === 'duracao' ? duracao(t.valor) : Number(t.valor)]);
      if (t.tipo === 'dinheiro') row.getCell(2).numFmt = FORMATO_DINHEIRO;
      row.getCell(1).font = { bold: true };
    }
  }
}

module.exports = ExcelExportador;
