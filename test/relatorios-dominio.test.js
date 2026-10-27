'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolverPeriodo, chaveLocal, agruparPorChave } = require('../src/domain/relatorio/periodo');
const { TIPOS, obterTipo, validarAgrupar, validarLimite, ticketMedio } = require('../src/domain/relatorio/tipos');

const local = (a, m, d, h = 0, min = 0) => new Date(a, m - 1, d, h, min).getTime();

test('período: limites UTC a partir de datas locais, ate inclusivo (início do dia seguinte)', () => {
  const p = resolverPeriodo({ de: '2026-10-01', ate: '2026-10-23' }, local(2026, 10, 23, 12));
  assert.equal(p.de, '2026-10-01');
  assert.equal(p.ate, '2026-10-23');
  assert.equal(p.inicioIso, new Date(2026, 9, 1).toISOString());
  assert.equal(p.fimIso, new Date(2026, 9, 24).toISOString());
});

test('período padrão: dia 1 do mês local atual até hoje', () => {
  const p = resolverPeriodo({}, local(2026, 10, 23, 23, 59));
  assert.deepEqual([p.de, p.ate], ['2026-10-01', '2026-10-23']);
});

test('período: virada de ano no fim (31/12 → 01/01)', () => {
  const p = resolverPeriodo({ de: '2026-12-31', ate: '2026-12-31' }, local(2027, 1, 5));
  assert.equal(p.fimIso, new Date(2027, 0, 1).toISOString());
});

test('período inválido: de > ate, formato, data inexistente e intervalo > 3660 dias → ValidationError', () => {
  const agora = local(2026, 10, 23);
  for (const f of [{ de: '2026-10-02', ate: '2026-10-01' }, { de: '2026-1-01', ate: '2026-10-01' }, { de: '2026-02-30', ate: '2026-03-01' }, { de: '2000-01-01', ate: '2026-10-01' }]) {
    assert.throws(() => resolverPeriodo(f, agora), (e) => e.status === 400, JSON.stringify(f));
  }
  assert.doesNotThrow(() => resolverPeriodo({ de: '2016-10-25', ate: '2026-10-25' }, agora));
});

test('chave local: 23:50 e 00:10 caem em dias diferentes; mês e ano', () => {
  const a = new Date(local(2026, 10, 23, 23, 50)).toISOString();
  const b = new Date(local(2026, 10, 24, 0, 10)).toISOString();
  assert.equal(chaveLocal(a, 'dia'), '2026-10-23');
  assert.equal(chaveLocal(b, 'dia'), '2026-10-24');
  assert.equal(chaveLocal(new Date(local(2026, 12, 31, 23, 50)).toISOString(), 'mes'), '2026-12');
  assert.equal(chaveLocal(new Date(local(2027, 1, 1, 0, 10)).toISOString(), 'ano'), '2027');
});

test('agruparPorChave mantém a ordem crescente das chaves', () => {
  const g = agruparPorChave([{ k: 'b', v: 1 }, { k: 'a', v: 2 }, { k: 'b', v: 3 }], (x) => x.k);
  assert.deepEqual([...g.keys()], ['a', 'b']);
  assert.deepEqual(g.get('b').map((x) => x.v), [1, 3]);
});

test('ticket médio arredondado em centavos; 0 sem pedidos', () => {
  assert.equal(ticketMedio(10000, 3), 3333);
  assert.equal(ticketMedio(10001, 2), 5001);
  assert.equal(ticketMedio(0, 0), 0);
});

test('agrupar e limite: valores aceitos, padrões e inválidos', () => {
  assert.equal(validarAgrupar(undefined), 'dia');
  for (const v of ['dia', 'mes', 'ano']) assert.equal(validarAgrupar(v), v);
  assert.throws(() => validarAgrupar('semana'), (e) => e.status === 400);
  assert.equal(validarLimite(undefined), 20);
  assert.equal(validarLimite(200), 200);
  for (const v of [0, 201, 1.5, '3']) assert.throws(() => validarLimite(v), (e) => e.status === 400);
});

test('catálogo: 11 tipos com colunas tipadas; inexistente → undefined', () => {
  const chaves = TIPOS.map((t) => t.tipo);
  assert.deepEqual(chaves, ['pedidos-periodo', 'pedidos-finalizados', 'pedidos-cancelados', 'tempo-medio-preparo', 'faturamento', 'ticket-medio',
    'bebidas-mais-vendidas', 'estoque-atual', 'estoque-critico', 'clientes-frequentes', 'clientes-maior-gasto']);
  for (const t of TIPOS) for (const c of t.colunas) assert.ok(['texto', 'inteiro', 'dinheiro', 'duracao', 'data', 'telefone'].includes(c.tipo), `${t.tipo}.${c.chave}`);
  assert.equal(obterTipo('nada'), undefined);
  assert.equal(obterTipo('__proto__'), undefined);
});
