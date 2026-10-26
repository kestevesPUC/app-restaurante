'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, SENHAS } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

async function abrirEventos(user) {
  const controller = new AbortController();
  const cookie = (await app.request('POST', '/api/login', { body: { usuario: user, senha: SENHAS[user] } })).cookie;
  const res = await fetch(`${app.baseUrl}/api/eventos`, { headers: { cookie }, signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const ler = async (n) => {
    const out = [];
    while (out.length < n) {
      const fim = buffer.indexOf('\n\n');
      if (fim >= 0) {
        const bloco = buffer.slice(0, fim);
        buffer = buffer.slice(fim + 2);
        const tipo = /^event: (.*)$/m.exec(bloco)?.[1];
        if (tipo) out.push({ tipo, dados: JSON.parse(/^data: (.*)$/m.exec(bloco)[1]) });
        continue;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    return out;
  };
  return { ler, fechar: () => controller.abort() };
}

const esperar = async (cond) => { while (!cond()) await new Promise((r) => setTimeout(r, 5)); };

test('rotas /api/whatsapp só para o nível A (B e C → 403, sem sessão → 401)', async () => {
  const rotas = [['GET', '/api/whatsapp/estado'], ['POST', '/api/whatsapp/conectar'], ['POST', '/api/whatsapp/desconectar'], ['POST', '/api/whatsapp/teste', { telefone: '(11) 99999-8888' }]];
  for (const [m, p, body] of rotas) {
    assert.equal((await app.request(m, p, { user: 'ATEND', body })).status, 403, `${m} ${p} B`);
    assert.equal((await app.request(m, p, { user: 'COZ', body })).status, 403, `${m} ${p} C`);
    assert.equal((await app.request(m, p, { body })).status, 401, `${m} ${p} anônimo`);
  }
});

test('GET estado devolve estado, qr, números da conexão e da empresa', async () => {
  const r = await app.request('GET', '/api/whatsapp/estado', { user: 'ADM' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { estado: 'CONECTADO', qr: null, numeroConectado: null, numeroEmpresa: '' });
});

test('teste: telefone inválido → 400; envia normalizado, com texto informado ou padrão', async () => {
  for (const body of [{ telefone: 'abc' }, {}, { telefone: '(11) 99999-8888', texto: 5 }]) {
    assert.equal((await app.request('POST', '/api/whatsapp/teste', { user: 'ADM', body })).status, 400);
  }
  const ok = await app.request('POST', '/api/whatsapp/teste', { user: 'ADM', body: { telefone: '(11) 99999-8888', texto: 'oi' } });
  assert.equal(ok.status, 200);
  assert.equal((await app.request('POST', '/api/whatsapp/teste', { user: 'ADM', body: { telefone: '11999998888' } })).status, 200);
  assert.deepEqual(app.mensageiro.enviadas.map((e) => e.telefoneE164), ['+5511999998888', '+5511999998888']);
  assert.equal(app.mensageiro.enviadas[0].texto, 'oi');
  assert.match(app.mensageiro.enviadas[1].texto, /teste/i);
});

test('teste com mensageiro desconectado → 502 em português', async () => {
  app.mensageiro.definirEstado('DESCONECTADO');
  const r = await app.request('POST', '/api/whatsapp/teste', { user: 'ADM', body: { telefone: '(11) 99999-8888' } });
  assert.equal(r.status, 502);
  assert.match(JSON.stringify(r.body), /O WhatsApp não está conectado/);
});

test('conectar e desconectar com o mensageiro simulado respondem 200', async () => {
  assert.equal((await app.request('POST', '/api/whatsapp/conectar', { user: 'ADM' })).status, 200);
  assert.equal((await app.request('POST', '/api/whatsapp/desconectar', { user: 'ADM' })).status, 200);
});

test('SSE: C recebe só pedido; B recebe whatsapp sem qr; A recebe o qr', async () => {
  const c = await abrirEventos('COZ');
  const b = await abrirEventos('ATEND');
  const a = await abrirEventos('ADM');
  await esperar(() => app.bus.size === 3);
  app.bus.publish('whatsapp', { estado: 'AGUARDANDO_QR', qr: 'QR-1' });
  app.bus.publish('estoque', { bebidaId: 1 });
  app.bus.publish('notificacao', { id: 1 });
  app.bus.publish('pedido', { id: 9, status: 'EM_PREPARO' });
  assert.deepEqual(await c.ler(1), [{ tipo: 'pedido', dados: { id: 9, status: 'EM_PREPARO' } }]);
  assert.deepEqual((await b.ler(4)).map((e) => [e.tipo, e.dados]), [
    ['whatsapp', { estado: 'AGUARDANDO_QR' }], ['estoque', { bebidaId: 1 }], ['notificacao', { id: 1 }], ['pedido', { id: 9, status: 'EM_PREPARO' }],
  ]);
  assert.deepEqual((await a.ler(1)), [{ tipo: 'whatsapp', dados: { estado: 'AGUARDANDO_QR', qr: 'QR-1' } }]);
  c.fechar(); b.fechar(); a.fechar();
});
