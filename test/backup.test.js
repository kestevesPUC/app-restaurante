'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const SqliteDatabase = require('../src/infrastructure/database/SqliteDatabase');
const DailyBackup = require('../src/infrastructure/backup/DailyBackup');

const dia = (ano, mes, d) => new Date(ano, mes - 1, d, 10, 0, 0).getTime();

function ambiente() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-backup-'));
  const db = new SqliteDatabase(':memory:');
  return { pasta, db, limpar() { db.close(); fs.rmSync(pasta, { recursive: true, force: true }); } };
}

test('grava pdv-AAAA-MM-DD.sqlite uma única vez por dia', () => {
  const { pasta, db, limpar } = ambiente();
  try {
    const backup = new DailyBackup({ db, pasta, relogio: () => dia(2026, 10, 23) });
    const arquivo = backup.run();
    assert.equal(arquivo, path.join(pasta, 'pdv-2026-10-23.sqlite'));
    assert.ok(fs.existsSync(arquivo));
    assert.equal(backup.run(), null);
    assert.deepEqual(fs.readdirSync(pasta), ['pdv-2026-10-23.sqlite']);
  } finally { limpar(); }
});

test('mantém só os 14 mais recentes e nunca apaga arquivos estranhos', () => {
  const { pasta, db, limpar } = ambiente();
  try {
    fs.writeFileSync(path.join(pasta, 'anotacoes.txt'), 'meu');
    fs.writeFileSync(path.join(pasta, 'pdv-2020-01-01.sqlite.bak'), 'meu');
    for (let d = 1; d <= 20; d += 1) {
      new DailyBackup({ db, pasta, relogio: () => dia(2026, 9, d) }).run();
    }
    const backups = fs.readdirSync(pasta).filter((n) => /^pdv-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort();
    assert.equal(backups.length, 14);
    assert.equal(backups[0], 'pdv-2026-09-07.sqlite');
    assert.equal(backups[13], 'pdv-2026-09-20.sqlite');
    assert.ok(fs.existsSync(path.join(pasta, 'anotacoes.txt')));
    assert.ok(fs.existsSync(path.join(pasta, 'pdv-2020-01-01.sqlite.bak')));
  } finally { limpar(); }
});

test('o backup abre como SQLite válido', () => {
  const { pasta, db, limpar } = ambiente();
  try {
    db.prepare("INSERT INTO usuarios (usuario, nome, nivel, senha_hash, criado_em) VALUES ('ana', 'Ana', 'A', 'x', '2026-10-23T00:00:00.000Z')").run();
    const arquivo = new DailyBackup({ db, pasta, relogio: () => dia(2026, 10, 23) }).run();
    const copia = new DatabaseSync(arquivo, { readOnly: true });
    assert.equal(copia.prepare('SELECT usuario FROM usuarios').get().usuario, 'ana');
    copia.close();
  } finally { limpar(); }
});

test('falha no meio do backup não deixa arquivo contando como backup de hoje; a execução seguinte cria', () => {
  const { pasta, db, limpar } = ambiente();
  try {
    const relogio = () => dia(2026, 10, 23);
    fs.writeFileSync(path.join(pasta, 'pdv-2026-10-23.sqlite.tmp'), 'lixo de queda antiga');
    const quebrado = { backupTo(destino) { fs.writeFileSync(destino, 'parcial'); throw new Error('disco cheio'); } };
    assert.throws(() => new DailyBackup({ db: quebrado, pasta, relogio }).run(), /disco cheio/);
    assert.deepEqual(fs.readdirSync(pasta), []);
    const arquivo = new DailyBackup({ db, pasta, relogio }).run();
    assert.equal(arquivo, path.join(pasta, 'pdv-2026-10-23.sqlite'));
    assert.deepEqual(fs.readdirSync(pasta), ['pdv-2026-10-23.sqlite']);
  } finally { limpar(); }
});

test('tmp velho de queda é sobrescrito e não sobra após o backup', () => {
  const { pasta, db, limpar } = ambiente();
  try {
    fs.writeFileSync(path.join(pasta, 'pdv-2026-10-23.sqlite.tmp'), 'lixo');
    const arquivo = new DailyBackup({ db, pasta, relogio: () => dia(2026, 10, 23) }).run();
    assert.ok(arquivo);
    assert.deepEqual(fs.readdirSync(pasta), ['pdv-2026-10-23.sqlite']);
  } finally { limpar(); }
});
