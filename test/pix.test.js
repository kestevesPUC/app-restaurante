'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');
const { gerarBrCode, crc16 } = require('../src/domain/pix/brcode');

// Módulo PIX: BR Code, cadastro de chaves (uma padrão) e forma de pagamento ao finalizar o pedido.

test('CRC16-CCITT confere com o valor de referência', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('BR Code: campos EMV, valor, nome sem acento e CRC válido', () => {
  const code = gerarBrCode({ chave: '12345678901', nome: 'Lanchonete São João', cidade: 'São Paulo', valorCents: 2550, txid: 'PEDIDO-7' });
  assert.ok(code.startsWith('000201'));
  assert.ok(code.includes('0014br.gov.bcb.pix011112345678901'));
  assert.ok(code.includes('540525.50'));
  assert.ok(code.includes('5919Lanchonete Sao Joao'));
  assert.ok(code.includes('6009Sao Paulo'));
  assert.ok(code.includes('62110507PEDIDO7'));
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
});

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

const post = (path, body, user = 'ADM') => app.request('POST', path, { user, body });
const chave = (extra = {}) => ({ descricao: 'Loja', tipo: 'CPF', chave: '123.456.789-01', nomeRecebedor: 'Lanchonete', cidade: 'Sao Paulo', ...extra });

test('primeira chave vira padrão; trocar a padrão desmarca a anterior', async () => {
  const a = (await post('/api/pix/chaves', chave())).body;
  assert.equal(a.chave, '12345678901');
  assert.equal(a.padrao, true);
  const b = (await post('/api/pix/chaves', chave({ descricao: 'Celular', tipo: 'TELEFONE', chave: '(11) 99999-8888' }))).body;
  assert.equal(b.chave, '+5511999998888');
  assert.equal(b.padrao, false);
  await post(`/api/pix/chaves/${b.id}/padrao`);
  const lista = (await app.request('GET', '/api/pix/chaves', { user: 'ADM' })).body;
  assert.deepEqual(lista.map((c) => [c.id, c.padrao]), [[b.id, true], [a.id, false]]);
  assert.equal((await app.request('DELETE', `/api/pix/chaves/${b.id}`, { user: 'ADM' })).status, 409);
});

test('validação, duplicidade e permissão do cadastro', async () => {
  assert.equal((await post('/api/pix/chaves', chave({ chave: '123' }))).status, 400);
  assert.equal((await post('/api/pix/chaves', chave({ tipo: 'XYZ' }))).status, 400);
  await post('/api/pix/chaves', chave());
  assert.equal((await post('/api/pix/chaves', chave())).status, 409);
  assert.equal((await post('/api/pix/chaves', chave(), 'ATEND')).status, 403);
});

test('cobrança PIX do pedido usa a chave padrão e o total; finalizar grava a forma de pagamento', async () => {
  const s = app.app.services;
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  const cat = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão' });
  const prato = s.pratos.create(A, { nome: 'X', categoriaId: cat.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  const p = (await post('/api/pedidos', { cliente: { nome: 'Ana', telefone: '(11) 99999-8888' }, itens: [{ tipo: 'PRATO', itemId: prato.id, quantidade: 1 }] }, 'ATEND')).body;

  assert.equal((await app.request('GET', `/api/pedidos/${p.id}/pix`, { user: 'ATEND' })).status, 409, 'sem chave padrão');
  await post('/api/pix/chaves', chave());
  const cob = await app.request('GET', `/api/pedidos/${p.id}/pix`, { user: 'ATEND' });
  assert.equal(cob.status, 200);
  assert.equal(cob.body.valorCents, 2500);
  assert.ok(cob.body.payload.includes('540525.00'));

  await post(`/api/pedidos/${p.id}/confirmar`, undefined, 'ATEND');
  await post(`/api/pedidos/${p.id}/status`, { status: 'EM_PREPARO' }, 'COZ');
  assert.equal((await post(`/api/pedidos/${p.id}/status`, { status: 'PRONTO_RETIRADA', formaPagamento: 'PIX' }, 'COZ')).status, 400);
  await post(`/api/pedidos/${p.id}/status`, { status: 'PRONTO_RETIRADA' }, 'COZ');
  assert.equal((await post(`/api/pedidos/${p.id}/status`, { status: 'FINALIZADO', formaPagamento: 'CHEQUE' }, 'ATEND')).status, 400);
  const fim = await post(`/api/pedidos/${p.id}/status`, { status: 'FINALIZADO', formaPagamento: 'PIX' }, 'ATEND');
  assert.equal(fim.status, 200);
  assert.equal(fim.body.formaPagamento, 'PIX');
});
