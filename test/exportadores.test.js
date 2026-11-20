'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const ExcelExportador = require('../src/infrastructure/export/ExcelExportador');
const PdfExportador = require('../src/infrastructure/export/PdfExportador');
const { createTestApp } = require('./helpers/createTestApp');

const AGORA = () => new Date(2026, 9, 26, 14, 5);
const excel = new ExcelExportador({ agora: AGORA });
const pdf = new PdfExportador({ agora: AGORA });

const clientes = (linhas, totais = { quantidade: linhas.length, gastoCents: 0 }) => ({
  titulo: 'Clientes com maior gasto', periodo: { de: '2026-10-01', ate: '2026-10-26' },
  colunas: [{ chave: 'cliente', titulo: 'Cliente', tipo: 'texto' }, { chave: 'quantidade', titulo: 'Pedidos', tipo: 'inteiro' }, { chave: 'gastoCents', titulo: 'Gasto', tipo: 'dinheiro' }],
  linhas, totais,
});

async function ler(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}
/** Texto de um PDF sem compressão: junta os trechos hex dos operadores TJ (WinAnsi ≈ latin1). */
function textoPdf(buffer) {
  const linhas = [];
  for (const m of buffer.toString('latin1').matchAll(/\[(.*?)\] TJ/g)) {
    linhas.push([...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return linhas.join('\n');
}
const celulas = (ws) => { const t = []; ws.eachRow((r) => t.push(r.values.slice(1))); return t; };

test('xlsx: título, período, cabeçalho em negrito, linhas e totais com valores numéricos', async () => {
  const ws = await ler(await excel.exportar(clientes([{ cliente: 'Ana', quantidade: 2, gastoCents: 12345 }], { quantidade: 2, gastoCents: 12345 })));
  assert.equal(ws.getCell('A1').value, 'Clientes com maior gasto');
  assert.equal(ws.getCell('A1').font.bold, true);
  assert.match(ws.getCell('A2').value, /01\/10\/2026 a 26\/10\/2026/);
  assert.match(ws.getCell('A3').value, /26\/10\/2026 14:05/);
  assert.deepEqual(['A5', 'B5', 'C5'].map((c) => ws.getCell(c).value), ['Cliente', 'Pedidos', 'Gasto']);
  assert.equal(ws.getCell('A5').font.bold, true);
  assert.equal(ws.getCell('C6').value, 123.45);
  assert.match(ws.getCell('C6').numFmt, /R\$.*#,##0\.00/);
  assert.equal(ws.getCell('B6').value, 2);
  const todas = celulas(ws).flat();
  assert.ok(todas.includes('Totais') && todas.includes('Faturamento') === false);
  assert.ok(todas.includes(123.45), 'total de gasto numérico');
});

test('xlsx: fórmulas em texto saem como texto seguro e número negativo continua número', async () => {
  const nomes = ['=1+1', '@SUM(A1)', '-cmd|x', '+55 Lanches', '\t=x'];
  const ws = await ler(await excel.exportar(clientes([
    ...nomes.map((cliente) => ({ cliente, quantidade: 1, gastoCents: 100 })),
    { cliente: 'Estorno', quantidade: -5, gastoCents: -250 },
  ], {})));
  nomes.forEach((n, i) => {
    const c = ws.getCell(`A${6 + i}`);
    assert.equal(c.type, ExcelJS.ValueType.String);
    assert.equal(c.value, `'${n}`);
  });
  const neg = ws.getCell('B11');
  assert.equal(neg.type, ExcelJS.ValueType.Number);
  assert.equal(neg.value, -5);
  assert.equal(ws.getCell('C11').value, -2.5);
});

test('xlsx: nome com acento e emoji preservado', async () => {
  const ws = await ler(await excel.exportar(clientes([{ cliente: 'João 🍔 Ção', quantidade: 1, gastoCents: 0 }])));
  assert.equal(ws.getCell('A6').value, 'João 🍔 Ção');
});

test('xlsx: duração legível, data dd/mm/aaaa e relatório vazio', async () => {
  const rel = {
    titulo: 'Tempo', periodo: { de: '2026-10-01', ate: '2026-10-01' },
    colunas: [{ chave: 'dia', titulo: 'Dia', tipo: 'data' }, { chave: 'd', titulo: 'Duração', tipo: 'duracao' }],
    linhas: [{ dia: '2026-10-23', d: 125 }, { dia: '2026-10-24', d: 3725 }], totais: { quantidade: 2, mediaSegundos: 1925 },
  };
  const ws = await ler(await excel.exportar(rel));
  assert.deepEqual([ws.getCell('A6').value, ws.getCell('B6').value, ws.getCell('B7').value], ['23/10/2026', '02:05', '1:02:05']);
  const vazio = await ler(await excel.exportar(clientes([])));
  assert.ok(celulas(vazio).flat().includes('Nenhum dado no período'));
});

test('pdf: começa com %PDF e contém título e nome com acento', async () => {
  const buf = await pdf.exportar(clientes([{ cliente: 'João da Conceição', quantidade: 3, gastoCents: 123456 }], { quantidade: 3, gastoCents: 123456 }), { comprimir: false });
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  const texto = textoPdf(buf);
  assert.ok(texto.includes('Clientes com maior gasto'));
  assert.ok(texto.includes('João da Conceição'));
  assert.ok(texto.includes('1.234,56'));
  assert.equal((await pdf.exportar(clientes([]))).subarray(0, 4).toString(), '%PDF');
});

test('pdf: 500 linhas geram várias páginas; emoji e textos longos não quebram', async () => {
  const linhas = Array.from({ length: 500 }, (_, i) => ({ cliente: `Cliente ${i} 🍔 ${'x'.repeat(200)}`, quantidade: i, gastoCents: i * 100 }));
  const buf = await pdf.exportar(clientes(linhas), { comprimir: false });
  const paginas = (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
  assert.ok(paginas >= 2, `páginas: ${paginas}`);
});

test('pdf: relatório vazio exporta "Nenhum dado no período"', async () => {
  const buf = await pdf.exportar(clientes([]), { comprimir: false });
  assert.ok(textoPdf(buf).includes('Nenhum dado no período'));
});

let app; let s;
beforeEach(async () => { app = await createTestApp(); s = app.app.services; });
afterEach(async () => { await app.close(); });

async function baixar(caminho, user = 'ADM') {
  const { cookie } = await app.login(user);
  const res = await fetch(app.baseUrl + caminho, { headers: { cookie } });
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
}

test('HTTP: pedidos reais finalizados → xlsx do faturamento com o total correto e cabeçalhos', async () => {
  const A = app.db.prepare("SELECT id, usuario, nivel FROM usuarios WHERE usuario = 'ADM'").get();
  const B = app.db.prepare("SELECT id, usuario, nivel FROM usuarios WHERE usuario = 'ATEND'").get();
  const cat = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão' });
  const burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: cat.id, precoCents: 2000, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  for (const q of [1, 2]) {
    const p = s.pedidos.criarRascunho(B, { cliente: { nome: 'Ana', telefone: '11999998888' }, itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade: q }] });
    s.pedidos.confirmar(B, p.id);
    for (const st of ['EM_PREPARO', 'PRONTO_RETIRADA', 'FINALIZADO']) s.pedidos.mudarStatus(A, p.id, st);
  }
  const hoje = new Date(app.relogio.now()).toLocaleDateString('sv-SE');
  const res = await baixar(`/api/relatorios/faturamento?formato=xlsx&de=${hoje}&ate=${hoje}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="relatorio-faturamento-${hoje}.xlsx"`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const ws = await ler(res.buffer);
  assert.equal(ws.getCell('C6').value, 60);
  assert.equal(ws.getCell('B6').value, 2);
  const pdfRes = await baixar(`/api/relatorios/faturamento?formato=pdf&de=${hoje}&ate=${hoje}`);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
  assert.match(pdfRes.headers.get('content-disposition'), /^attachment; filename="relatorio-faturamento-\d{4}-\d{2}-\d{2}\.pdf"$/);
  assert.equal(pdfRes.buffer.subarray(0, 4).toString(), '%PDF');
});

test('HTTP: formato inválido → 400; B e C → 403; padrão continua JSON', async () => {
  for (const f of ['csv', 'XLSX', 'constructor', '']) assert.equal((await baixar(`/api/relatorios/faturamento?formato=${f}`)).status, 400, f);
  for (const user of ['ATEND', 'COZ']) assert.equal((await baixar('/api/relatorios/faturamento?formato=xlsx', user)).status, 403);
  const json = await baixar('/api/relatorios/estoque-atual?formato=json');
  assert.match(json.headers.get('content-type'), /json/);
  assert.equal((await baixar('/api/relatorios/estoque-atual')).status, 200);
  assert.equal((await baixar('/api/relatorios/estoque-atual?formato=xlsx&limite=abc')).status, 400);
});
