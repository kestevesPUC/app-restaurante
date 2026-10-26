'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestApp } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

test('GET / serve index.html', async () => {
  const res = await app.request('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.body, /<div id="app">/);
  assert.match(res.body, /\/js\/main\.js/);
});

test('style.css contém os tokens azul-escuro nos temas claro e escuro', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const claro = css.slice(0, css.indexOf('@media (prefers-color-scheme:dark)'));
  const escuro = css.slice(css.indexOf('@media (prefers-color-scheme:dark)'));
  assert.ok(claro.includes('--brand:#1e3a8a'));
  assert.ok(claro.includes('--side:#0b1f44'));
  assert.ok(escuro.includes('--brand:#8fb0ff'));
});

test('GET /style.css e /js/main.js são servidos', async () => {
  assert.equal((await app.request('GET', '/style.css')).status, 200);
  assert.equal((await app.request('GET', '/js/main.js')).status, 200);
});

test('GET /../package.json → 404', async () => {
  const res = await fetch(`${app.baseUrl}/../package.json`);
  assert.equal(res.status, 404);
  const codificado = await fetch(`${app.baseUrl}/%2e%2e/package.json`);
  assert.equal(codificado.status, 404);
});
