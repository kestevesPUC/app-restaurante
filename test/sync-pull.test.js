'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const SqlitePostgresSync = require('../src/infrastructure/sync/SqlitePostgresSync');

const PULL = ['clientes', 'pedidos', 'pedido_itens'];

function banco() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT);
    CREATE TABLE pedidos (id INTEGER PRIMARY KEY, senha INTEGER, status TEXT, cliente_id INTEGER REFERENCES clientes(id));
    CREATE UNIQUE INDEX ux_senha ON pedidos(senha) WHERE senha IS NOT NULL;
    CREATE TABLE pedido_itens (id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos(id), nome TEXT);
    CREATE TABLE pratos (id INTEGER PRIMARY KEY, nome TEXT);`);
  return db;
}

/** Nuvem falsa: guarda linhas por tabela. `comoTexto` imita o driver do Postgres, que devolve bigint como texto. */
function nuvem({ comoTexto = false } = {}) {
  const dados = {};
  const tabela = (n) => (dados[n] = dados[n] || new Map());
  const chaveDe = (t, l) => JSON.stringify(t.pk.map((k) => Number(l[k])));
  return {
    dados,
    async preparar() {},
    async ler(t) {
      return [...tabela(t.nome).values()].map((l) => (comoTexto ? Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])) : { ...l }));
    },
    async aplicar(t, linhas, removidas) {
      for (const l of linhas) tabela(t.nome).set(chaveDe(t, l), Object.fromEntries(t.colunas.map((c) => [c.nome, l[c.nome]])));
      for (const k of removidas) tabela(t.nome).delete(JSON.stringify(k));
    },
    semear(nome, linha, pk = ['id']) { tabela(nome).set(JSON.stringify(pk.map((k) => linha[k])), linha); },
  };
}
const ids = (db, t) => db.prepare(`SELECT id FROM ${t} ORDER BY id`).all().map((r) => r.id);
const novoSync = (db, destino, extra = {}) => new SqlitePostgresSync({ sqlite: db, destino, puxar: PULL, ...extra });

test('traz da nuvem um pedido que só existe lá (pais antes dos filhos) e não o devolve', async () => {
  const db = banco(); const n = nuvem();
  n.semear('clientes', { id: 1, nome: 'Fulano' });
  n.semear('pedidos', { id: 7, senha: 3, status: 'RECEBIDO', cliente_id: 1 });
  n.semear('pedido_itens', { id: 70, pedido_id: 7, nome: 'Prato' });
  const sync = novoSync(db, n);
  const resumo = await sync.sincronizar();
  assert.deepStrictEqual(ids(db, 'pedidos'), [7]);
  assert.deepStrictEqual(ids(db, 'pedido_itens'), [70]);
  assert.strictEqual(sync.ultimoPull.importados, 3);
  assert.deepStrictEqual(resumo, {}, 'o que acabou de chegar não volta para a nuvem');
  assert.strictEqual(sync.estadoMudou, true);
  assert.deepStrictEqual(sync.falhasPull, []);
  assert.deepStrictEqual(await sync.sincronizar(), {}); // segunda rodada: nada a fazer
  assert.strictEqual(sync.ultimoPull.importados, 0);
});

test('mudança feita na nuvem (ex.: status) chega ao SQLite quando o local não mudou; bigint em texto é aceito', async () => {
  const db = banco(); const n = nuvem({ comoTexto: true });
  db.exec("INSERT INTO clientes VALUES (1,'F'); INSERT INTO pedidos VALUES (1, 1, 'RECEBIDO', 1)");
  const sync = novoSync(db, n);
  await sync.sincronizar(); // envia o pedido 1
  n.dados.pedidos.get('[1]').status = 'EM_PREPARO'; // outro aparelho mudou
  assert.deepStrictEqual(await sync.sincronizar(), {});
  assert.strictEqual(db.prepare('SELECT status FROM pedidos WHERE id = 1').get().status, 'EM_PREPARO');
  assert.strictEqual(sync.ultimoPull.importados, 1);
});

test('conflito (mudou dos dois lados): o SQLite local vence e a nuvem recebe a versão local', async () => {
  const db = banco(); const n = nuvem();
  db.exec("INSERT INTO pedidos VALUES (1, 1, 'RECEBIDO', NULL)");
  const sync = novoSync(db, n);
  await sync.sincronizar();
  n.dados.pedidos.get('[1]').status = 'PRONTO';
  db.exec("UPDATE pedidos SET status = 'EM_PREPARO' WHERE id = 1");
  const resumo = await sync.sincronizar();
  assert.strictEqual(sync.ultimoPull.conflitos, 1);
  assert.strictEqual(db.prepare('SELECT status FROM pedidos WHERE id = 1').get().status, 'EM_PREPARO');
  assert.strictEqual(n.dados.pedidos.get('[1]').status, 'EM_PREPARO');
  assert.deepStrictEqual(resumo, { pedidos: { enviados: 1, removidos: 0 } });
});

test('senha duplicada no dia: a linha não é importada, é reportada e o resto entra', async () => {
  const db = banco(); const n = nuvem();
  db.exec("INSERT INTO pedidos VALUES (6, 2, 'RECEBIDO', NULL)");
  n.semear('pedidos', { id: 7, senha: 2, status: 'RECEBIDO', cliente_id: null }); // mesma senha
  n.semear('pedidos', { id: 8, senha: 9, status: 'RECEBIDO', cliente_id: null });
  const sync = novoSync(db, n);
  await sync.sincronizar();
  assert.deepStrictEqual(ids(db, 'pedidos'), [6, 8]);
  assert.strictEqual(sync.ultimoPull.importados, 1);
  assert.strictEqual(sync.falhasPull.length, 1);
  assert.match(sync.falhasPull[0], /pedidos \[7\].*UNIQUE/);
  await sync.sincronizar(); // tenta de novo sem quebrar
  assert.strictEqual(sync.falhasPull.length, 1);
});

test('referência inexistente (cliente ausente): a linha e os filhos dela não entram; o banco local continua íntegro', async () => {
  const db = banco(); const n = nuvem();
  n.semear('pedidos', { id: 5, senha: 1, status: 'RECEBIDO', cliente_id: 99 }); // cliente 99 não existe aqui
  n.semear('pedido_itens', { id: 50, pedido_id: 5, nome: 'X' });
  n.semear('pedidos', { id: 6, senha: 2, status: 'RECEBIDO', cliente_id: null });
  const sync = novoSync(db, n);
  await sync.sincronizar();
  assert.deepStrictEqual(ids(db, 'pedidos'), [6]);
  assert.deepStrictEqual(ids(db, 'pedido_itens'), []);
  assert.deepStrictEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(sync.falhasPull.length >= 1);
  assert.match(sync.falhasPull.join(' '), /inexistente/);
});

test('linha apagada na nuvem é recriada lá (o SQLite local é a referência)', async () => {
  const db = banco(); const n = nuvem();
  db.exec("INSERT INTO pedidos VALUES (1, 1, 'RECEBIDO', NULL)");
  const sync = novoSync(db, n);
  await sync.sincronizar();
  n.dados.pedidos.delete('[1]');
  const resumo = await sync.sincronizar();
  assert.ok(n.dados.pedidos.has('[1]'));
  assert.deepStrictEqual(resumo, { pedidos: { enviados: 1, removidos: 0 } });
  assert.deepStrictEqual(ids(db, 'pedidos'), [1]);
});

test('tabelas fora da lista de importação nunca são alteradas pela nuvem', async () => {
  const db = banco(); const n = nuvem();
  n.semear('pratos', { id: 1, nome: 'Vindo da nuvem' });
  await novoSync(db, n).sincronizar();
  assert.deepStrictEqual(ids(db, 'pratos'), []);
});

test('com ajuste: pedido da nuvem com senha repetida ganha a próxima senha livre e a correção volta para a nuvem', async () => {
  const db = banco(); const n = nuvem();
  db.exec("INSERT INTO pedidos VALUES (6, 2, 'RECEBIDO', NULL)");
  n.semear('pedidos', { id: 7, senha: 2, status: 'RECEBIDO', cliente_id: null });
  n.semear('pedidos', { id: 8, senha: 2, status: 'RECEBIDO', cliente_id: null });
  const ajustarImportacao = (t, linha, erro) => {
    if (t.nome !== 'pedidos' || !/UNIQUE/.test(erro.message)) return null;
    const { m } = db.prepare('SELECT COALESCE(MAX(senha), 0) + 1 AS m FROM pedidos').get();
    return { linha: { ...linha, senha: m }, aviso: `Pedido ${linha.id} recebeu a senha ${m}` };
  };
  const sync = novoSync(db, n, { ajustarImportacao });
  const resumo = await sync.sincronizar();
  assert.deepStrictEqual(db.prepare('SELECT id, senha FROM pedidos ORDER BY id').all().map((r) => [r.id, r.senha]), [[6, 2], [7, 3], [8, 4]]);
  assert.strictEqual(sync.ultimoPull.importados, 2);
  assert.deepStrictEqual(sync.falhasPull, []);
  assert.deepStrictEqual(sync.avisosPull, ['Pedido 7 recebeu a senha 3', 'Pedido 8 recebeu a senha 4']);
  // a versão corrigida é enviada de volta na mesma rodada
  assert.strictEqual(n.dados.pedidos.get('[7]').senha, 3);
  assert.strictEqual(n.dados.pedidos.get('[8]').senha, 4);
  assert.deepStrictEqual(resumo.pedidos, { enviados: 3, removidos: 0 });
  // estável: nada mais a fazer
  assert.deepStrictEqual(await sync.sincronizar(), {});
  assert.strictEqual(sync.ultimoPull.importados, 0);
});
