'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const SqliteDatabase = require('../src/infrastructure/database/SqliteDatabase');
const { ehViolacaoDeChave } = require('../src/infrastructure/database/violacoes');

const capturar = (fn) => { try { fn(); } catch (error) { return error; } return null; };

test('ehViolacaoDeChave: erro real de FK → true; outros erros → false', () => {
  const db = new SqliteDatabase(':memory:');
  db.prepare("INSERT INTO mesas (id, numero, numero_norm, capacidade) VALUES (1, '1', '1', 2)").run();
  db.prepare("INSERT INTO fila_espera (cliente_nome, pessoas, mesa_id, entrou_em) VALUES ('a', 2, 1, 'x')").run();
  const fk = capturar(() => db.prepare('DELETE FROM mesas WHERE id = 1').run());
  assert.equal(ehViolacaoDeChave(fk), true);
  const unico = capturar(() => db.prepare("INSERT INTO mesas (numero, numero_norm, capacidade) VALUES ('1', '1', 2)").run());
  assert.ok(unico);
  assert.equal(ehViolacaoDeChave(unico), false);
  assert.equal(ehViolacaoDeChave(new Error('qualquer')), false);
  assert.equal(ehViolacaoDeChave(new Error('FOREIGN KEY constraint failed')), true);
  assert.equal(ehViolacaoDeChave(undefined), false);
  db.close();
});
