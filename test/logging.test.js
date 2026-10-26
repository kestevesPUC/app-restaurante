'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JsonLineLogger = require('../src/infrastructure/logging/JsonLineLogger');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-log-'));
const ler = (dir, nome) => fs.readFileSync(path.join(dir, nome), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const T0 = new Date(2026, 9, 26, 10, 0, 0).getTime(); // data local
const DIA = 24 * 60 * 60 * 1000;

test('grava uma linha JSON válida com ts ISO, nivel e msg em pdv-AAAA-MM-DD.log', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  log.info('olá', { pedido: 7 });
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(l.ts, new Date(T0).toISOString());
  assert.equal(l.nivel, 'info');
  assert.equal(l.msg, 'olá');
  assert.equal(l.pedido, 7);
});

test('cria a pasta se faltar', () => {
  const dir = path.join(pasta(), 'a', 'b');
  new JsonLineLogger({ pasta: dir, relogio: () => T0 }).warn('x');
  assert.ok(fs.existsSync(path.join(dir, 'pdv-2026-10-26.log')));
});

test('Error vira msg e erro{nome,mensagem,stack} apenas no arquivo; error(msg, ctx) também funciona', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  log.error(new TypeError('falhou'));
  log.error('texto', { idRequisicao: 'abcd1234' });
  const [a, b] = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(a.msg, 'falhou');
  assert.equal(a.erro.nome, 'TypeError');
  assert.equal(a.erro.mensagem, 'falhou');
  assert.match(a.erro.stack, /TypeError/);
  assert.equal(b.msg, 'texto');
  assert.equal(b.idRequisicao, 'abcd1234');
});

test('mascara segredos aninhados sem mutar o original; telefone não é segredo', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  const ctx = { usuario: 'ana', senha: 'x', telefone: '+5511999990000', a: { token: 't', b: [{ cookie: 'c', Authorization: 'z', sid: 's', hash: 'h', senhaHash: 'q', senha_hash: 'q' }] } };
  log.info('m', ctx);
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(l.senha, '***');
  assert.equal(l.a.token, '***');
  assert.deepEqual(l.a.b[0], { cookie: '***', Authorization: '***', sid: '***', hash: '***', senhaHash: '***', senha_hash: '***' });
  assert.equal(l.telefone, '+5511999990000');
  assert.equal(ctx.senha, 'x');
  assert.equal(ctx.a.b[0].cookie, 'c');
});

test('objeto circular e BigInt não derrubam o logger', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  const c = { nome: 'c' };
  c.self = c;
  log.info('circ', { c, n: 10n });
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(l.c.self, '[Circular]');
  assert.equal(l.n, '10');
  assert.equal(log.falhasDeEscrita(), 0);
});

test('nível mínimo descarta registros abaixo', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0, nivelMinimo: 'warn' });
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  assert.deepEqual(ler(dir, 'pdv-2026-10-26.log').map((l) => l.nivel), ['warn', 'error']);
});

test('vira o arquivo por dia e mantém só os 14 mais recentes sem apagar arquivos estranhos', () => {
  const dir = pasta();
  for (let i = 1; i <= 20; i += 1) fs.writeFileSync(path.join(dir, `pdv-2026-09-${String(i).padStart(2, '0')}.log`), '{}\n');
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'pdv-2026-09-01.log.bak'), 'x');
  fs.writeFileSync(path.join(dir, 'pdv-abc.log'), 'x');
  let agora = T0;
  const log = new JsonLineLogger({ pasta: dir, relogio: () => agora });
  log.info('dia1');
  agora += DIA;
  log.info('dia2');
  const logs = fs.readdirSync(dir).filter((n) => /^pdv-\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort();
  assert.equal(logs.length, 14);
  assert.equal(logs.at(-1), 'pdv-2026-10-27.log');
  assert.ok(logs.includes('pdv-2026-10-26.log'));
  for (const n of ['notas.txt', 'pdv-2026-09-01.log.bak', 'pdv-abc.log']) assert.ok(fs.existsSync(path.join(dir, n)), n);
});

test('falha de escrita é engolida, contada e avisa uma única vez no console', () => {
  const dir = pasta();
  const arquivo = path.join(dir, 'arquivo');
  fs.writeFileSync(arquivo, 'x'); // arquivo no lugar da pasta
  const avisos = [];
  const original = console.error;
  console.error = (...a) => avisos.push(a);
  try {
    const log = new JsonLineLogger({ pasta: path.join(arquivo, 'logs'), relogio: () => T0 });
    log.info('a'); log.error('b'); log.warn('c');
    assert.equal(log.falhasDeEscrita(), 3);
  } finally { console.error = original; }
  assert.equal(avisos.length, 1);
});

