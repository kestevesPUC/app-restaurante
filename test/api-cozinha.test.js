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
  const pao = s.ingredientes.create(A, { nome: 'Pão' });
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

test('payload da cozinha: nº, cliente, itens com observação e personalização, tempo, confirmação e status; sem rascunho/finalizado/cancelado', async () => {
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  const queijo = s.ingredientes.create(A, { nome: 'Queijo', podeSerAdicional: true, precoAdicionalCents: 300 });
  const p1 = s.pedidos.criarRascunho(B, {
    cliente: { nome: 'José Ávila', telefone: '(11) 99999-8888' }, observacao: 'tocar a campainha',
    itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade: 2, observacao: 'sem cebola', adicionar: [{ ingredienteId: queijo.id, quantidade: 1 }] }],
  });
  const p2 = rascunho('Bia');
  const rasc = rascunho('Rascunho');
  const fim = rascunho('Fim');
  const canc = rascunho('Canc');
  s.pedidos.confirmar(B, p1.id);
  app.relogio.advance(60000);
  s.pedidos.confirmar(B, p2.id);
  s.pedidos.confirmar(B, fim.id);
  s.pedidos.mudarStatus({ ...B, nivel: 'A' }, fim.id, 'EM_PREPARO');
  s.pedidos.mudarStatus({ ...B, nivel: 'A' }, fim.id, 'PRONTO_RETIRADA');
  s.pedidos.mudarStatus(B, fim.id, 'FINALIZADO');
  s.pedidos.cancelar(B, canc.id, 'x');
  const res = await app.request('GET', '/api/cozinha', { user: 'COZ' });
  assert.deepEqual(res.body.map((p) => p.id), [p1.id, p2.id]);
  assert.ok(!res.body.some((p) => [rasc.id, fim.id, canc.id].includes(p.id)));
  const [x, y] = res.body;
  assert.equal(x.status, 'RECEBIDO');
  assert.equal(x.cliente.nome, 'José Ávila');
  assert.equal(x.observacao, 'tocar a campainha');
  assert.equal(x.tempoEstimadoMin, 10);
  assert.equal(x.confirmadoEm, '2026-10-23T12:00:00.000Z');
  assert.equal(y.confirmadoEm, '2026-10-23T12:01:00.000Z');
  assert.equal(x.itens[0].nome, 'X-Burger');
  assert.equal(x.itens[0].quantidade, 2);
  assert.equal(x.itens[0].observacao, 'sem cebola');
  assert.equal(x.itens[0].modificacoes[0].ingredienteNome, 'Queijo');
  assert.equal(x.itens[0].modificacoes[0].tipo, 'ADICIONAR');
});

const NIVEL = { ADM: 'A', ATEND: 'B', COZ: 'C' };
/** Cria um pedido já no status pedido (levado por A), para testar a matriz de permissões. */
function noStatus(alvo) {
  const p = rascunho('Ana');
  const A = { ...B, nivel: 'A' };
  s.pedidos.confirmar(B, p.id);
  const caminho = { RECEBIDO: [], EM_PREPARO: ['EM_PREPARO'], PRONTO_RETIRADA: ['EM_PREPARO', 'PRONTO_RETIRADA'], PRONTO_ENTREGA: ['EM_PREPARO', 'PRONTO_ENTREGA'] }[alvo];
  for (const passo of caminho) s.pedidos.mudarStatus(A, p.id, passo);
  return p.id;
}
const mudar = (id, status, user) => app.request('POST', `/api/pedidos/${id}/status`, { user, body: { status } });
const statusDe = async (id) => (await app.request('GET', `/api/pedidos/${id}`, { user: 'ADM' })).body.status;

test('matriz de /status por nível', async () => {
  assert.ok(NIVEL);
  const casos = [
    // [de, para, usuário, código esperado]
    ['RECEBIDO', 'EM_PREPARO', 'COZ', 200], ['RECEBIDO', 'EM_PREPARO', 'ATEND', 403], ['RECEBIDO', 'EM_PREPARO', 'ADM', 200],
    ['EM_PREPARO', 'PRONTO_RETIRADA', 'COZ', 200], ['EM_PREPARO', 'PRONTO_ENTREGA', 'COZ', 200],
    ['EM_PREPARO', 'PRONTO_RETIRADA', 'ATEND', 403], ['EM_PREPARO', 'PRONTO_ENTREGA', 'ADM', 200],
    ['PRONTO_RETIRADA', 'FINALIZADO', 'COZ', 200], ['PRONTO_ENTREGA', 'FINALIZADO', 'COZ', 200],
    ['PRONTO_RETIRADA', 'FINALIZADO', 'ATEND', 200], ['PRONTO_ENTREGA', 'FINALIZADO', 'ADM', 200],
    ['PRONTO_RETIRADA', 'EM_PREPARO', 'COZ', 200], ['PRONTO_ENTREGA', 'EM_PREPARO', 'COZ', 200],
    ['PRONTO_RETIRADA', 'EM_PREPARO', 'ATEND', 403], ['PRONTO_ENTREGA', 'EM_PREPARO', 'ADM', 200],
    ['RECEBIDO', 'FINALIZADO', 'ADM', 409], ['RECEBIDO', 'FINALIZADO', 'ATEND', 409], ['EM_PREPARO', 'FINALIZADO', 'COZ', 409],
    ['RECEBIDO', 'PRONTO_RETIRADA', 'COZ', 409],
    ['RECEBIDO', 'CANCELADO', 'COZ', 400], ['RECEBIDO', 'CANCELADO', 'ADM', 400],
  ];
  for (const [de, para, user, codigo] of casos) {
    const id = noStatus(de);
    const res = await mudar(id, para, user);
    assert.equal(res.status, codigo, `${de} → ${para} por ${user}`);
    assert.equal(await statusDe(id), codigo === 200 ? para : de, `estado após ${de} → ${para} por ${user}`);
  }
  assert.equal(app.erros.length, 0);
});
