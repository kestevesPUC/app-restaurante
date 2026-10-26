'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let B; let pedido;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const u = (n) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(n);
  A = u('ADM'); B = u('ATEND');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  const burger = s.pratos.create(A, { nome: 'X', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  const p = s.pedidos.criarRascunho(B, { cliente: { nome: 'Ana Lima', telefone: '(11) 99999-8888' }, itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade: 1 }] });
  s.pedidos.confirmar(B, p.id);
  s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
  pedido = s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
});
afterEach(async () => { await app.close(); });

const url = (sufixo = '') => `/api/pedidos/${pedido.id}/notificacoes${sufixo}`;

test('GET notificações lista o histórico (A e B), C → 403, id inválido → 400', async () => {
  for (const user of ['ADM', 'ATEND']) {
    const res = await app.request('GET', url(), { user });
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(Object.keys(res.body[0]).sort(), ['automatica', 'em', 'enviadaPor', 'erro', 'id', 'pedidoId', 'situacao', 'telefone', 'texto', 'tipo']);
  }
  assert.equal((await app.request('GET', url(), { user: 'COZ' })).status, 403);
  assert.equal((await app.request('GET', '/api/pedidos/abc/notificacoes', { user: 'ADM' })).status, 400);
  assert.equal((await app.request('GET', url())).status, 401);
});

test('POST reenviar: B pode, 200 mesmo com falha, C → 403, inexistente → 404, fora de PRONTO → 409', async () => {
  const ok = await app.request('POST', url('/reenviar'), { user: 'ATEND' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.situacao, 'ENVIADA');
  assert.equal(ok.body.automatica, 0);
  app.mensageiro.falharProxima('NUMERO_SEM_WHATSAPP');
  const falha = await app.request('POST', url('/reenviar'), { user: 'ADM' });
  assert.equal(falha.status, 200);
  assert.equal(falha.body.situacao, 'FALHOU');
  assert.ok(falha.body.erro);
  assert.equal((await app.request('POST', url('/reenviar'), { user: 'COZ' })).status, 403);
  assert.equal((await app.request('POST', '/api/pedidos/99999/notificacoes/reenviar', { user: 'ADM' })).status, 404);
  s.pedidos.mudarStatus(A, pedido.id, 'FINALIZADO');
  assert.equal((await app.request('POST', url('/reenviar'), { user: 'ADM' })).status, 409);
});

test('GET/PUT /api/config/whatsapp: só A; parciais; validações', async () => {
  const g = await app.request('GET', '/api/config/whatsapp', { user: 'ADM' });
  assert.equal(g.status, 200);
  assert.equal(g.body.numeroEmpresa, '');
  assert.match(g.body.modeloRetirada, /pronto para retirada/);
  assert.match(g.body.modeloEntrega, /pronto para entrega/);
  assert.equal((await app.request('GET', '/api/config/whatsapp', { user: 'ATEND' })).status, 403);
  assert.equal((await app.request('PUT', '/api/config/whatsapp', { user: 'ATEND', body: { modeloRetirada: 'x' } })).status, 403);
  assert.equal((await app.request('GET', '/api/config/whatsapp', { user: 'COZ' })).status, 403);
  const put = (body) => app.request('PUT', '/api/config/whatsapp', { user: 'ADM', body });
  const ok = await put({ modeloRetirada: '  Oi {nome} {numero} {numero}  ', numeroEmpresa: '(11) 3333-4444' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.modeloRetirada, 'Oi {nome} {numero} {numero}');
  assert.equal(ok.body.numeroEmpresa, '+551133334444');
  assert.match(ok.body.modeloEntrega, /entrega/);
  assert.equal((await put({ numeroEmpresa: '' })).body.numeroEmpresa, '');
  for (const ruim of [{ modeloRetirada: '' }, { modeloEntrega: '   ' }, { modeloRetirada: 'a'.repeat(1001) }, { modeloEntrega: 5 },
    { numeroEmpresa: '123' }, { numeroEmpresa: 5 }]) {
    assert.equal((await put(ruim)).status, 400, JSON.stringify(ruim).slice(0, 40));
  }
  assert.equal((await put({ modeloRetirada: 'a'.repeat(1000) })).status, 200);
  assert.equal((await app.request('PUT', '/api/config/whatsapp', { user: 'ADM', body: [] })).status, 400);
});

test('o modelo editado é usado no próximo envio', async () => {
  await app.request('PUT', '/api/config/whatsapp', { user: 'ADM', body: { modeloRetirada: 'Oi {nome}, nº {numero}' } });
  const r = await app.request('POST', url('/reenviar'), { user: 'ADM' });
  assert.equal(r.body.texto, `Oi Ana, nº ${pedido.id}`);
});
