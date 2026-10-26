'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');
const pkg = require('../package.json');

test('GET /api/sistema devolve nome e versão do package.json para A, B e C', async () => {
  const t = await createTestApp();
  after(() => t.close());
  for (const user of ['ADM', 'ATEND', 'COZ']) {
    const res = await t.request('GET', '/api/sistema', { user });
    assert.equal(res.status, 200, user);
    assert.deepEqual(res.body, { nome: 'PDV Restaurante', versao: pkg.version });
  }
});

test('GET /api/sistema sem login responde 401', async () => {
  const t = await createTestApp();
  after(() => t.close());
  assert.equal((await t.request('GET', '/api/sistema')).status, 401);
});

test('erro 500 grava linha error com idRequisicao e a resposta não traz stack nem id', async () => {
  const linhas = [];
  const logger = { error: (...a) => linhas.push(a), info() {} };
  const t = await createTestApp({ logger });
  after(() => t.close());
  t.app.services.config.get = () => { throw new Error('quebrou de propósito'); };
  const res = await t.request('GET', '/api/config/whatsapp', { user: 'ADM' });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'Erro interno' });
  assert.ok(!JSON.stringify(res.body).includes('stack'));
  const [erro, ctx] = linhas.at(-1);
  assert.match(erro.message, /quebrou/);
  assert.match(ctx.idRequisicao, /^[0-9a-f]{8}$/);
  assert.equal(ctx.metodo, 'GET');
  assert.equal(ctx.rota, '/api/config/whatsapp');
  assert.ok(!('body' in ctx) && !('headers' in ctx));
  assert.ok(!JSON.stringify(res.body).includes(ctx.idRequisicao));
});

test('login registra evento info no log com o usuário e nunca a senha', async () => {
  const infos = [];
  const logger = { error() {}, info: (msg, ctx) => infos.push({ msg, ctx }) };
  const t = await createTestApp({ logger });
  after(() => t.close());
  await t.request('POST', '/api/login', { body: { usuario: 'ADM', senha: 'errada' } });
  const falha = infos.find((i) => i.ctx.acao === 'login_falha');
  assert.equal(falha.ctx.usuario, 'ADM');
  assert.ok(!JSON.stringify(infos).includes('errada'));
});
