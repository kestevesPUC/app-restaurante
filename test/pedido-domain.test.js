'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ValidationError = require('../src/domain/errors/ValidationError');
const { calcularItem, calcularPedido } = require('../src/domain/pedido/calculos');
const { SITUACOES, podeTransitar } = require('../src/domain/pedido/situacoes');
const { validarItem, validarIdentificacao } = require('../src/domain/pedido/ItemValidator');

const invalido = (fn) => assert.throws(fn, ValidationError);

// ---- cálculos ----
test('X-Burger 2800 + bacon 2×200, quantidade 2 → adicionaisCents 400 e totalCents 6400', () => {
  const r = calcularItem({ precoPratoCents: 2800, adicionais: [{ precoUnitCents: 200, quantidade: 2 }], quantidade: 2 });
  assert.deepEqual(r, { adicionaisCents: 400, totalCents: 6400 });
});

test('remover ingrediente não altera o preço (sem adicionais, total = preço × quantidade)', () => {
  const r = calcularItem({ precoPratoCents: 2800, adicionais: [], quantidade: 1 });
  assert.deepEqual(r, { adicionaisCents: 0, totalCents: 2800 });
});

test('inteiros em centavos: 1999 × 3 não deriva (5997)', () => {
  assert.equal(calcularItem({ precoPratoCents: 1999, adicionais: [], quantidade: 3 }).totalCents, 5997);
  const r = calcularItem({ precoPratoCents: 1999, adicionais: [{ precoUnitCents: 333, quantidade: 3 }], quantidade: 3 });
  assert.deepEqual(r, { adicionaisCents: 999, totalCents: (1999 + 999) * 3 });
});

test('calcularItem rejeita dinheiro/quantidade inválidos e estouro', () => {
  const base = { precoPratoCents: 100, adicionais: [], quantidade: 1 };
  for (const p of [-1, 1.5, NaN, '100', Infinity, null]) invalido(() => calcularItem({ ...base, precoPratoCents: p }));
  for (const q of [0, 1.5, '2', NaN, Infinity, -1]) invalido(() => calcularItem({ ...base, quantidade: q }));
  invalido(() => calcularItem({ ...base, adicionais: [{ precoUnitCents: -5, quantidade: 1 }] }));
  invalido(() => calcularItem({ ...base, adicionais: [{ precoUnitCents: 1.5, quantidade: 1 }] }));
  invalido(() => calcularItem({ ...base, adicionais: [{ precoUnitCents: 5, quantidade: 0 }] }));
  invalido(() => calcularItem({ ...base, adicionais: 'x' }));
  invalido(() => calcularItem({ ...base, precoPratoCents: Number.MAX_SAFE_INTEGER, quantidade: 2 }));
});

test('itens cancelados não entram no subtotal', () => {
  const r = calcularPedido([{ totalCents: 1000 }, { totalCents: 500, cancelado: true }, { totalCents: 250, cancelado: false }]);
  assert.deepEqual(r, { subtotalCents: 1250, descontoCents: 0, totalCents: 1250 });
});

test('desconto abate do subtotal; igual ao subtotal zera o total', () => {
  assert.deepEqual(calcularPedido([{ totalCents: 1000 }], 300), { subtotalCents: 1000, descontoCents: 300, totalCents: 700 });
  assert.equal(calcularPedido([{ totalCents: 1000 }], 1000).totalCents, 0);
  assert.deepEqual(calcularPedido([], 0), { subtotalCents: 0, descontoCents: 0, totalCents: 0 });
});

test('desconto maior que subtotal → ValidationError', () => {
  invalido(() => calcularPedido([{ totalCents: 1000 }], 1001));
  invalido(() => calcularPedido([{ totalCents: 1000, cancelado: true }], 1));
});

test('calcularPedido rejeita desconto e itens inválidos', () => {
  for (const d of [-1, 1.5, NaN, '10', Infinity]) invalido(() => calcularPedido([{ totalCents: 1000 }], d));
  invalido(() => calcularPedido([{ totalCents: 10.5 }]));
  invalido(() => calcularPedido([{ totalCents: -1 }]));
  invalido(() => calcularPedido('x'));
  invalido(() => calcularPedido([{ totalCents: Number.MAX_SAFE_INTEGER }, { totalCents: 10 }]));
});

