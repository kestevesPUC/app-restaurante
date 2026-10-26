'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { executarBackupSeguro } = require('../src/desktop/executarBackupSeguro');
const { protegerNavegacao } = require('../src/desktop/protegerNavegacao');

const mudo = { error() {} };

test('falha do backup não propaga e dispara o aviso', () => {
  let aviso = null;
  const r = executarBackupSeguro({ run() { throw new Error('somente leitura'); } }, { logger: mudo, aoFalhar: (e) => { aviso = e.message; } });
  assert.equal(r, null);
  assert.equal(aviso, 'somente leitura');
});

test('falha no próprio aviso também não propaga; sucesso devolve o caminho', () => {
  assert.equal(executarBackupSeguro({ run() { throw new Error('x'); } }, { logger: mudo, aoFalhar() { throw new Error('y'); } }), null);
  assert.equal(executarBackupSeguro({ run: () => '/a.sqlite' }, { logger: mudo }), '/a.sqlite');
});

function contexto() {
  const wc = new EventEmitter();
  wc.setWindowOpenHandler = (h) => { wc.openHandler = h; };
  const externos = [];
  protegerNavegacao(wc, 'http://127.0.0.1:5000', (u) => externos.push(u));
  return { wc, externos };
}
const evento = (url) => { const e = { url, bloqueado: false, preventDefault() { e.bloqueado = true; } }; return e; };

for (const nome of ['will-navigate', 'will-redirect']) {
  test(`${nome}: bloqueia fora da origem, abre http externo e permite a origem`, () => {
    const { wc, externos } = contexto();
    const fora = evento('https://exemplo.com/x'); wc.emit(nome, fora, fora.url);
    assert.equal(fora.bloqueado, true);
    assert.deepEqual(externos, ['https://exemplo.com/x']);
    const prefixo = evento('http://127.0.0.1:50001/'); wc.emit(nome, prefixo, prefixo.url);
    assert.equal(prefixo.bloqueado, true);
    const dentro = evento('http://127.0.0.1:5000/api'); wc.emit(nome, dentro, dentro.url);
    assert.equal(dentro.bloqueado, false);
  });
}

test('will-frame-navigate usa a mesma regra; esquema não-http é bloqueado sem abrir', () => {
  const { wc, externos } = contexto();
  const f = evento('https://evil.com'); wc.emit('will-frame-navigate', f);
  assert.equal(f.bloqueado, true);
  const file = evento('file:///c:/x'); wc.emit('will-frame-navigate', file);
  assert.equal(file.bloqueado, true);
  assert.deepEqual(externos, ['https://evil.com']);
  const ok = evento('http://127.0.0.1:5000/'); wc.emit('will-frame-navigate', ok);
  assert.equal(ok.bloqueado, false);
});

test('window.open externo abre no navegador e é negado', () => {
  const { wc, externos } = contexto();
  assert.deepEqual(wc.openHandler({ url: 'https://a.com' }), { action: 'deny' });
  assert.deepEqual(externos, ['https://a.com']);
});
