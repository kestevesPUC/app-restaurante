'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let B; let C; let burger;
const MIN = 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const u = (nome) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(nome);
  A = u('ADM'); B = u('ATEND'); C = u('COZ');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2000, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
});
afterEach(async () => { await app.close(); });

const req = (method, path, user = 'ATEND') => app.request(method, path, { user });
const rascunho = (nome, telefone, quantidade = 1) => s.pedidos.criarRascunho(B, {
  cliente: { nome, telefone }, itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade }],
});
function finalizado(nome, telefone, quantidade = 1) {
  const p = rascunho(nome, telefone, quantidade);
  s.pedidos.confirmar(B, p.id);
  s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  app.relogio.advance(MIN);
  s.pedidos.mudarStatus(A, p.id, 'FINALIZADO');
  return p;
}
const idDe = (telefone, nome = 'X') => s.clientes.registrar(A, { nome, telefone }).id;

test('histórico: 2 finalizados (R$ 40 e R$ 60), 1 cancelado e 1 rascunho', () => {
  const p1 = finalizado('Ana', '11999998888', 2);
  app.relogio.advance(MIN);
  const p2 = finalizado('Ana', '11999998888', 3);
  const cancelado = rascunho('Ana', '11999998888');
  s.pedidos.confirmar(B, cancelado.id);
  s.pedidos.cancelar(B, cancelado.id, 'desistiu');
  const aberto = rascunho('Ana', '11999998888');
  const h = s.clientes.historico(B, idDe('11999998888', 'Ana'));
  assert.equal(h.cliente.nome, 'Ana');
  assert.equal(h.qtdPedidos, 2);
  assert.equal(h.totalGastoCents, 10000);
  const emFinal = app.db.prepare("SELECT em FROM pedido_status_historico WHERE pedido_id = ? AND status_novo = 'FINALIZADO'").get(p2.id).em;
  assert.equal(h.ultimaCompra, emFinal);
  assert.equal(h.ultimosPedidos.length, 3);
  assert.ok(!h.ultimosPedidos.some((p) => p.id === aberto.id));
  assert.deepEqual(h.ultimosPedidos.map((p) => p.id).sort(), [p1.id, p2.id, cancelado.id].sort());
  assert.deepEqual(Object.keys(h.ultimosPedidos[0]).sort(), ['confirmadoEm', 'id', 'quantidadeTotal', 'status', 'totalCents']);
  const x = h.ultimosPedidos.find((p) => p.id === p2.id);
  assert.equal(x.quantidadeTotal, 3);
  assert.equal(x.totalCents, 6000);
});

test('histórico: cliente sem pedidos → zeros e ultimaCompra null', () => {
  const h = s.clientes.historico(A, idDe('11999998888'));
  assert.deepEqual([h.qtdPedidos, h.totalGastoCents, h.ultimaCompra, h.ultimosPedidos], [0, 0, null, []]);
});

test('histórico: mais de 10 pedidos → só os 10 mais recentes', () => {
  const ids = [];
  for (let i = 0; i < 12; i++) { ids.push(finalizado('Ana', '11999998888').id); app.relogio.advance(MIN); }
  const h = s.clientes.historico(A, idDe('11999998888'));
  assert.equal(h.qtdPedidos, 12);
  assert.deepEqual(h.ultimosPedidos.map((p) => p.id), ids.slice(2).reverse());
});

test('histórico: autorização no serviço (C e ausente → 403 antes do 404) e inexistente → 404', () => {
  for (const user of [C, undefined, null]) {
    assert.throws(() => s.clientes.historico(user, 999), (e) => e.status === 403);
    assert.throws(() => s.clientes.buscar(user, {}), (e) => e.status === 403);
  }
  assert.throws(() => s.clientes.historico(B, 999), (e) => e.status === 404);
});

test('GET /api/clientes/:id e lista com qtdPedidos/totalGastoCents', async () => {
  finalizado('Ana', '11999998888', 2);
  const id = idDe('11999998888');
  const res = await req('GET', `/api/clientes/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.qtdPedidos, 1);
  assert.equal(res.body.totalGastoCents, 4000);
  const sem = idDe('11988887777', 'Sem');
  const lista = await req('GET', '/api/clientes', 'ADM');
  assert.equal(lista.status, 200);
  const porId = Object.fromEntries(lista.body.map((c) => [c.id, c]));
  assert.equal(porId[id].qtdPedidos, 1);
  assert.equal(porId[id].totalGastoCents, 4000);
  assert.equal(porId[sem].qtdPedidos, 0);
  assert.equal(porId[sem].totalGastoCents, 0);
});

test('busca por telefone parcial e por nome com acento', async () => {
  s.clientes.registrar(A, { nome: 'José Antônio', telefone: '11999998888' });
  s.clientes.registrar(A, { nome: 'Maria', telefone: '21988887777' });
  const nomes = async (q) => (await req('GET', `/api/clientes?q=${encodeURIComponent(q)}`)).body.map((c) => c.nome);
  assert.deepEqual(await nomes('9999'), ['José Antônio']);
  assert.deepEqual(await nomes('jose ANTONIO'), ['José Antônio']);
  assert.deepEqual(await nomes('Antônio'), ['José Antônio']);
  assert.deepEqual(await nomes('5511999'), ['José Antônio']);
});

test('dígitos "55" não casam o prefixo +55 de todos os clientes', async () => {
  s.clientes.registrar(A, { nome: 'Um', telefone: '11999998888' });
  s.clientes.registrar(A, { nome: 'Dois', telefone: '55988887777' });
  s.clientes.registrar(A, { nome: 'Tres', telefone: '11955554444' });
  const nomes = async (q) => (await req('GET', `/api/clientes?q=${q}`)).body.map((c) => c.nome).sort();
  assert.deepEqual(await nomes('55'), ['Dois', 'Tres']);
  assert.deepEqual(await nomes('5511999'), ['Um']);
});

test('nível C → 403 nas duas rotas; sem sessão → 401', async () => {
  const id = idDe('11999998888');
  assert.equal((await req('GET', '/api/clientes', 'COZ')).status, 403);
  assert.equal((await req('GET', `/api/clientes/${id}`, 'COZ')).status, 403);
  assert.equal((await app.request('GET', '/api/clientes')).status, 401);
});

test('entradas inválidas → 400; inexistente → 404', async () => {
  for (const id of ['0', 'abc', '-1', '1.5', '99999999999999999999']) assert.equal((await req('GET', `/api/clientes/${id}`)).status, 400, id);
  assert.equal((await req('GET', '/api/clientes/999')).status, 404);
  for (const qs of ['limite=0', 'limite=201', 'limite=abc', 'limite=1.5', 'limite=', `q=${'x'.repeat(81)}`]) {
    assert.equal((await req('GET', `/api/clientes?${qs}`)).status, 400, qs);
  }
  assert.equal((await req('GET', `/api/clientes?q=${'x'.repeat(80)}&limite=200`)).status, 200);
});
