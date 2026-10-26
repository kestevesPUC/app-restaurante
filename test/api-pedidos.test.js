'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let c;
const DIA = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, ingredientes: [] });
  c = { burger };
});
afterEach(async () => { await app.close(); });

const item = (extra = {}) => ({ pratoId: c.burger.id, quantidade: 1, remover: [], adicionar: [], ...extra });
const req = (method, path, user = 'ATEND', body) => app.request(method, path, { user, body });
const balcao = async (clienteNome = 'Ana', extra = {}) => (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'BALCAO', clienteNome, itens: [item()], ...extra })).body;
const mesa = (numero = '1') => s.mesas.create(A, { numero, capacidade: 4 });

test('GET /api/pedidos devolve ordem crescente de id e só o dia atual por padrão', async () => {
  const ontem = await balcao('Ontem');
  app.relogio.advance(DIA);
  await app.login('ATEND');
  await app.login('ADM');
  const a = await balcao('A');
  const b = await balcao('B');
  const res = await req('GET', '/api/pedidos');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.id), [a.id, b.id]);
  const dois = await req('GET', `/api/pedidos?de=${ontem.dataLocal}&ate=${a.dataLocal}`);
  assert.deepEqual(dois.body.map((p) => p.id), [ontem.id, a.id, b.id]);
  const linha = res.body[0];
  assert.deepEqual(Object.keys(linha).sort(), ['atendente', 'clienteNome', 'cozinha', 'criadoEm', 'forma', 'id', 'mesa', 'numeroDia', 'qtdItens', 'situacao', 'tipo', 'totalCents']);
  assert.equal(linha.atendente, 'ATEND');
  assert.equal(linha.qtdItens, 1);
  assert.equal(linha.totalCents, 2500);
  assert.equal(linha.forma, null);
});

test('filtro por situacao, por mesaId e q (nº ou cliente)', async () => {
  const p1 = await balcao('Maria Souza');
  const p2 = await balcao('João');
  await req('POST', `/api/pedidos/${p2.id}/finalizar`);
  const m = mesa('5');
  const pm = (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'MESA', mesaId: m.id, itens: [item()] })).body;
  const ids = async (qs) => (await req('GET', `/api/pedidos?${qs}`)).body.map((p) => p.id);
  assert.deepEqual(await ids('situacao=AGUARDANDO_PAGAMENTO'), [p2.id]);
  assert.deepEqual(await ids(`mesaId=${m.id}`), [pm.id]);
  assert.deepEqual(await ids('q=maria'), [p1.id]);
  assert.deepEqual(await ids('q=joao'), [p2.id]);
  assert.deepEqual(await ids(`q=${p2.numeroDia}`), [p2.id]);
  assert.deepEqual(await ids('forma=PIX&situacao=ABERTO'), [p1.id, pm.id]);
  assert.equal((await req('GET', '/api/pedidos?situacao=XYZ')).status, 400);
  assert.equal((await req('GET', '/api/pedidos?mesaId=abc')).status, 400);
  assert.equal((await req('GET', '/api/pedidos?atendenteId=1.5')).status, 400);
});

test('resumo da cozinha aparece na linha do pedido', async () => {
  const p = await balcao();
  assert.equal((await req('GET', '/api/pedidos')).body[0].cozinha, null);
  await req('POST', `/api/pedidos/${p.id}/enviar-cozinha`);
  assert.deepEqual((await req('GET', '/api/pedidos')).body[0].cozinha, { rodadas: 1, entregues: 0, situacao: 'NA_FILA' });
});

test('total enviado no corpo é ignorado', async () => {
  const res = await req('POST', '/api/pedidos', 'ATEND', { tipo: 'BALCAO', clienteNome: 'Ana', totalCents: 1, subtotalCents: 1, itens: [item({ precoUnitCents: 1, totalCents: 1 })] });
  assert.equal(res.status, 200);
  assert.equal(res.body.totalCents, 2500);
  assert.equal(res.body.itens[0].precoUnitCents, 2500);
});

test('nível C → 403 em /api/pedidos', async () => {
  assert.equal((await req('GET', '/api/pedidos', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos.csv', 'COZ')).status, 403);
  assert.equal((await req('POST', '/api/pedidos', 'COZ', { tipo: 'BALCAO', itens: [item()] })).status, 403);
  assert.equal((await req('GET', '/api/pedidos')).status, 200);
});

test('GET /api/mesas/:id/comanda → 404 sem comanda', async () => {
  const m = mesa();
  assert.equal((await req('GET', `/api/mesas/${m.id}/comanda`)).status, 404);
  const p = (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'MESA', mesaId: m.id, itens: [item()] })).body;
  const res = await req('GET', `/api/mesas/${m.id}/comanda`);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, p.id);
  assert.equal((await req('GET', '/api/mesas/abc/comanda')).status, 400);
});

test('GET /api/mesas traz pedidoAberto', async () => {
  const m1 = mesa('1');
  mesa('2');
  const p = (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'MESA', mesaId: m1.id, itens: [item({ quantidade: 2 })] })).body;
  const lista = (await req('GET', '/api/mesas')).body;
  assert.deepEqual(lista[0].pedidoAberto, { id: p.id, numeroDia: p.numeroDia, situacao: 'ABERTO', totalCents: 5000, criadoEm: p.criadoEm });
  assert.equal(lista[1].pedidoAberto, null);
  await req('POST', `/api/pedidos/${p.id}/enviar-cozinha`);
  await req('POST', `/api/pedidos/${p.id}/finalizar`);
  assert.equal((await req('GET', '/api/mesas')).body[0].pedidoAberto.situacao, 'AGUARDANDO_PAGAMENTO');
});

