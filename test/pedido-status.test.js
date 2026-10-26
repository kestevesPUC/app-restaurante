'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ValidationError = require('../src/domain/errors/ValidationError');
const { STATUS, podeTransitar, podeMudarStatus } = require('../src/domain/pedido/status');
const { estimarPreparo, MODOS_ESTIMATIVA } = require('../src/domain/pedido/estimativa');

const invalido = (fn) => assert.throws(fn, ValidationError);

const VALIDAS = [
  'ABERTO>RECEBIDO', 'ABERTO>CANCELADO', 'RECEBIDO>EM_PREPARO', 'RECEBIDO>ABERTO', 'RECEBIDO>CANCELADO',
  'EM_PREPARO>PRONTO_RETIRADA', 'EM_PREPARO>PRONTO_ENTREGA', 'EM_PREPARO>CANCELADO',
  'PRONTO_RETIRADA>FINALIZADO', 'PRONTO_ENTREGA>FINALIZADO', 'PRONTO_RETIRADA>EM_PREPARO',
  'PRONTO_ENTREGA>EM_PREPARO', 'PRONTO_RETIRADA>CANCELADO', 'PRONTO_ENTREGA>CANCELADO',
];
const COZINHA = ['RECEBIDO>EM_PREPARO', 'EM_PREPARO>PRONTO_RETIRADA', 'EM_PREPARO>PRONTO_ENTREGA', 'PRONTO_RETIRADA>EM_PREPARO', 'PRONTO_ENTREGA>EM_PREPARO'];
const FINALIZA = ['PRONTO_RETIRADA>FINALIZADO', 'PRONTO_ENTREGA>FINALIZADO'];

test('STATUS lista as 7 situações', () => {
  assert.deepEqual(STATUS, ['ABERTO', 'RECEBIDO', 'EM_PREPARO', 'PRONTO_RETIRADA', 'PRONTO_ENTREGA', 'FINALIZADO', 'CANCELADO']);
});

test('podeTransitar: matriz completa 7×7', () => {
  for (const de of STATUS) {
    for (const para of STATUS) {
      assert.equal(podeTransitar(de, para), VALIDAS.includes(`${de}>${para}`), `${de} → ${para}`);
    }
  }
});

test('podeTransitar: valores desconhecidos e chaves de protótipo são falsos', () => {
  for (const x of ['__proto__', 'constructor', 'toString', 'XYZ', '', null, undefined, 1]) {
    assert.equal(podeTransitar(x, 'RECEBIDO'), false);
    assert.equal(podeTransitar('ABERTO', x), false);
    assert.equal(podeMudarStatus('A', x, 'RECEBIDO'), false);
  }
});

test('podeMudarStatus: nível A faz todas as válidas e nada além', () => {
  for (const de of STATUS) {
    for (const para of STATUS) {
      assert.equal(podeMudarStatus('A', de, para), VALIDAS.includes(`${de}>${para}`));
    }
  }
});

test('podeMudarStatus: nível B exclui as transições da cozinha', () => {
  for (const de of STATUS) {
    for (const para of STATUS) {
      const par = `${de}>${para}`;
      assert.equal(podeMudarStatus('B', de, para), VALIDAS.includes(par) && !COZINHA.includes(par), par);
    }
  }
  assert.equal(podeMudarStatus('B', 'PRONTO_RETIRADA', 'FINALIZADO'), true);
  assert.equal(podeMudarStatus('B', 'RECEBIDO', 'EM_PREPARO'), false);
  assert.equal(podeMudarStatus('B', 'ABERTO', 'RECEBIDO'), true);
  assert.equal(podeMudarStatus('B', 'RECEBIDO', 'ABERTO'), true);
  assert.equal(podeMudarStatus('B', 'EM_PREPARO', 'CANCELADO'), true);
});

