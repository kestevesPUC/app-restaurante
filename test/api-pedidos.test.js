'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

// Rotas de consulta de pedidos. As rotas de escrita voltam na Tarefa 6; aqui os pedidos são criados pelo serviço.
let app; let s; let B; let c;
const DIA = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  B = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ATEND');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  const burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  c = { burger };
});
afterEach(async () => { await app.close(); });

const req = (method, path, user = 'ATEND') => app.request(method, path, { user });
const pedido = (nome = 'Ana', telefone = '(11) 99999-8888') => s.pedidos.criarRascunho(B, {
  cliente: { nome, telefone }, itens: [{ tipo: 'PRATO', itemId: c.burger.id, quantidade: 1 }],
});

test('GET /api/pedidos devolve ordem crescente de id e só o dia atual por padrão', async () => {
  const ontem = pedido('Ontem');
  app.relogio.advance(DIA);
  await app.login('ATEND');
  const a = pedido('A');
  const b = pedido('B');
  const res = await req('GET', '/api/pedidos');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.id), [a.id, b.id]);
  const dois = await req('GET', `/api/pedidos?de=${ontem.dataLocal}&ate=${a.dataLocal}`);
  assert.deepEqual(dois.body.map((p) => p.id), [ontem.id, a.id, b.id]);
  const linha = res.body[0];
  assert.equal(linha.status, 'ABERTO');
  assert.equal(linha.quantidadeTotal, 1);
  assert.equal(linha.totalCents, 2500);
  assert.equal(linha.cliente.nome, 'A');
});

test('filtro por status, q (nome) e limite', async () => {
  const p1 = pedido('Maria Souza');
  const p2 = pedido('João');
  s.pedidos.confirmar(B, p2.id);
  const ids = async (qs) => (await req('GET', `/api/pedidos?${qs}`)).body.map((p) => p.id);
  assert.deepEqual(await ids('status=RECEBIDO'), [p2.id]);
  assert.deepEqual(await ids('q=maria'), [p1.id]);
  assert.deepEqual(await ids('q=joao'), [p2.id]);
  assert.deepEqual(await ids('limite=1'), [p1.id]);
  for (const qs of ['status=PAGO', 'limite=0', 'limite=1001', 'limite=abc']) assert.equal((await req('GET', `/api/pedidos?${qs}`)).status, 400, qs);
});

test('GET /api/pedidos/:id devolve o Pedido com itens e histórico', async () => {
  const p = pedido();
  s.pedidos.confirmar(B, p.id);
  const res = await req('GET', `/api/pedidos/${p.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'RECEBIDO');
  assert.equal(res.body.itens[0].nome, 'X-Burger');
  assert.equal(res.body.historico[0].para, 'RECEBIDO');
  assert.equal(res.body.tempoEstimadoMin, 10);
});

test('nível C → 403 em /api/pedidos', async () => {
  assert.equal((await req('GET', '/api/pedidos', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos.csv', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos/1', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos')).status, 200);
});

test('pedidos.csv neutraliza célula começando com = + - @', async () => {
  const nomes = ['=1+1', '+SOMA(A1)', '-2', '@cmd', 'Normal'];
  for (const n of nomes) pedido(n);
  const res = await req('GET', '/api/pedidos.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  const linhas = res.body.trim().split('\r\n');
  assert.equal(linhas[0], 'Nº;Data/hora;Cliente;Telefone;Itens;Total (R$);Status');
  assert.deepEqual(linhas.slice(1).map((l) => l.split(';')[2]), ["'=1+1", "'+SOMA(A1)", "'-2", "'@cmd", 'Normal']);
  assert.equal(linhas[1].split(';')[5], '25,00');
  assert.equal(linhas[1].split(';')[3], "'+5511999998888");
});

test('nome de cliente com acento, emoji e & vai e volta intacto no JSON e no CSV', async () => {
  const nome = 'José & "Filhos" 🍕 São';
  const p = pedido(nome);
  assert.equal((await req('GET', `/api/pedidos/${p.id}`)).body.cliente.nome, nome);
  assert.equal((await req('GET', '/api/pedidos')).body[0].cliente.nome, nome);
  assert.ok((await req('GET', '/api/pedidos.csv')).body.includes('"José & ""Filhos"" 🍕 São"'));
});

test('id não numérico → 400; inexistente → 404', async () => {
  assert.equal((await req('GET', '/api/pedidos/abc')).status, 400);
  assert.equal((await req('GET', '/api/pedidos/0')).status, 400);
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

test('rotas antigas de escrita não existem mais (voltam na Tarefa 6)', async () => {
  const p = pedido();
  for (const [m, path] of [['POST', '/api/pedidos'], ['POST', `/api/pedidos/${p.id}/finalizar`], ['POST', `/api/pedidos/${p.id}/enviar-cozinha`], ['GET', '/api/mesas/1/comanda']]) {
    assert.equal((await req(m, path)).status, 404, path);
  }
});
