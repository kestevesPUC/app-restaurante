'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comLimite } = require('../src/desktop/comLimite');

test('promessa que nunca resolve: segue após o limite e registra', async () => {
  const erros = [];
  const ok = await comLimite(new Promise(() => {}), 20, { logger: { error: (m) => erros.push(m) }, rotulo: 'x' });
  assert.equal(ok, false);
  assert.equal(erros.length, 1);
});

test('promessa que conclui ou rejeita no prazo não trava nem propaga', async () => {
  const erros = [];
  const logger = { error: (...a) => erros.push(a) };
  assert.equal(await comLimite(Promise.resolve(1), 1000, { logger }), true);
  assert.equal(await comLimite(Promise.reject(new Error('x')), 1000, { logger }), false);
  assert.equal(erros.length, 1);
});
