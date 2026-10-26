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

test('aplica as migrações e grava user_version = 5', () => {
  const db = new SqliteDatabase(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of ['usuarios', 'configuracoes', 'auditoria', 'categorias', 'ingredientes', 'pratos', 'prato_ingredientes', 'mesas', 'fila_espera', 'mensagens_whatsapp', 'pedidos', 'clientes', 'bebidas', 'movimentacoes_estoque', 'pedido_status_historico', 'notificacoes_whatsapp']) assert.ok(tabelas.includes(t), t);
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

const AGORA = '2026-10-26T12:00:00.000Z';

test('clientes: telefone único; bebidas: nome_norm único, preço > 0, estoque >= 0', () => {
  const db = new SqliteDatabase(':memory:');
  const cliente = (tel) => db.prepare('INSERT INTO clientes (nome, telefone, criado_em, atualizado_em) VALUES (?, ?, ?, ?)').run('Ana', tel, AGORA, AGORA);
  cliente('+5511999998888');
  assert.throws(() => cliente('+5511999998888'), /UNIQUE constraint failed/);
  const bebida = (nome, norm, preco, qtd, min) => db.prepare('INSERT INTO bebidas (nome, nome_norm, preco_cents, estoque_qtd, estoque_minimo, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(nome, norm, preco, qtd, min, AGORA);
  bebida('Guaraná', 'guarana', 600, 10, 2);
  assert.throws(() => bebida('Outra', 'guarana', 600, 1, 0), /UNIQUE constraint failed/);
  assert.throws(() => bebida('Zero', 'zero', 0, 1, 0), /CHECK constraint failed/);
  assert.throws(() => bebida('Neg', 'neg', 100, -1, 0), /CHECK constraint failed/);
  assert.throws(() => bebida('Min', 'min', 100, 1, -1), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT ativo FROM bebidas').get().ativo, 1);
  db.close();
});

test('movimentacoes_estoque.tipo e notificacoes_whatsapp.situacao/tipo rejeitam valores fora da lista', () => {
  const db = new SqliteDatabase(':memory:');
  db.prepare('INSERT INTO bebidas (nome, nome_norm, preco_cents, criado_em) VALUES (?, ?, ?, ?)').run('Suco', 'suco', 500, AGORA);
  const mov = (tipo) => db.prepare('INSERT INTO movimentacoes_estoque (bebida_id, tipo, quantidade, saldo_apos, em) VALUES (1, ?, 5, 5, ?)').run(tipo, AGORA);
  for (const t of ['ENTRADA', 'SAIDA', 'AJUSTE', 'VENDA', 'ESTORNO']) mov(t);
  assert.throws(() => mov('OUTRO'), /CHECK constraint failed/);

  novoUsuario(db, 'adm');
  db.prepare("INSERT INTO pedidos (id, data_local, numero_dia, tipo, cliente_nome, criado_por, criado_em) VALUES (1, '2026-10-26', 1, 'BALCAO', 'Ana', 1, ?)").run(AGORA);
  const notif = (tipo, situacao) => db.prepare('INSERT INTO notificacoes_whatsapp (pedido_id, tipo, telefone, texto, situacao, em) VALUES (1, ?, ?, ?, ?, ?)').run(tipo, '+5511999998888', 'oi', situacao, AGORA);
  notif('RETIRADA', 'ENVIADA');
  notif('ENTREGA', 'FALHOU');
  assert.throws(() => notif('OUTRO', 'ENVIADA'), /CHECK constraint failed/);
  assert.throws(() => notif('RETIRADA', 'PENDENTE'), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT automatica FROM notificacoes_whatsapp').get().automatica, 0);
  db.close();
});

test('pedido_status_historico exige pedido existente e permite UPDATE/DELETE (sem gatilhos)', () => {
  const db = new SqliteDatabase(':memory:');
  novoUsuario(db, 'adm');
  db.prepare("INSERT INTO pedidos (id, data_local, numero_dia, tipo, cliente_nome, criado_por, criado_em) VALUES (1, '2026-10-26', 1, 'BALCAO', 'Ana', 1, ?)").run(AGORA);
  const hist = (pedido) => db.prepare("INSERT INTO pedido_status_historico (pedido_id, status_anterior, status_novo, usuario_id, usuario, em) VALUES (?, 'ABERTO', 'RECEBIDO', 1, 'adm', ?)").run(pedido, AGORA);
  hist(1);
  assert.throws(() => hist(99), /FOREIGN KEY constraint failed/);
  db.prepare("UPDATE pedido_status_historico SET status_novo = 'EM_PREPARO'").run();
  db.prepare('DELETE FROM pedido_status_historico').run();
  db.close();
});

test('ingredientes exigem unidade_medida válida; pratos exigem tempo_preparo_min > 0', () => {
  const db = new SqliteDatabase(':memory:');
  const ing = (unidade) => db.prepare('INSERT INTO ingredientes (nome, nome_norm, unidade_medida) VALUES (?, ?, ?)').run('Pão', 'pao', unidade);
  assert.throws(() => ing('XX'), /CHECK constraint failed/);
  assert.throws(() => ing(null), /NOT NULL constraint failed/);
  ing('UN');
  db.prepare("INSERT INTO categorias (nome, nome_norm) VALUES ('L', 'l')").run();
  const prato = (tempo) => db.prepare('INSERT INTO pratos (categoria_id, nome, nome_norm, preco_cents, tempo_preparo_min) VALUES (1, ?, ?, 100, ?)').run('P', 'p', tempo);
  assert.throws(() => prato(0), /CHECK constraint failed/);
  assert.throws(() => prato(null), /NOT NULL constraint failed/);
  prato(5);
  db.close();
});
