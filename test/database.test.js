'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SqliteDatabase = require('../src/infrastructure/database/SqliteDatabase');

const novoUsuario = (db, usuario, nivel = 'A') =>
  db.prepare(
    "INSERT INTO usuarios (usuario, nome, nivel, senha_hash, criado_em) VALUES (?, 'Nome', ?, 'x', '2026-10-23T00:00:00.000Z')"
  ).run(usuario, nivel);

test('aplica as migrações e grava user_version = 3', () => {
  const db = new SqliteDatabase(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of ['usuarios', 'configuracoes', 'auditoria', 'categorias', 'ingredientes', 'pratos', 'prato_ingredientes', 'mesas', 'fila_espera', 'mensagens_whatsapp']) assert.ok(tabelas.includes(t), t);
  db.close();
});

test('usuarios.nivel rejeita valor fora de A, B, C', () => {
  const db = new SqliteDatabase(':memory:');
  assert.throws(() => novoUsuario(db, 'joao', 'D'), /CHECK constraint failed/);
  novoUsuario(db, 'joao', 'C');
  db.close();
});

test('usuario é único sem diferenciar maiúsculas', () => {
  const db = new SqliteDatabase(':memory:');
  novoUsuario(db, 'Maria');
  assert.throws(() => novoUsuario(db, 'MARIA'), /UNIQUE constraint failed/);
  db.close();
});

test('auditoria rejeita UPDATE e DELETE com a mensagem "auditoria é imutável"', () => {
  const db = new SqliteDatabase(':memory:');
  db.prepare("INSERT INTO auditoria (em, acao, entidade, descricao) VALUES ('2026-10-23T00:00:00.000Z', 'LOGIN', 'usuario', 'x')").run();
  assert.throws(() => db.prepare("UPDATE auditoria SET descricao = 'y'").run(), /auditoria é imutável/);
  assert.throws(() => db.prepare('DELETE FROM auditoria').run(), /auditoria é imutável/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auditoria').get().n, 1);
  db.close();
});

test('em arquivo temporário, journal_mode é wal e foreign_keys é 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-'));
  const db = new SqliteDatabase(path.join(dir, 'pdv.sqlite'));
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
