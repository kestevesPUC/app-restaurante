'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarTelefone } = require('../src/domain/phone');
const ValidationError = require('../src/domain/errors/ValidationError');

test('variantes de celular viram +5511999998888', () => {
  for (const t of ['(11) 99999-8888', '+55 11 99999-8888', '11999998888', '011999998888', '+5511999998888', '55 (11) 99999-8888']) {
    assert.equal(normalizarTelefone(t), '+5511999998888', t);
  }
});

test('fixo de 8 dígitos', () => {
  assert.equal(normalizarTelefone('(11) 3333-4444'), '+551133334444');
});

test('entradas inválidas lançam ValidationError', () => {
  const invalidas = ['99998888', '123', 'abc', '', '   ', null, undefined, 12345, '(00) 99999-8888', '55119999988889999', '+55 11 99999-8888 ramal 2',
    '(11) 09999-8888', '(11) 1333-4444', '(11) 8999-8888', '(10) 99999-8888', '(20) 99999-8888'];
  for (const t of invalidas) assert.throws(() => normalizarTelefone(t), ValidationError, String(t));
});

test('mensagem de erro é clara', () => {
  assert.throws(() => normalizarTelefone('123'), /Telefone inválido: informe DDD e número/);
});
