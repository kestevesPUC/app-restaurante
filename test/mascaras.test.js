'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatarNome } = require('../src/domain/nomePessoa');
const { mascararTelefone } = require('../src/domain/phone');

test('formatarNome: maiúsculas, minúsculas, espaços e partículas', () => {
  assert.equal(formatarNome('JOÃO DA SILVA'), 'João da Silva');
  assert.equal(formatarNome('  maria   de lourdes '), 'Maria de Lourdes');
  assert.equal(formatarNome('ana-clara DOS santos e souza'), 'Ana-Clara dos Santos e Souza');
  assert.equal(formatarNome('DA silva'), 'Da Silva');
  assert.equal(formatarNome("don't"), "Don't");
  assert.equal(formatarNome(''), '');
});

test('mascararTelefone: celular, fixo e valor desconhecido', () => {
  assert.equal(mascararTelefone('+5531993512666'), '(31) 99351-2666');
  assert.equal(mascararTelefone('+553133334444'), '(31) 3333-4444');
  assert.equal(mascararTelefone('abc'), 'abc');
});

test('máscaras da interface (telefone, CPF, CEP, dinheiro) e o mesmo formatador de nome do servidor', async () => {
  const m = await import('../public/js/mask.js');
  assert.equal(m.maskTelefone('31993512666'), '(31) 99351-2666');
  assert.equal(m.maskTelefone('+5531993512666'), '(31) 99351-2666');
  assert.equal(m.maskTelefone('3133334444'), '(31) 3333-4444');
  assert.equal(m.maskTelefone('319'), '(31) 9');
  assert.equal(m.maskCpf('12345678901'), '123.456.789-01');
  assert.equal(m.maskCpf('12345'), '123.45');
  assert.equal(m.maskCep('30140071'), '30140-071');
  assert.equal(m.maskDinheiro('5'), '0,05');
  assert.equal(m.maskDinheiro('1250'), '12,50');
  assert.equal(m.maskDinheiro('123456789'), '1.234.567,89');
  assert.equal(m.maskDinheiro(''), '');
  for (const nome of ['JOÃO DA SILVA', 'ana-clara DOS santos', '"x" y']) assert.equal(m.formatarNome(nome), formatarNome(nome));
});
