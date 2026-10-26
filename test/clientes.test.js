'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

const clientes = () => app.app.services.clientes;
const ADM = { id: 1, usuario: 'ADM', nivel: 'A' };
const total = () => app.db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n;
const auditorias = (acao) => app.db.prepare('SELECT * FROM auditoria WHERE entidade = ? AND acao = ?').all('cliente', acao);
const falhaCom = (status) => (e) => e.status === status;

test('registrar duas vezes o mesmo telefone em formatos diferentes → um cliente', () => {
  const a = clientes().registrar(ADM, { nome: 'Ana', telefone: '(11) 99999-8888' });
  const b = clientes().registrar(ADM, { nome: 'Ana', telefone: '+55 11 99999-8888' });
  assert.equal(a.id, b.id);
  assert.equal(a.telefone, '+5511999998888');
  assert.equal(total(), 1);
  assert.equal(a.criadoEm, '2026-10-23T12:00:00.000Z');
});

test('nome igual não altera atualizado_em; nome novo atualiza nome e atualizado_em', () => {
  const a = clientes().registrar(ADM, { nome: 'Ana', telefone: '11999998888' });
  app.relogio.advance(60000);
  assert.equal(clientes().registrar(ADM, { nome: 'Ana', telefone: '11999998888' }).atualizadoEm, a.atualizadoEm);
  const c = clientes().registrar(ADM, { nome: 'Ana Maria', telefone: '11999998888' });
  assert.equal(c.nome, 'Ana Maria');
  assert.equal(c.atualizadoEm, '2026-10-23T12:01:00.000Z');
  assert.equal(c.criadoEm, a.criadoEm);
});

test('auditoria só na criação e na mudança de nome', () => {
  clientes().registrar(ADM, { nome: 'Ana', telefone: '11999998888' });
  clientes().registrar(ADM, { nome: 'Ana', telefone: '11999998888' });
  assert.equal(auditorias('cliente_criado').length, 1);
  assert.equal(auditorias('cliente_nome_alterado').length, 0);
  clientes().registrar(ADM, { nome: 'Ana Maria', telefone: '11999998888' });
  assert.equal(auditorias('cliente_nome_alterado').length, 1);
});

test('nome vazio, só espaços ou > 80 caracteres → 400; 80 e emoji passam', () => {
  for (const nome of ['', '   ', 'x'.repeat(81), null, 5]) {
    assert.throws(() => clientes().registrar(ADM, { nome, telefone: '11999998888' }), falhaCom(400), String(nome));
  }
  assert.equal(clientes().registrar(ADM, { nome: 'x'.repeat(80), telefone: '11999998888' }).nome.length, 80);
  assert.equal(clientes().registrar(ADM, { nome: '  José 🍔  ', telefone: '11988887777' }).nome, 'José 🍔');
});

test('telefone inválido → 400 e nada gravado', () => {
  assert.throws(() => clientes().registrar(ADM, { nome: 'Ana', telefone: '123' }), falhaCom(400));
  assert.equal(total(), 0);
});

test('buscar por parte do nome (sem acento/maiúsculas), por dígitos e por %', () => {
  clientes().registrar(ADM, { nome: 'José Antônio', telefone: '11999998888' });
  clientes().registrar(ADM, { nome: 'Maria', telefone: '21988887777' });
  assert.deepEqual(clientes().buscar(ADM, { q: 'JOSE ant' }).map((c) => c.nome), ['José Antônio']);
  assert.deepEqual(clientes().buscar(ADM, { q: '99999' }).map((c) => c.nome), ['José Antônio']);
  assert.deepEqual(clientes().buscar(ADM, { q: '(21) 9888' }).map((c) => c.nome), ['Maria']);
  assert.deepEqual(clientes().buscar(ADM, { q: '%' }), []);
  assert.deepEqual(clientes().buscar(ADM, { q: '_' }), []);
});

test('buscar sem q devolve os mais recentes primeiro, respeitando o limite', () => {
  clientes().registrar(ADM, { nome: 'A', telefone: '11999990001' });
  app.relogio.advance(1000);
  clientes().registrar(ADM, { nome: 'B', telefone: '11999990002' });
  assert.deepEqual(clientes().buscar(ADM, {}).map((c) => c.nome), ['B', 'A']);
  assert.deepEqual(clientes().buscar(ADM, { q: '', limite: 1 }).map((c) => c.nome), ['B']);
});

test('limite inválido → 400', () => {
  for (const limite of [0, 201, 1.5, '10', -1, null]) assert.throws(() => clientes().buscar(ADM, { limite }), falhaCom(400), String(limite));
});
