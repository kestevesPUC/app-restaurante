'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const SqlitePostgresSync = require('../src/infrastructure/sync/SqlitePostgresSync');

// Postgres falso: registra os comandos e mantém as linhas por tabela/chave.
function pgFalso() {
  const comandos = [];
  return {
    comandos,
    async query(sql, params = []) { comandos.push({ sql, params }); return { rows: [] }; },
    dml: () => comandos.filter((c) => /^(INSERT|DELETE)/.test(c.sql)),
  };
}

function banco() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente TEXT, total_cents INTEGER);
           CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nome TEXT, senha_hash TEXT);`);
  return db;
}

test('primeira rodada cria tabelas e envia tudo, sem senha_hash', async () => {
  const db = banco();
  db.exec("INSERT INTO pedidos VALUES (1,'Ana',1000),(2,'Bia',2000); INSERT INTO usuarios VALUES (1,'Admin','segredo')");
  const pg = pgFalso();
  const resumo = await new SqlitePostgresSync({ sqlite: db, pg }).sincronizar();
  assert.deepStrictEqual(resumo, { pedidos: { enviados: 2, removidos: 0 }, usuarios: { enviados: 1, removidos: 0 } });
  assert.ok(pg.comandos.some((c) => c.sql.startsWith('CREATE TABLE IF NOT EXISTS "pedidos"')));
  assert.ok(!pg.comandos.some((c) => c.sql.includes('senha_hash')));
  assert.ok(!pg.comandos.some((c) => c.params.includes('segredo')));
});

test('rodadas seguintes enviam só o que mudou e apagam o que sumiu', async () => {
  const db = banco();
  db.exec("INSERT INTO pedidos VALUES (1,'Ana',1000),(2,'Bia',2000)");
  const pg = pgFalso();
  const sync = new SqlitePostgresSync({ sqlite: db, pg });
  await sync.sincronizar();

  pg.comandos.length = 0;
  assert.deepStrictEqual(await sync.sincronizar(), {});
  assert.strictEqual(pg.comandos.length, 0);

  db.exec("UPDATE pedidos SET total_cents = 1500 WHERE id = 1; DELETE FROM pedidos WHERE id = 2; INSERT INTO pedidos VALUES (3,'Caio',300)");
  assert.deepStrictEqual(await sync.sincronizar(), { pedidos: { enviados: 2, removidos: 1 } });
  const dml = pg.dml();
  assert.deepStrictEqual(dml.filter((c) => c.sql.startsWith('INSERT')).map((c) => c.params), [[1, 'Ana', 1500], [3, 'Caio', 300]]);
  assert.deepStrictEqual(dml.filter((c) => c.sql.startsWith('DELETE')).map((c) => c.params), [[2]]);
});

test('falha no Postgres desfaz a rodada e reenvia na próxima', async () => {
  const db = banco();
  db.exec("INSERT INTO pedidos VALUES (1,'Ana',1000)");
  const pg = pgFalso();
  const sync = new SqlitePostgresSync({ sqlite: db, pg });
  await sync.prepararDestino();
  const original = pg.query;
  pg.query = async (sql, p) => { if (sql.startsWith('INSERT')) throw new Error('sem rede'); return original(sql, p); };
  await assert.rejects(sync.sincronizar(), /sem rede/);
  assert.ok(pg.comandos.some((c) => c.sql === 'ROLLBACK'));
  pg.query = original;
  assert.deepStrictEqual(await sync.sincronizar(), { pedidos: { enviados: 1, removidos: 0 } });
});

// ---- Destino HTTPS (API REST do Supabase) ----
const { RestDestino } = SqlitePostgresSync;

function fetchFalso(respostas = {}) {
  const chamadas = [];
  const impl = async (url, opts) => {
    chamadas.push({ url, metodo: opts.method, headers: opts.headers, corpo: opts.body ? JSON.parse(opts.body) : undefined });
    const r = respostas[opts.method] || { status: 200, texto: '' };
    return { ok: r.status < 400, status: r.status, text: async () => r.texto };
  };
  return { chamadas, impl };
}
const restSync = (db, f, extra = {}) => new SqlitePostgresSync({
  sqlite: db, destino: new RestDestino({ url: 'https://x.supabase.co/', chave: 'sb_secret_abc', fetchImpl: f.impl, ...extra }),
});

test('REST: confere tabelas, faz upsert em lote e não envia senha_hash', async () => {
  const db = banco();
  db.exec("INSERT INTO pedidos VALUES (1,'Ana',1000),(2,'Bia',2000); INSERT INTO usuarios VALUES (1,'Admin','segredo')");
  const f = fetchFalso();
  const resumo = await restSync(db, f).sincronizar();
  assert.deepStrictEqual(resumo, { pedidos: { enviados: 2, removidos: 0 }, usuarios: { enviados: 1, removidos: 0 } });
  const posts = f.chamadas.filter((c) => c.metodo === 'POST');
  const ped = posts.find((c) => c.url.includes('/pedidos?'));
  assert.strictEqual(ped.url, 'https://x.supabase.co/rest/v1/pedidos?on_conflict=id');
  assert.deepStrictEqual(ped.corpo, [{ id: 1, cliente: 'Ana', total_cents: 1000 }, { id: 2, cliente: 'Bia', total_cents: 2000 }]);
  assert.strictEqual(ped.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.strictEqual(ped.headers.apikey, 'sb_secret_abc');
  assert.ok(!('Authorization' in ped.headers)); // chave nova não vai em Authorization
  assert.ok(!JSON.stringify(f.chamadas).includes('segredo'));
  assert.ok(f.chamadas.some((c) => c.metodo === 'GET' && c.url.includes('limit=0'))); // conferência das tabelas
});

test('REST: chave JWT antiga também vai em Authorization', async () => {
  const f = fetchFalso();
  const d = new RestDestino({ url: 'https://x.supabase.co', chave: 'eyJabc', fetchImpl: f.impl });
  await d.requisitar('GET', 'pedidos');
  assert.strictEqual(f.chamadas[0].headers.Authorization, 'Bearer eyJabc');
});

test('REST: só envia o que mudou, apaga o que sumiu (inclusive chave composta) e divide em lotes', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE liga (a INTEGER, b INTEGER, x TEXT, PRIMARY KEY (a, b))');
  db.exec("INSERT INTO liga VALUES (1,1,'p'),(1,2,'q'),(2,1,'r')");
  const f = fetchFalso();
  const sync = restSync(db, f, { lote: 2 });
  await sync.sincronizar();
  assert.deepStrictEqual(f.chamadas.filter((c) => c.metodo === 'POST').map((c) => c.corpo.length), [2, 1]);

  f.chamadas.length = 0;
  assert.deepStrictEqual(await sync.sincronizar(), {});
  assert.strictEqual(f.chamadas.length, 0);

  db.exec("UPDATE liga SET x='novo' WHERE a=1 AND b=1; DELETE FROM liga WHERE a=2 AND b=1");
  assert.deepStrictEqual(await sync.sincronizar(), { liga: { enviados: 1, removidos: 1 } });
  assert.strictEqual(f.chamadas.find((c) => c.metodo === 'DELETE').url, 'https://x.supabase.co/rest/v1/liga?a=eq.2&b=eq.1');
});

test('REST: erro do Supabase não marca como enviado e é reenviado na próxima rodada', async () => {
  const db = banco();
  db.exec("INSERT INTO pedidos VALUES (1,'Ana',1000)");
  const f = fetchFalso({ POST: { status: 401, texto: 'Invalid API key' } });
  const sync = restSync(db, f);
  await assert.rejects(sync.sincronizar(), /401.*Invalid API key/);
  f.chamadas.length = 0;
  const f2 = fetchFalso();
  sync.destino.fetch = f2.impl;
  assert.deepStrictEqual(await sync.sincronizar(), { pedidos: { enviados: 1, removidos: 0 } });
});

test('REST: tabela inexistente gera mensagem orientando a rodar sync:ddl', async () => {
  const db = banco();
  const f = fetchFalso({ GET: { status: 404, texto: 'relation does not exist' } });
  await assert.rejects(restSync(db, f).sincronizar(), /sync:ddl/);
});