test('fechar() resolve', async () => {
  const log = new JsonLineLogger({ pasta: pasta(), relogio: () => T0 });
  await log.fechar();
});

test('payload enorme: linha válida, limites aplicados e <= 64 KB', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  let fundo = { fim: 1 };
  for (let i = 0; i < 10; i += 1) fundo = { f: fundo };
  const chaves = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
  log.info('x'.repeat(10000), { grande: 'y'.repeat(100000), lista: Array.from({ length: 500 }, (_, i) => i), fundo, chaves });
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.ok(l.msg.endsWith('…[truncado]') && l.msg.length < 4200);
  assert.ok(l.grande.endsWith('…[truncado]'));
  assert.equal(l.lista.length, 51);
  assert.equal(l.lista.at(-1), '…+450');
  assert.ok(JSON.stringify(l.fundo).includes('[profundo]'));
  assert.equal(Object.keys(l.chaves).length, 101);
  const arquivo = fs.readFileSync(path.join(dir, 'pdv-2026-10-26.log'));
  assert.ok(arquivo.length <= 64 * 1024 + 1);
});

test('linha acima de 64 KB é reduzida a { truncado: true } mantendo ts/nivel/msg', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  const ctx = {};
  for (let i = 0; i < 100; i += 1) ctx[`c${i}`] = Array.from({ length: 50 }, () => 'z'.repeat(4000));
  log.warn('grande', ctx);
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.deepEqual(l, { ts: new Date(T0).toISOString(), nivel: 'warn', msg: 'grande', truncado: true });
});

test('getter que lança, Proxy que lança, msg e contexto exóticos: grava normalmente com 0 falhas', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  const ruim = { ok: 1, get quebra() { throw new Error('boom'); } };
  const proxy = new Proxy({}, { ownKeys() { throw new Error('ownKeys'); } });
  log.info('a', ruim);
  log.info('b', { aninhado: { get x() { throw new Error('x'); } }, proxy });
  log.info('c', proxy);
  log.info(42);
  log.info({ a: 1 });
  log.info(undefined);
  log.info('d', undefined);
  log.info('e', [1, 2]);
  const ls = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(ls.length, 8);
  assert.equal(ls[0].quebra, '[erro ao ler]');
  assert.equal(ls[0].ok, 1);
  assert.equal(ls[1].aninhado.x, '[erro ao ler]');
  assert.equal(ls[1].proxy, '[erro ao ler]');
  assert.equal(ls[3].msg, '42');
  assert.equal(typeof ls[4].msg, 'string');
  assert.equal(ls[5].msg, 'undefined');
  assert.deepEqual(ls[7].detalhe, [1, 2]);
  assert.equal(log.falhasDeEscrita(), 0);
});

test('chaves ts/nivel/msg do contexto não sobrescrevem os campos reais', () => {
  const dir = pasta();
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0 });
  log.error('real', { ts: 'falso', nivel: 'debug', msg: 'falsa' });
  const [l] = ler(dir, 'pdv-2026-10-26.log');
  assert.equal(l.ts, new Date(T0).toISOString());
  assert.equal(l.nivel, 'error');
  assert.equal(l.msg, 'real');
});

test('falha ao podar arquivo antigo não conta como falha de escrita e a linha é gravada', () => {
  const dir = pasta();
  fs.mkdirSync(path.join(dir, 'pdv-2020-01-01.log')); // diretório com nome de log: unlinkSync falha
  const log = new JsonLineLogger({ pasta: dir, relogio: () => T0, manter: 1 });
  log.info('segue');
  assert.equal(log.falhasDeEscrita(), 0);
  assert.equal(ler(dir, 'pdv-2026-10-26.log')[0].msg, 'segue');
});

test('contexto aninhado enorme respeita o orçamento de nós e continua sendo uma linha válida', () => {
  const dir = pasta();
  const logger = new JsonLineLogger({ pasta: dir });
  let n = 'x'.repeat(4000); // referências compartilhadas: a árvore lógica é gigante, a memória do teste não
  for (let i = 0; i < 4; i += 1) {
    const filho = n;
    n = Object.fromEntries(Array.from({ length: 100 }, (_, k) => [`k${k}`, Array.from({ length: 50 }, () => filho)]));
  }
  const inicio = Date.now();
  logger.info('grande', { raiz: n });
  assert.ok(Date.now() - inicio < 2000);
  const [arquivo] = fs.readdirSync(dir);
  const linhas = ler(dir, arquivo);
  assert.equal(linhas[0].msg, 'grande');
});
