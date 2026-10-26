'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

const post = (rota, body, user = 'ADM') => app.request('POST', rota, { user, body });
const put = (rota, body, user = 'ADM') => app.request('PUT', rota, { user, body });
const get = (rota, user = 'ADM') => app.request('GET', rota, { user });
const apagar = (rota, user = 'ADM') => app.request('DELETE', rota, { user });
const nova = async (extra = {}) => (await post('/api/bebidas', { nome: 'Coca-Cola', precoCents: 600, ...extra })).body;
const movimentos = (bebidaId) => app.db.prepare('SELECT * FROM movimentacoes_estoque WHERE bebida_id = ? ORDER BY id').all(bebidaId);

test('criar bebida com estoque inicial 10 gera movimento ENTRADA "Estoque inicial" com saldo_apos 10', async () => {
  const res = await post('/api/bebidas', { nome: 'Coca-Cola', precoCents: 600, estoqueQtd: 10, estoqueMinimo: 3 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id: res.body.id, nome: 'Coca-Cola', precoCents: 600, estoqueQtd: 10, estoqueMinimo: 3, ativo: true, critico: false });
  const [mov] = movimentos(res.body.id);
  assert.equal(mov.tipo, 'ENTRADA');
  assert.equal(mov.motivo, 'Estoque inicial');
  assert.equal(mov.quantidade, 10);
  assert.equal(mov.saldo_apos, 10);
  assert.equal(mov.usuario, 'ADM');
  assert.equal(mov.em, '2026-10-23T12:00:00.000Z');
});

test('estoque inicial 0 ou ausente não gera movimento', async () => {
  const b = await nova();
  assert.equal(b.estoqueQtd, 0);
  assert.equal(movimentos(b.id).length, 0);
});

