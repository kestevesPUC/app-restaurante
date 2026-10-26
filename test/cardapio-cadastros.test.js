'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

const criarIngrediente = (nome, extra = {}) => app.request('POST', '/api/ingredientes', { user: 'ADM', body: { nome, precoAdicionalCents: 0, podeSerAdicional: false, ...extra } });

test('rejeita ingrediente "Pao" quando existe "Pão"', async () => {
  assert.equal((await criarIngrediente('Pão')).status, 200);
  assert.equal((await criarIngrediente('Pao')).status, 409);
  assert.equal((await criarIngrediente('PÃO')).status, 409);
});

test('rejeita nome vazio ou > 60 caracteres', async () => {
  assert.equal((await criarIngrediente('   ')).status, 400);
  assert.equal((await criarIngrediente('x'.repeat(61))).status, 400);
  assert.equal((await criarIngrediente('x'.repeat(60))).status, 200);
  assert.equal((await app.request('POST', '/api/categorias', { user: 'ADM', body: { nome: '' } })).status, 400);
});

test('precoAdicionalCents negativo → 400', async () => {
  assert.equal((await criarIngrediente('Queijo', { precoAdicionalCents: -1 })).status, 400);
  assert.equal((await criarIngrediente('Queijo', { precoAdicionalCents: 1.5 })).status, 400);
});

test('excluir ingrediente em uso → 409 "Em uso"', async () => {
  const ing = (await criarIngrediente('Alface')).body;
  const cat = (await app.request('POST', '/api/categorias', { user: 'ADM', body: { nome: 'Saladas' } })).body;
  app.db.prepare('INSERT INTO pratos (id, categoria_id, nome, nome_norm, preco_cents) VALUES (1, ?, ?, ?, 1000)').run(cat.id, 'Salada', 'salada');
  app.db.prepare('INSERT INTO prato_ingredientes (prato_id, ingrediente_id) VALUES (1, ?)').run(ing.id);
  const res = await app.request('DELETE', `/api/ingredientes/${ing.id}`, { user: 'ADM' });
  assert.equal(res.status, 409);
  assert.match(JSON.stringify(res.body), /Em uso/);
  const resCat = await app.request('DELETE', `/api/categorias/${cat.id}`, { user: 'ADM' });
  assert.equal(resCat.status, 409);
  assert.match(JSON.stringify(resCat.body), /Em uso/);
  const livre = (await criarIngrediente('Tomate')).body;
  assert.equal((await app.request('DELETE', `/api/ingredientes/${livre.id}`, { user: 'ADM' })).status, 200);
});

test('PUT ativo=false desativa', async () => {
  const ing = (await criarIngrediente('Bacon', { precoAdicionalCents: 300, podeSerAdicional: true })).body;
  const res = await app.request('PUT', `/api/ingredientes/${ing.id}`, { user: 'ADM', body: { ativo: false } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ativo, false);
  assert.equal(res.body.precoAdicionalCents, 300);
  const lista = await app.request('GET', '/api/ingredientes', { user: 'ADM' });
  assert.equal(lista.body.find((i) => i.id === ing.id).ativo, false);
});

test('categoria nova tem vaiParaCozinha = true', async () => {
  const res = await app.request('POST', '/api/categorias', { user: 'ADM', body: { nome: 'Lanches', ordem: 2 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.vaiParaCozinha, true);
  assert.equal(res.body.ativo, true);
  assert.equal(res.body.ordem, 2);
  const bebidas = await app.request('POST', '/api/categorias', { user: 'ADM', body: { nome: 'Bebidas', vaiParaCozinha: false } });
  assert.equal(bebidas.body.vaiParaCozinha, false);
});

test('nível B faz GET e recebe 403 no POST; nível C não vê o cardápio', async () => {
  assert.equal((await app.request('GET', '/api/categorias', { user: 'ATEND' })).status, 200);
  assert.equal((await app.request('GET', '/api/ingredientes', { user: 'ATEND' })).status, 200);
  assert.equal((await app.request('POST', '/api/categorias', { user: 'ATEND', body: { nome: 'X' } })).status, 403);
  assert.equal((await app.request('PUT', '/api/ingredientes/1', { user: 'ATEND', body: { nome: 'X' } })).status, 403);
  assert.equal((await app.request('GET', '/api/categorias', { user: 'COZ' })).status, 403);
});

test('nome com emoji e & é gravado e devolvido intacto', async () => {
  const nome = 'Molho & Cia 🌶️ Açaí';
  const criado = await criarIngrediente(nome);
  assert.equal(criado.body.nome, nome);
  const lista = await app.request('GET', '/api/ingredientes', { user: 'ATEND' });
  assert.equal(lista.body.find((i) => i.id === criado.body.id).nome, nome);
});

test('criação, alteração e exclusão geram auditoria', async () => {
  const ing = (await criarIngrediente('Cebola')).body;
  await app.request('PUT', `/api/ingredientes/${ing.id}`, { user: 'ADM', body: { nome: 'Cebola roxa' } });
  await app.request('DELETE', `/api/ingredientes/${ing.id}`, { user: 'ADM' });
  const linhas = app.db.prepare("SELECT acao FROM auditoria WHERE entidade = 'ingrediente' ORDER BY id").all();
  assert.deepEqual(linhas.map((l) => l.acao), ['criar', 'alterar', 'excluir']);
});
