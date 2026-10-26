'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Funções puras do front-end (ES modules em public/js) importadas dinamicamente.
const carregar = (arquivo) => import(`../public/js/${arquivo}`);

test('reaisParaCents converte reais em centavos inteiros (vírgula decimal e milhar)', async () => {
  const { reaisParaCents } = await carregar('format.js');
  assert.equal(reaisParaCents('12,50'), 1250);
  assert.equal(reaisParaCents('12.50'), 1250);
  assert.equal(reaisParaCents('1.234,56'), 123456);
  assert.equal(reaisParaCents('R$ 1.234,56'), 123456);
  assert.equal(reaisParaCents('1.234'), 123400);
  assert.equal(reaisParaCents('7'), 700);
  assert.equal(reaisParaCents('0,1'), 10);
  assert.equal(reaisParaCents('0,07'), 7);
  assert.equal(reaisParaCents('19,90'), 1990);
  assert.equal(reaisParaCents('0'), 0);
  assert.equal(reaisParaCents(' 3,5 '), 350);
});

test('reaisParaCents rejeita negativos, NaN, vazio e mais de 2 casas', async () => {
  const { reaisParaCents } = await carregar('format.js');
  for (const ruim of ['', '  ', '-1', '-0,50', 'abc', '1,2,3', '1,234', 'NaN', 'Infinity', '1e3', null, undefined, '12,5x']) {
    assert.equal(reaisParaCents(ruim), null, `deveria rejeitar ${JSON.stringify(ruim)}`);
  }
});

test('centsParaReais devolve texto editável com vírgula e 2 casas', async () => {
  const { centsParaReais } = await carregar('format.js');
  assert.equal(centsParaReais(1250), '12,50');
  assert.equal(centsParaReais(7), '0,07');
  assert.equal(centsParaReais(0), '0,00');
  assert.equal(centsParaReais(123456), '1234,56');
  assert.equal(centsParaReais(null), '');
});

test('brl formata R$ 1.234,56', async () => {
  const { brl } = await carregar('format.js');
  assert.equal(brl(123456).replace(/\s/g, ' '), 'R$ 1.234,56');
});

test('moverItem troca vizinhos, respeita limites e não altera a lista original', async () => {
  const { moverItem } = await carregar('listaOrdenada.js');
  const base = [{ ingredienteId: 1 }, { ingredienteId: 2 }, { ingredienteId: 3 }];
  assert.deepEqual(moverItem(base, 1, -1).map((i) => i.ingredienteId), [2, 1, 3]);
  assert.deepEqual(moverItem(base, 1, 1).map((i) => i.ingredienteId), [1, 3, 2]);
  assert.deepEqual(moverItem(base, 0, -1).map((i) => i.ingredienteId), [1, 2, 3]);
  assert.deepEqual(moverItem(base, 2, 1).map((i) => i.ingredienteId), [1, 2, 3]);
  assert.deepEqual(base.map((i) => i.ingredienteId), [1, 2, 3]);
});

test('renumerar e ordenarPorOrdem mantêm ordem sequencial 0..n-1', async () => {
  const { renumerar, ordenarPorOrdem } = await carregar('listaOrdenada.js');
  const lista = [{ ingredienteId: 5, ordem: 7 }, { ingredienteId: 6, ordem: 2 }, { ingredienteId: 7, ordem: 4 }];
  assert.deepEqual(ordenarPorOrdem(lista).map((i) => i.ingredienteId), [6, 7, 5]);
  assert.deepEqual(renumerar(ordenarPorOrdem(lista)).map((i) => [i.ingredienteId, i.ordem]), [[6, 0], [7, 1], [5, 2]]);
});

test('adicionarIngrediente evita duplicata e removerIngrediente renumera', async () => {
  const { adicionarIngrediente, removerIngrediente } = await carregar('listaOrdenada.js');
  let lista = [];
  lista = adicionarIngrediente(lista, { ingredienteId: 1, nome: 'Pão' });
  lista = adicionarIngrediente(lista, { ingredienteId: 2, nome: 'Carne' });
  lista = adicionarIngrediente(lista, { ingredienteId: 1, nome: 'Pão' });
  assert.deepEqual(lista.map((i) => [i.ingredienteId, i.ordem, i.removivel]), [[1, 0, true], [2, 1, true]]);
  lista = removerIngrediente(lista, 1);
  assert.deepEqual(lista.map((i) => [i.ingredienteId, i.ordem]), [[2, 0]]);
});
