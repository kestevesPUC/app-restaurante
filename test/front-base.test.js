'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { createTestApp } = require('./helpers/createTestApp');
const { protegerNavegacao } = require('../src/desktop/protegerNavegacao');

const SITE = 'https://kaio-gomes-site.vercel.app/';
const carregar = (arquivo) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', arquivo)).href);

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

test('renderCreditos tem o link exato, em nova janela e sem opener', async () => {
  const { renderCreditos } = await carregar('components/creditos.js');
  const html = renderCreditos();
  assert.ok(html.includes(`href="${SITE}"`));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('Desenvolvido por Kaio Gomes'));
});

test('o HTML servido em / carrega o rodapé de crédito', async () => {
  const res = await app.request('GET', '/');
  assert.ok(res.body.includes(`href="${SITE}"`));
  assert.match(res.body, /rel="noopener noreferrer"/);
  assert.match(res.body, /Desenvolvido por Kaio Gomes/);
});

test('menu por nível: A completo, B enxuto, C sem menu', async () => {
  const { menuPara, rotaInicial, podeAcessar } = await carregar('niveis.js');
  const ids = (n) => menuPara(n).map((r) => r.id);
  assert.deepEqual(ids('A'), ['andon', 'cardapio', 'ingredientes', 'pratos', 'categorias', 'usuarios', 'auditoria', 'sobre']);
  assert.deepEqual(ids('B'), ['cardapio', 'sobre']);
  assert.deepEqual(menuPara('C'), []);
  assert.equal(menuPara('A').find((r) => r.id === 'andon').rotulo, 'Cozinha');
  assert.equal(rotaInicial('B'), 'cardapio');
  assert.equal(rotaInicial('C'), 'andon');
  assert.equal(podeAcessar('B', 'andon'), false);
  assert.equal(podeAcessar('B', 'pratos'), false);
  assert.equal(podeAcessar('C', 'cardapio'), false);
});

test('GET /api/cardapio/completo inclui inativos; B 200, C 403', async () => {
  app.app.repositories.bebidas.create({ nome: 'Suco', precoCents: 500, estoqueInicial: 1, estoqueMinimo: 5, ativo: false }, new Date().toISOString());
  const a = await app.request('GET', '/api/cardapio/completo', { user: 'ADM' });
  assert.equal(a.status, 200);
  assert.ok(Array.isArray(a.body.pratos) && Array.isArray(a.body.bebidas) && Array.isArray(a.body.categorias));
  const suco = a.body.bebidas.find((b) => b.nome === 'Suco');
  assert.equal(suco.ativo, false);
  assert.equal(suco.critico, true);
  assert.equal(suco.estoqueQtd, 1);
  assert.equal((await app.request('GET', '/api/cardapio/completo', { user: 'ATEND' })).status, 200);
  assert.equal((await app.request('GET', '/api/cardapio/completo', { user: 'COZ' })).status, 403);
});

test('o link de crédito abre fora do app (protegerNavegacao → openExternal)', () => {
  const wc = new EventEmitter();
  wc.setWindowOpenHandler = (h) => { wc.openHandler = h; };
  const externos = [];
  protegerNavegacao(wc, 'http://127.0.0.1:5000', (u) => externos.push(u));
  assert.deepEqual(wc.openHandler({ url: SITE }), { action: 'deny' });
  const e = { url: SITE, preventDefault() { e.barrado = true; } };
  wc.emit('will-navigate', e, SITE);
  assert.equal(e.barrado, true);
  assert.deepEqual(externos, [SITE, SITE]);
});
