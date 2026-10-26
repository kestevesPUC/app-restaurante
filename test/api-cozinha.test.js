'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let B; let burger;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  B = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ATEND');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
});
afterEach(async () => { await app.close(); });

const rascunho = (nome) => s.pedidos.criarRascunho(B, { cliente: { nome, telefone: '(11) 99999-8888' }, itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade: 1 }] });

test('GET /api/cozinha traz só pedidos ativos da cozinha, na ordem de confirmação', async () => {
  const [a, b, c, , e] = ['A', 'B', 'C', 'D', 'E'].map(rascunho);
  s.pedidos.confirmar(B, b.id);
  app.relogio.advance(1000);
  s.pedidos.confirmar(B, a.id);
  app.relogio.advance(1000);
  s.pedidos.confirmar(B, c.id);
  app.relogio.advance(1000);
  s.pedidos.mudarStatus({ ...B, nivel: 'A' }, c.id, 'EM_PREPARO');
  s.pedidos.confirmar(B, e.id);
  s.pedidos.cancelar(B, e.id, 'x');
  for (const nivel of ['COZ', 'ATEND', 'ADM']) {
    const res = await app.request('GET', '/api/cozinha', { user: nivel });
    assert.equal(res.status, 200, nivel);
    assert.deepEqual(res.body.map((p) => p.id), [b.id, a.id, c.id], nivel);
  }
});

test('cozinha avança o pedido e ele some da fila ao finalizar', async () => {
  const p = rascunho('Ana');
  s.pedidos.confirmar(B, p.id);
  const st = (status, user) => app.request('POST', `/api/pedidos/${p.id}/status`, { user, body: { status } });
  assert.equal((await st('EM_PREPARO', 'COZ')).status, 200);
  assert.equal((await st('PRONTO_ENTREGA', 'COZ')).status, 200);
  assert.equal((await app.request('GET', '/api/cozinha', { user: 'COZ' })).body.length, 1);
  assert.equal((await st('FINALIZADO', 'ATEND')).status, 200);
  assert.deepEqual((await app.request('GET', '/api/cozinha', { user: 'COZ' })).body, []);
});

test('sem sessão → 401 em /api/cozinha', async () => {
  assert.equal((await app.request('GET', '/api/cozinha')).status, 401);
});