test('PUT com estoqueQtd no corpo → 400 "Use uma movimentação de estoque"', async () => {
  const b = await nova({ estoqueQtd: 10 });
  const res = await put(`/api/bebidas/${b.id}`, { estoqueQtd: 99 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Use uma movimentação de estoque/);
  assert.equal((await get('/api/bebidas')).body[0].estoqueQtd, 10);
});

test('PUT mescla campos e não mexe no saldo', async () => {
  const b = await nova({ estoqueQtd: 4 });
  const res = await put(`/api/bebidas/${b.id}`, { precoCents: 700, ativo: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.precoCents, 700);
  assert.equal(res.body.nome, 'Coca-Cola');
  assert.equal(res.body.ativo, false);
  assert.equal(res.body.estoqueQtd, 4);
});

test('validações: nome, preço, mínimo e estoque inicial', async () => {
  const invalidos = [{ nome: '' }, { precoCents: 0 }, { precoCents: 10.5 }, { precoCents: -1 }, { estoqueMinimo: -1 }, { estoqueMinimo: 1.5 }, { estoqueQtd: -1 }, { estoqueQtd: 'a' }, { ativo: 'sim' }];
  for (const extra of invalidos) {
    assert.equal((await post('/api/bebidas', { nome: 'X', precoCents: 100, ...extra })).status, 400, JSON.stringify(extra));
  }
});

test('nome duplicado, mesmo sem acento ou caixa → 409', async () => {
  await nova({ nome: 'Guaraná' });
  assert.equal((await post('/api/bebidas', { nome: 'guarana', precoCents: 500 })).status, 409);
  const outra = await nova({ nome: 'Fanta' });
  assert.equal((await put(`/api/bebidas/${outra.id}`, { nome: 'GUARANÁ' })).status, 409);
  assert.equal((await put(`/api/bebidas/${outra.id}`, { nome: 'Fanta' })).status, 200);
});

test('critico quando saldo <= mínimo; /api/estoque/critico lista só as críticas', async () => {
  await nova({ nome: 'A', estoqueQtd: 3, estoqueMinimo: 3 });
  await nova({ nome: 'B', estoqueQtd: 4, estoqueMinimo: 3 });
  await nova({ nome: 'C', estoqueQtd: 0, estoqueMinimo: 0 });
  const lista = (await get('/api/bebidas')).body;
  assert.deepEqual(lista.map((b) => [b.nome, b.critico]), [['A', true], ['B', false], ['C', true]]);
  const criticas = (await get('/api/estoque/critico', 'ATEND')).body;
  assert.deepEqual(criticas.map((b) => b.nome), ['A', 'C']);
});

test('excluir bebida só com o estoque inicial funciona e apaga o movimento inicial', async () => {
  const b = await nova({ estoqueQtd: 5 });
  assert.equal((await apagar(`/api/bebidas/${b.id}`)).status, 200);
  assert.equal(movimentos(b.id).length, 0);
  assert.equal((await get('/api/bebidas')).body.length, 0);
});

test('excluir bebida com movimentos além do inicial → 409 "Em uso" sugerindo desativar', async () => {
  const b = await nova({ estoqueQtd: 5 });
  await post(`/api/bebidas/${b.id}/movimentacoes`, { tipo: 'ENTRADA', quantidade: 1 });
  const res = await apagar(`/api/bebidas/${b.id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Em uso/);
  assert.match(res.body.error, /desativ/i);
  assert.equal(movimentos(b.id).length, 2);
});

test('excluir bebida usada em pedido (FK) → 409 "Em uso"', async () => {
  const b = await nova({ estoqueQtd: 5 });
  const adm = app.db.prepare("SELECT id FROM usuarios WHERE usuario = 'ADM'").get().id;
  const pedido = app.db.prepare("INSERT INTO pedidos (data_local, numero_dia, tipo, cliente_nome, criado_por, criado_em) VALUES ('2026-10-23', 1, 'BALCAO', 'Ana', ?, '2026-10-23T12:00:00.000Z')").run(adm);
  app.db.prepare("INSERT INTO movimentacoes_estoque (bebida_id, tipo, quantidade, saldo_apos, pedido_id, em) VALUES (?, 'VENDA', -1, 4, ?, '2026-10-23T12:00:00.000Z')").run(b.id, Number(pedido.lastInsertRowid));
  const res = await apagar(`/api/bebidas/${b.id}`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Em uso/);
});

test('B lê mas não escreve; C não acessa nada', async () => {
  const b = await nova({ estoqueQtd: 2 });
  assert.equal((await get('/api/bebidas', 'ATEND')).status, 200);
  assert.equal((await get(`/api/bebidas/${b.id}/movimentacoes`, 'ATEND')).status, 200);
  assert.equal((await post('/api/bebidas', { nome: 'Y', precoCents: 100 }, 'ATEND')).status, 403);
  assert.equal((await put(`/api/bebidas/${b.id}`, { precoCents: 1 }, 'ATEND')).status, 403);
  assert.equal((await apagar(`/api/bebidas/${b.id}`, 'ATEND')).status, 403);
  assert.equal((await post(`/api/bebidas/${b.id}/movimentacoes`, { tipo: 'ENTRADA', quantidade: 1 }, 'ATEND')).status, 403);
  for (const [m, r] of [['GET', '/api/bebidas'], ['POST', '/api/bebidas'], ['GET', '/api/estoque/critico'], ['GET', `/api/bebidas/${b.id}/movimentacoes`]]) {
    assert.equal((await app.request(m, r, { user: 'COZ', body: m === 'POST' ? { nome: 'Z', precoCents: 1 } : undefined })).status, 403, `${m} ${r}`);
  }
  assert.equal((await app.request('GET', '/api/bebidas')).status, 401);
});

test('ids de rota inválidos → 400, inexistentes → 404', async () => {
  for (const id of ['0', '-1', 'abc', '1.5']) {
    assert.equal((await put(`/api/bebidas/${id}`, { precoCents: 1 })).status, 400, id);
    assert.equal((await apagar(`/api/bebidas/${id}`)).status, 400, id);
    assert.equal((await post(`/api/bebidas/${id}/movimentacoes`, { tipo: 'ENTRADA', quantidade: 1 })).status, 400, id);
    assert.equal((await get(`/api/bebidas/${id}/movimentacoes`)).status, 400, id);
  }
  assert.equal((await put('/api/bebidas/999', { precoCents: 1 })).status, 404);
  assert.equal((await apagar('/api/bebidas/999')).status, 404);
  assert.equal((await post('/api/bebidas/999/movimentacoes', { tipo: 'ENTRADA', quantidade: 1 })).status, 404);
  assert.equal((await get('/api/bebidas/999/movimentacoes')).status, 404);
});

test('corpos que não são objeto → 400', async () => {
  const b = await nova();
  for (const rota of ['/api/bebidas', `/api/bebidas/${b.id}/movimentacoes`]) {
    for (const corpo of [[], null, 'texto', 5]) assert.equal((await post(rota, corpo)).status, 400, `${rota} ${JSON.stringify(corpo)}`);
  }
  assert.equal((await put(`/api/bebidas/${b.id}`, [])).status, 400);
});

test('auditoria de criar, alterar e excluir bebida', async () => {
  const b = await nova({ nome: 'Suco' });
  await put(`/api/bebidas/${b.id}`, { precoCents: 800 });
  await apagar(`/api/bebidas/${b.id}`);
  const acoes = app.db.prepare("SELECT acao, usuario FROM auditoria WHERE entidade = 'bebida' ORDER BY id").all();
  assert.deepEqual(acoes.map((a) => a.acao), ['criar', 'alterar', 'excluir']);
  assert.ok(acoes.every((a) => a.usuario === 'ADM'));
});