test('podeMudarStatus: nível C só faz as da cozinha e finalizar', () => {
  for (const de of STATUS) {
    for (const para of STATUS) {
      const par = `${de}>${para}`;
      assert.equal(podeMudarStatus('C', de, para), COZINHA.includes(par) || FINALIZA.includes(par), par);
    }
  }
  assert.equal(podeMudarStatus('C', 'RECEBIDO', 'CANCELADO'), false);
  assert.equal(podeMudarStatus('C', 'EM_PREPARO', 'PRONTO_ENTREGA'), true);
  assert.equal(podeMudarStatus('C', 'ABERTO', 'RECEBIDO'), false);
  assert.equal(podeMudarStatus('C', 'RECEBIDO', 'ABERTO'), false);
});

test('podeMudarStatus: nível desconhecido/ausente é falso', () => {
  for (const n of [undefined, null, '', 'a', 'D', '__proto__', 'constructor', 1]) {
    assert.equal(podeMudarStatus(n, 'ABERTO', 'RECEBIDO'), false);
  }
});

// ---- estimativa ----
const prato = (t, q) => ({ tipo: 'PRATO', tempoPreparoMin: t, ...(q === undefined ? {} : { quantidade: q }) });
const bebida = (q) => ({ tipo: 'BEBIDA', tempoPreparoMin: null, quantidade: q });

test('MODOS_ESTIMATIVA', () => assert.deepEqual(MODOS_ESTIMATIVA, ['MAXIMO', 'SOMA']));

test('estimarPreparo: pratos de 15 e 25 → 25 (MAXIMO) e 40 (SOMA)', () => {
  const itens = [prato(15, 1), prato(25, 1)];
  assert.equal(estimarPreparo(itens), 25);
  assert.equal(estimarPreparo(itens, 'MAXIMO'), 25);
  assert.equal(estimarPreparo(itens, 'SOMA'), 40);
});

test('estimarPreparo: SOMA multiplica pela quantidade (2×15 + 25 = 55); MAXIMO ignora quantidade', () => {
  const itens = [prato(15, 2), prato(25, 1)];
  assert.equal(estimarPreparo(itens, 'SOMA'), 55);
  assert.equal(estimarPreparo(itens, 'MAXIMO'), 25);
  assert.equal(estimarPreparo([prato(15), prato(25)], 'SOMA'), 40);
});

test('estimarPreparo: bebidas valem 0; vazio → 0', () => {
  assert.equal(estimarPreparo([bebida(2), bebida(1)]), 0);
  assert.equal(estimarPreparo([bebida(2)], 'SOMA'), 0);
  assert.equal(estimarPreparo([]), 0);
  assert.equal(estimarPreparo([], 'SOMA'), 0);
  assert.equal(estimarPreparo([bebida(1), prato(10, 1)], 'SOMA'), 10);
});

test('estimarPreparo: entradas inválidas', () => {
  invalido(() => estimarPreparo([prato(10)], 'MEDIA'));
  invalido(() => estimarPreparo([prato(10)], '__proto__'));
  for (const t of [0, 1.5, '10', -3, NaN, null, undefined, Number.MAX_SAFE_INTEGER + 2]) invalido(() => estimarPreparo([prato(t, 1)]));
  for (const q of [0, 1.5, '2', -1, NaN]) invalido(() => estimarPreparo([prato(10, q)], 'SOMA'));
  invalido(() => estimarPreparo('x'));
  invalido(() => estimarPreparo([null]));
  invalido(() => estimarPreparo([{ tipo: 'OUTRO', tempoPreparoMin: 5 }]));
});

test('estimarPreparo: estouro e limite de 100000 minutos', () => {
  invalido(() => estimarPreparo([prato(Number.MAX_SAFE_INTEGER, 2)], 'SOMA'));
  invalido(() => estimarPreparo([prato(100001, 1)]));
  invalido(() => estimarPreparo([prato(60000, 2)], 'SOMA'));
  assert.equal(estimarPreparo([prato(50000, 2)], 'SOMA'), 100000);
});
