'use strict';
const PDFDocument = require('pdfkit');
const { mascararTelefone } = require('../../domain/phone');
const { duracao, data, reais, totaisExibiveis, periodoTexto, geradoEm } = require('./formatosRelatorio');

const MARGEM = 30;
const ALTURA_LINHA = 18;
const VAZIO = 'Nenhum dado no período';
const NUMERICOS = ['dinheiro', 'inteiro', 'duracao'];

/** Exporta um relatório para PDF (A4 paisagem, tabela com cabeçalho repetido e quebra de página). */
class PdfExportador {
  constructor({ agora = () => new Date() } = {}) {
    this.agora = agora;
    this.extensao = 'pdf';
    this.contentType = 'application/pdf';
  }

  exportar(relatorio, { comprimir = true } = {}) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGEM, compress: comprimir });
      const partes = [];
      doc.on('data', (p) => partes.push(p));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      try {
        this.#desenhar(doc, relatorio);
        doc.end();
      } catch (e) { reject(e); }
    });
  }

  #desenhar(doc, { titulo, periodo, colunas, linhas, totais }) {
    doc.font('Helvetica-Bold').fontSize(16).text(titulo, MARGEM, MARGEM, { lineBreak: false });
    doc.font('Helvetica').fontSize(9);
    const p = periodoTexto(periodo);
    doc.text(p ? `Período: ${p}` : 'Período: posição atual', MARGEM, MARGEM + 24, { lineBreak: false });
    doc.text(`Gerado em: ${geradoEm(this.agora())}`, MARGEM, MARGEM + 36, { lineBreak: false });
    let y = MARGEM + 56;
    if (linhas.length === 0) { doc.fontSize(11).text(VAZIO, MARGEM, y, { lineBreak: false }); return; }
    const largura = (doc.page.width - 2 * MARGEM) / colunas.length;
    y = this.#cabecalho(doc, colunas, largura, y);
    for (const l of linhas) {
      if (y + ALTURA_LINHA > doc.page.height - MARGEM) { doc.addPage(); y = this.#cabecalho(doc, colunas, largura, MARGEM); }
      this.#linha(doc, colunas.map((c) => this.#texto(c.tipo, l[c.chave])), colunas, largura, y, 'Helvetica');
      y += ALTURA_LINHA;
    }
    this.#totais(doc, totaisExibiveis(totais), y);
  }

  #totais(doc, itens, yInicial) {
    if (itens.length === 0) return;
    let y = yInicial + 6;
    if (y + ALTURA_LINHA * (itens.length + 1) > doc.page.height - MARGEM) { doc.addPage(); y = MARGEM; }
    doc.font('Helvetica-Bold').fontSize(10).text('Totais', MARGEM, y, { lineBreak: false });
    y += ALTURA_LINHA;
    for (const t of itens) {
      doc.font('Helvetica').fontSize(9).text(`${t.rotulo}: ${this.#texto(t.tipo, t.valor)}`, MARGEM, y, { lineBreak: false });
      y += ALTURA_LINHA;
    }
  }

  #cabecalho(doc, colunas, largura, y) {
    doc.rect(MARGEM, y, largura * colunas.length, ALTURA_LINHA).fill('#e5e7eb');
    this.#linha(doc, colunas.map((c) => c.titulo), colunas, largura, y, 'Helvetica-Bold');
    return y + ALTURA_LINHA;
  }

  #linha(doc, textos, colunas, largura, y, fonte) {
    doc.font(fonte).fontSize(9).fillColor('black');
    textos.forEach((t, i) => {
      doc.text(String(t), MARGEM + i * largura + 3, y + 4, {
        width: largura - 6, height: ALTURA_LINHA - 4, lineBreak: false, ellipsis: true, align: NUMERICOS.includes(colunas[i].tipo) ? 'right' : 'left',
      });
    });
  }

  #texto(tipo, v) {
    if (v === null || v === undefined || v === '') return '';
    switch (tipo) {
      case 'dinheiro': return reais(v);
      case 'duracao': return duracao(v);
      case 'data': return data(v);
      case 'telefone': return mascararTelefone(v);
      case 'inteiro': return String(Number(v));
      default: return String(v);
    }
  }
}

module.exports = PdfExportador;
