'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app;
let comandaAberta;
let eventos;
beforeEach(async () => {
  comandaAberta = new Set();
  eventos = [];
  app = await createTestApp();
  // Troca a porta da comanda por uma função falsa (a Tarefa 11 liga ao repositório de pedidos).
  app.app.services.mesas.comandaNaoPagaDaMesa = (id) => comandaAberta.has(id);
  app.bus.subscribe((e) => { if (e.tipo === 'mesa') eventos.push(e.dados); });
});
afterEach(async () => { await app.close(); });

const criar = (body, user = 'ADM') => app.request('POST', '/api/mesas', { user, body });
const nova = async (numero = '1', capacidade = 4) => (await criar({ numero, capacidade })).body;

test('cria mesa LIVRE e ativa por padrão', async () => {
  const res = await criar({ numero: ' 7 ', capacidade: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.numero, '7');
  assert.equal(res.body.situacao, 'LIVRE');
  assert.equal(res.body.ativo, true);
});

test('liberar mesa com comanda não paga → 409', async () => {
  const m = await nova();
  await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' });
  comandaAberta.add(m.id);
  const res = await app.request('POST', `/api/mesas/${m.id}/liberar`, { user: 'ATEND' });
  assert.equal(res.status, 409);
  const lista = await app.request('GET', '/api/mesas', { user: 'ATEND' });
  assert.equal(lista.body[0].situacao, 'OCUPADA');
});

test('liberar mesa sem comanda aberta → LIVRE', async () => {
  const m = await nova();
  await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' });
  const res = await app.request('POST', `/api/mesas/${m.id}/liberar`, { user: 'ATEND' });
  assert.equal(res.status, 200);
  assert.equal(res.body.mesa.situacao, 'LIVRE');
  assert.equal(res.body.sugestaoFila, null);
});

test('número de mesa duplicado → 409', async () => {
  await nova('1');
  assert.equal((await criar({ numero: '1', capacidade: 2 })).status, 409);
  assert.equal((await criar({ numero: ' 1 ', capacidade: 2 })).status, 409);
  await nova('A1');
  assert.equal((await criar({ numero: 'a1', capacidade: 2 })).status, 409);
  const outra = await nova('2');
  const res = await app.request('PUT', `/api/mesas/${outra.id}`, { user: 'ADM', body: { numero: 'a1' } });
  assert.equal(res.status, 409);
  assert.equal((await app.request('PUT', `/api/mesas/${outra.id}`, { user: 'ADM', body: { numero: '2', capacidade: 6 } })).status, 200);
});

test('B não cria mesa (403) mas lista (200)', async () => {
  assert.equal((await criar({ numero: '9', capacidade: 2 }, 'ATEND')).status, 403);
  const m = await nova('3');
  assert.equal((await app.request('PUT', `/api/mesas/${m.id}`, { user: 'ATEND', body: { capacidade: 8 } })).status, 403);
  assert.equal((await app.request('DELETE', `/api/mesas/${m.id}`, { user: 'ATEND' })).status, 403);
  const lista = await app.request('GET', '/api/mesas', { user: 'ATEND' });
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 1);
});

test('capacidade < 1 → 400', async () => {
  for (const capacidade of [0, -3, 1.5, 'abc', null, undefined]) {
    assert.equal((await criar({ numero: 'X', capacidade })).status, 400, String(capacidade));
  }
  assert.equal((await criar({ numero: '  ', capacidade: 2 })).status, 400);
  assert.equal((await criar({ numero: 'Y', capacidade: 1 })).status, 200);
});

test('ocupar mesa já ocupada → 409; reservada pode ser ocupada; inativa não', async () => {
  const m = await nova();
  assert.equal((await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' })).status, 200);
  assert.equal((await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' })).status, 409);
  app.db.prepare("UPDATE mesas SET situacao = 'RESERVADA' WHERE id = ?").run(m.id);
  const res = await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' });
  assert.equal(res.status, 200);
  assert.equal(res.body.situacao, 'OCUPADA');
  const inativa = (await criar({ numero: 'Z', capacidade: 2, ativo: false })).body;
  assert.equal((await app.request('POST', `/api/mesas/${inativa.id}/ocupar`, { user: 'ATEND' })).status, 409);
  assert.equal((await app.request('POST', '/api/mesas/999/ocupar', { user: 'ATEND' })).status, 404);
});

test('nível C → 403 em /api/mesas', async () => {
  const m = await nova();
  assert.equal((await app.request('GET', '/api/mesas', { user: 'COZ' })).status, 403);
  assert.equal((await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'COZ' })).status, 403);
  assert.equal((await app.request('POST', `/api/mesas/${m.id}/liberar`, { user: 'COZ' })).status, 403);
});

test('publica o evento mesa ao ocupar e liberar', async () => {
  const m = await nova();
  await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' });
  await app.request('POST', `/api/mesas/${m.id}/liberar`, { user: 'ATEND' });
  assert.deepEqual(eventos, [{ id: m.id, situacao: 'OCUPADA' }, { id: m.id, situacao: 'LIVRE' }]);
});

test('audita criação e mudanças de situação', async () => {
  const m = await nova();
  await app.request('POST', `/api/mesas/${m.id}/ocupar`, { user: 'ATEND' });
  const linhas = app.db.prepare("SELECT acao, usuario FROM auditoria WHERE entidade = 'mesa' ORDER BY id").all();
  assert.deepEqual(linhas.map((l) => l.acao), ['criar', 'ocupar']);
  assert.equal(linhas[1].usuario, 'ATEND');
});

test('exclui mesa livre; mesa referenciada por FK → 409 "Em uso"', async () => {
  const m = await nova('1');
  assert.equal((await app.request('DELETE', `/api/mesas/${m.id}`, { user: 'ADM' })).status, 200);
  const usada = await nova('2');
  app.db.exec('PRAGMA foreign_keys = ON');
  app.db.prepare("INSERT INTO fila_espera (cliente_nome, telefone, pessoas, situacao, mesa_id, entrou_em) VALUES ('a', '+5511999998888', 2, 'CHAMADO', ?, '2026-10-23T12:00:00.000Z')").run(usada.id);
  const res = await app.request('DELETE', `/api/mesas/${usada.id}`, { user: 'ADM' });
  assert.equal(res.status, 409);
  assert.match(JSON.stringify(res.body), /Em uso/);
});