// ---- situações ----
test('SITUACOES lista as quatro situações', () => {
  assert.deepEqual(SITUACOES, ['ABERTO', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO']);
});

test('ABERTO→AGUARDANDO_PAGAMENTO ok, PAGO→ABERTO não, PAGO→CANCELADO ok, CANCELADO→qualquer não', () => {
  assert.equal(podeTransitar('ABERTO', 'AGUARDANDO_PAGAMENTO'), true);
  assert.equal(podeTransitar('PAGO', 'ABERTO'), false);
  assert.equal(podeTransitar('PAGO', 'CANCELADO'), true);
  for (const s of SITUACOES) assert.equal(podeTransitar('CANCELADO', s), false);
});

test('matriz completa de transições; mesma situação e desconhecidas são falsas', () => {
  const ok = new Set(['ABERTO>AGUARDANDO_PAGAMENTO', 'ABERTO>CANCELADO', 'AGUARDANDO_PAGAMENTO>ABERTO',
    'AGUARDANDO_PAGAMENTO>PAGO', 'AGUARDANDO_PAGAMENTO>CANCELADO', 'PAGO>CANCELADO']);
  for (const de of SITUACOES) {
    for (const para of SITUACOES) {
      assert.equal(podeTransitar(de, para), ok.has(`${de}>${para}`), `${de}→${para}`);
    }
  }
  assert.equal(podeTransitar('XYZ', 'ABERTO'), false);
  assert.equal(podeTransitar('ABERTO', 'XYZ'), false);
  assert.equal(podeTransitar(undefined, null), false);
  assert.equal(podeTransitar('toString', 'ABERTO'), false);
});

// ---- validarItem ----
const prato = {
  id: 7, nome: 'X-Burger', precoCents: 2800,
  ingredientes: [
    { ingredienteId: 1, removivel: true },   // cebola
    { ingredienteId: 2, removivel: false },  // pão
    { ingredienteId: 3, removivel: true },   // queijo (também adicional)
  ],
};
const adicionais = [
  { ingredienteId: 3, nome: 'Queijo', precoAdicionalCents: 300 },
  { ingredienteId: 4, nome: 'Bacon', precoAdicionalCents: 200 },
];

test('validarItem normaliza entrada válida', () => {
  const r = validarItem({ pratoId: 7, quantidade: 2, observacao: '  sem sal ', remover: [1], adicionar: [{ ingredienteId: 4, quantidade: 2 }] }, prato, adicionais);
  assert.deepEqual(r, { pratoId: 7, quantidade: 2, observacao: 'sem sal', remover: [1], adicionar: [{ ingredienteId: 4, quantidade: 2 }] });
});

test('validarItem: padrões (remover/adicionar ausentes, observação vazia → null)', () => {
  assert.deepEqual(validarItem({ pratoId: 7, quantidade: 1, observacao: '   ' }, prato, adicionais),
    { pratoId: 7, quantidade: 1, observacao: null, remover: [], adicionar: [] });
});

test('validarItem ignora campos de preço vindos do cliente', () => {
  const r = validarItem({ pratoId: 7, quantidade: 1, precoCents: 1, total: 1, totalCents: 1 }, prato, adicionais);
  assert.deepEqual(Object.keys(r).sort(), ['adicionar', 'observacao', 'pratoId', 'quantidade', 'remover']);
});

test('remover ingrediente não removível → erro', () => {
  invalido(() => validarItem({ quantidade: 1, remover: [2] }, prato, adicionais));
});

test('remover ingrediente que não é do prato → erro', () => {
  invalido(() => validarItem({ quantidade: 1, remover: [99] }, prato, adicionais));
});

test('remover e adicionar o mesmo ingrediente → erro', () => {
  invalido(() => validarItem({ quantidade: 1, remover: [3], adicionar: [{ ingredienteId: 3, quantidade: 1 }] }, prato, adicionais));
});

test('adicionar ingrediente fora da lista de adicionais (podeSerAdicional falso) → erro', () => {
  invalido(() => validarItem({ quantidade: 1, adicionar: [{ ingredienteId: 1, quantidade: 1 }] }, prato, adicionais));
});

test('adicionar de novo um ingrediente padrão (dose extra) → ok', () => {
  const r = validarItem({ quantidade: 1, adicionar: [{ ingredienteId: 3, quantidade: 1 }] }, prato, adicionais);
  assert.deepEqual(r.adicionar, [{ ingredienteId: 3, quantidade: 1 }]);
});

test('ids repetidos em remover ou adicionar → erro', () => {
  invalido(() => validarItem({ quantidade: 1, remover: [1, 1] }, prato, adicionais));
  invalido(() => validarItem({ quantidade: 1, adicionar: [{ ingredienteId: 4, quantidade: 1 }, { ingredienteId: 4, quantidade: 1 }] }, prato, adicionais));
});

test('quantidade de adicional inválida → erro', () => {
  for (const q of [0, 1.5, '1', NaN, -1]) invalido(() => validarItem({ quantidade: 1, adicionar: [{ ingredienteId: 4, quantidade: q }] }, prato, adicionais));
});

test('observação: 140 caracteres ok, 141 erro, conta caracteres Unicode', () => {
  assert.equal(validarItem({ quantidade: 1, observacao: 'a'.repeat(140) }, prato, adicionais).observacao.length, 140);
  invalido(() => validarItem({ quantidade: 1, observacao: 'a'.repeat(141) }, prato, adicionais));
  assert.equal([...validarItem({ quantidade: 1, observacao: '😀'.repeat(140) }, prato, adicionais).observacao].length, 140);
  invalido(() => validarItem({ quantidade: 1, observacao: '😀'.repeat(141) }, prato, adicionais));
  invalido(() => validarItem({ quantidade: 1, observacao: 123 }, prato, adicionais));
});

test('quantidade 0 ou 1.5 → erro (e string, NaN, Infinity, ausente)', () => {
  for (const q of [0, 1.5, '2', NaN, Infinity, -1, undefined]) invalido(() => validarItem({ quantidade: q }, prato, adicionais));
});

test('validarItem rejeita remover/adicionar que não sejam listas e entrada ausente', () => {
  invalido(() => validarItem({ quantidade: 1, remover: 1 }, prato, adicionais));
  invalido(() => validarItem({ quantidade: 1, remover: ['1'] }, prato, adicionais));
  invalido(() => validarItem({ quantidade: 1, adicionar: {} }, prato, adicionais));
  invalido(() => validarItem(null, prato, adicionais));
});

// ---- validarIdentificacao ----
test('MESA sem mesaId → erro; com mesaId ok (clienteNome opcional)', () => {
  invalido(() => validarIdentificacao({ tipo: 'MESA' }));
  for (const m of [0, -1, 1.5, '3', NaN]) invalido(() => validarIdentificacao({ tipo: 'MESA', mesaId: m }));
  assert.deepEqual(validarIdentificacao({ tipo: 'MESA', mesaId: 3 }), { tipo: 'MESA', mesaId: 3, clienteNome: null });
  assert.deepEqual(validarIdentificacao({ tipo: 'MESA', mesaId: 3, clienteNome: ' Ana ' }), { tipo: 'MESA', mesaId: 3, clienteNome: 'Ana' });
});

test('BALCAO sem clienteNome → erro; com nome ok e mesaId vira null', () => {
  invalido(() => validarIdentificacao({ tipo: 'BALCAO' }));
  invalido(() => validarIdentificacao({ tipo: 'BALCAO', clienteNome: '   ' }));
  assert.deepEqual(validarIdentificacao({ tipo: 'BALCAO', mesaId: 5, clienteNome: ' João ' }), { tipo: 'BALCAO', mesaId: null, clienteNome: 'João' });
});

test('clienteNome com mais de 60 caracteres e tipo inválido → erro', () => {
  invalido(() => validarIdentificacao({ tipo: 'BALCAO', clienteNome: 'a'.repeat(61) }));
  assert.equal(validarIdentificacao({ tipo: 'BALCAO', clienteNome: 'a'.repeat(60) }).clienteNome.length, 60);
  invalido(() => validarIdentificacao({ tipo: 'DELIVERY', clienteNome: 'x' }));
  invalido(() => validarIdentificacao({}));
});