test('pedidos.csv neutraliza célula começando com = + - @', async () => {
  const nomes = ['=1+1', '+SOMA(A1)', '-2', '@cmd', 'Normal'];
  for (const n of nomes) await balcao(n);
  const res = await req('GET', '/api/pedidos.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  const bruto = Buffer.from(await (await fetch(`${app.baseUrl}/api/pedidos.csv`, { headers: { cookie: (await app.login('ATEND')).cookie } })).arrayBuffer());
  assert.deepEqual([...bruto.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const linhas = res.body.trim().split('\r\n');
  assert.equal(linhas[0], `Nº;Data/hora;Tipo;Mesa;Cliente;Itens;Total (R$);Situação;Forma de pagamento;Atendente`);
  const clientes = linhas.slice(1).map((l) => l.split(';')[4]);
  assert.deepEqual(clientes, ["'=1+1", "'+SOMA(A1)", "'-2", "'@cmd", 'Normal']);
  assert.equal(linhas[1].split(';')[6], '25,00');
});

test('nome de cliente com acento, emoji e & vai e volta intacto no JSON e no CSV', async () => {
  const nome = 'José & "Filhos" 🍕 São';
  const p = await balcao(nome);
  assert.equal(p.clienteNome, nome);
  assert.equal((await req('GET', `/api/pedidos/${p.id}`)).body.clienteNome, nome);
  assert.equal((await req('GET', '/api/pedidos')).body[0].clienteNome, nome);
  const csv = (await req('GET', '/api/pedidos.csv')).body;
  assert.ok(csv.includes('"José & ""Filhos"" 🍕 São"'));
});

test('id não numérico → 400', async () => {
  assert.equal((await req('GET', '/api/pedidos/abc')).status, 400);
  assert.equal((await req('GET', '/api/pedidos/0')).status, 400);
  assert.equal((await req('POST', '/api/pedidos/1x/finalizar')).status, 400);
  assert.equal((await req('POST', '/api/pedidos/1/itens/x/cancelar', 'ATEND', { motivo: 'a' })).status, 400);
  assert.equal((await req('GET', '/api/pedidos/999')).status, 404);
});

test('endereço com %-encoding inválido → 400, não 500', async () => {
  const res = await req('GET', '/api/pedidos/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  assert.equal(app.erros.length, 0);
});

test('de inválido → 400', async () => {
  for (const qs of ['de=2026-13-01', 'de=hoje', 'ate=2026-02-30', 'de=2026-1-1']) {
    assert.equal((await req('GET', `/api/pedidos?${qs}`)).status, 400, qs);
    assert.equal((await req('GET', `/api/pedidos.csv?${qs}`)).status, 400, qs);
  }
  assert.equal((await req('GET', '/api/pedidos?de=2026-10-23&ate=2026-10-24')).status, 200);
});

test('corpo vazio → 400', async () => {
  const p = await balcao();
  assert.equal((await req('POST', '/api/pedidos')).status, 400);
  assert.equal((await req('POST', '/api/pedidos', 'ATEND', [])).status, 400);
  assert.equal((await req('PUT', `/api/pedidos/${p.id}`, 'ATEND', [])).status, 400);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/itens`)).status, 400);
  const pm = (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'MESA', mesaId: mesa().id, itens: [item()] })).body;
  assert.equal((await req('POST', `/api/pedidos/${pm.id}/mover`)).status, 400);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/cancelar`)).status, 400);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/desconto`, 'ADM')).status, 400);
  assert.equal(app.erros.length, 0);
});

test('fluxo: itens, enviar, cancelar item, finalizar, reabrir, mover e cancelar', async () => {
  const m = mesa();
  const p = (await req('POST', '/api/pedidos', 'ATEND', { tipo: 'MESA', mesaId: m.id, itens: [item()] })).body;
  assert.equal((await req('POST', `/api/pedidos/${p.id}/itens`, 'ATEND', { itens: [item()] })).body.totalCents, 5000);
  assert.equal((await req('PUT', `/api/pedidos/${p.id}`, 'ATEND', { itens: [item({ quantidade: 3 })] })).body.totalCents, 7500);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/enviar-cozinha`)).status, 200);
  const itemId = (await req('GET', `/api/pedidos/${p.id}`)).body.itens[0].id;
  const canc = await req('POST', `/api/pedidos/${p.id}/itens/${itemId}/cancelar`, 'ATEND', { motivo: 'errou' });
  assert.equal(canc.status, 200);
  assert.equal(canc.body.totalCents, 0);
  await req('POST', `/api/pedidos/${p.id}/itens`, 'ATEND', { itens: [item()] });
  await req('POST', `/api/pedidos/${p.id}/enviar-cozinha`);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/finalizar`)).body.situacao, 'AGUARDANDO_PAGAMENTO');
  assert.equal((await req('POST', `/api/pedidos/${p.id}/reabrir`)).body.situacao, 'ABERTO');
  const outra = mesa('2');
  assert.equal((await req('POST', `/api/pedidos/${p.id}/mover`, 'ATEND', { mesaId: outra.id })).body.mesaId, outra.id);
  assert.equal((await req('POST', `/api/pedidos/${p.id}/cancelar`, 'ATEND', { motivo: 'desistiu' })).body.situacao, 'CANCELADO');
});

test('B não aplica desconto (403) e A aplica', async () => {
  const p = await balcao();
  assert.equal((await req('POST', `/api/pedidos/${p.id}/desconto`, 'ATEND', { descontoCents: 500 })).status, 403);
  const res = await req('POST', `/api/pedidos/${p.id}/desconto`, 'ADM', { descontoCents: 500 });
  assert.equal(res.status, 200);
  assert.equal(res.body.descontoCents, 500);
  assert.equal(res.body.totalCents, 2000);
});
