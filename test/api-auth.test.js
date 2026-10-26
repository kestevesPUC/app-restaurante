'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTestApp, SENHAS } = require('./helpers/createTestApp');

let app;
beforeEach(async () => { app = await createTestApp(); });
afterEach(async () => { await app.close(); });

/** Abre o canal SSE e devolve leitor de eventos já decodificados. */
async function abrirEventos(user) {
  const controller = new AbortController();
  const cookie = (await app.request('POST', '/api/login', { body: { usuario: user, senha: SENHAS[user] } })).cookie;
  const res = await fetch(`${app.baseUrl}/api/eventos`, { headers: { cookie }, signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const lerEvento = async () => {
    for (;;) {
      const fim = buffer.indexOf('\n\n');
      if (fim >= 0) {
        const bloco = buffer.slice(0, fim);
        buffer = buffer.slice(fim + 2);
        const tipo = /^event: (.*)$/m.exec(bloco)?.[1];
        const dados = /^data: (.*)$/m.exec(bloco)?.[1];
        if (tipo) return { tipo, dados: JSON.parse(dados) };
        continue; // comentário/heartbeat
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { res, lerEvento, fechar: () => controller.abort() };
}

const esperar = async (condicao) => {
  for (let i = 0; i < 100 && !condicao(); i += 1) await new Promise((r) => setTimeout(r, 10));
};

test('POST /api/login correto define cookie sid HttpOnly e SameSite=Strict', async () => {
  const res = await app.login('ADM', SENHAS.ADM);
  assert.equal(res.status, 200);
  assert.equal(res.body.usuario, 'ADM');
  assert.equal('senhaHash' in res.body, false);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^sid=[0-9a-f]+;/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
});

test('cookie sid dura 12 h para A/B e ~10 anos para C (mesmo TTL do SessionStore)', async () => {
  const maxAge = async (u) => Number(/Max-Age=(\d+)/.exec((await app.login(u)).headers.get('set-cookie'))[1]);
  assert.equal(await maxAge('ADM'), 12 * 3600);
  assert.equal(await maxAge('ATEND'), 12 * 3600);
  assert.equal(await maxAge('COZ'), 10 * 365 * 24 * 3600);
  const troca = await app.request('POST', '/api/me/senha', { cookie: (await app.login('PROV')).cookie, body: { atual: SENHAS.PROV, nova: 'outraSenha1' } });
  assert.match(troca.headers.get('set-cookie'), /Max-Age=43200/);
});

test('login com senha errada → 401 e logout invalida o cookie', async () => {
  assert.equal((await app.login('ADM', 'errada')).status, 401);
  const { cookie } = await app.login('ADM', SENHAS.ADM);
  assert.equal((await app.request('GET', '/api/me', { cookie })).status, 200);
  const saida = await app.request('POST', '/api/logout', { cookie });
  assert.equal(saida.status, 200);
  assert.equal((await app.request('GET', '/api/me', { cookie })).status, 401);
});

test('rota protegida sem cookie → 401', async () => {
  assert.equal((await app.request('GET', '/api/me')).status, 401);
  assert.equal((await app.request('GET', '/api/usuarios')).status, 401);
  assert.equal((await app.request('GET', '/api/eventos')).status, 401);
});

test('rota inexistente → 404 {error}', async () => {
  const res = await app.request('GET', '/api/nao-existe', { user: 'ADM' });
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test('nível B em /api/usuarios → 403', async () => {
  assert.equal((await app.request('GET', '/api/usuarios', { user: 'ATEND' })).status, 403);
  assert.equal((await app.request('GET', '/api/auditoria', { user: 'ATEND' })).status, 403);
});

test('nível C em /api/usuarios → 403', async () => {
  assert.equal((await app.request('GET', '/api/usuarios', { user: 'COZ' })).status, 403);
});

test('nível C acessa só rotas de cozinha (/api/me e /api/eventos)', async () => {
  assert.equal((await app.request('GET', '/api/me', { user: 'COZ' })).status, 200);
  const sse = await abrirEventos('COZ');
  assert.equal(sse.res.status, 200);
  sse.fechar();
});

test('nível A administra usuários: cria, lista, atualiza e reseta senha', async () => {
  const criado = await app.request('POST', '/api/usuarios', { user: 'ADM', body: { usuario: 'maria', nome: 'Maria', nivel: 'B' } });
  assert.equal(criado.status, 200);
  assert.ok(criado.body.senhaProvisoria);
  const id = criado.body.user.id;
  assert.ok((await app.request('GET', '/api/usuarios', { user: 'ADM' })).body.some((u) => u.usuario === 'MARIA'));
  const alterado = await app.request('PUT', `/api/usuarios/${id}`, { user: 'ADM', body: { nome: 'Maria S.' } });
  assert.equal(alterado.body.nome, 'Maria S.');
  const reset = await app.request('POST', `/api/usuarios/${id}/resetar-senha`, { user: 'ADM' });
  assert.ok(reset.body.senhaProvisoria);
  assert.equal((await app.request('PUT', '/api/usuarios/9999', { user: 'ADM', body: { nome: 'x' } })).status, 404);
});

test('auditoria: nível A consulta e vê o login registrado', async () => {
  const lista = await app.request('GET', '/api/auditoria?acao=login', { user: 'ADM' });
  assert.equal(lista.status, 200);
  assert.ok(lista.body.length > 0);
  const detalhe = await app.request('GET', `/api/auditoria/${lista.body[0].id}`, { user: 'ADM' });
  assert.equal(detalhe.body.acao, 'login');
  assert.equal((await app.request('GET', '/api/auditoria/999999', { user: 'ADM' })).status, 404);
});

test('4ª tentativa após 3 erradas → 429', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await app.login('ATEND', 'errada')).status, 401);
  const quarta = await app.login('ATEND', SENHAS.ATEND);
  assert.equal(quarta.status, 429);
  assert.ok(quarta.body.error);
  app.relogio.advance(5 * 60 * 1000 + 1);
  assert.equal((await app.login('ATEND', SENHAS.ATEND)).status, 200);
});

test('com senha provisória, /api/auditoria → 403 e /api/me → 200', async () => {
  assert.equal((await app.request('GET', '/api/me', { user: 'PROV' })).status, 200);
  assert.equal((await app.request('GET', '/api/auditoria', { user: 'PROV' })).status, 403);
  assert.equal((await app.request('GET', '/api/eventos', { user: 'PROV' })).status, 403);
});

test('troca de senha devolve novo cookie e a nova sessão funciona; o sid antigo deixa de valer', async () => {
  const antigo = (await app.login('PROV', SENHAS.PROV)).cookie;
  const troca = await app.request('POST', '/api/me/senha', { cookie: antigo, body: { atual: SENHAS.PROV, nova: 'novaSenha9' } });
  assert.equal(troca.status, 200);
  assert.match(troca.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.notEqual(troca.cookie, antigo);
  assert.equal((await app.request('GET', '/api/me', { cookie: antigo })).status, 401);
  const novo = await app.request('GET', '/api/me', { cookie: troca.cookie });
  assert.equal(novo.status, 200);
  assert.equal(novo.body.mustChange, false);
  assert.equal((await app.request('GET', '/api/auditoria', { cookie: troca.cookie })).status, 403); // PROV é B
  assert.equal((await app.login('PROV', 'novaSenha9')).status, 200);
});

test('senha nova igual à atual ou curta → 400', async () => {
  const cookie = (await app.login('PROV', SENHAS.PROV)).cookie;
  assert.equal((await app.request('POST', '/api/me/senha', { cookie, body: { atual: SENHAS.PROV, nova: SENHAS.PROV } })).status, 400);
  assert.equal((await app.request('POST', '/api/me/senha', { cookie, body: { atual: SENHAS.PROV, nova: '123' } })).status, 400);
});

test('corpo JSON inválido ou que não é objeto → 400', async () => {
  const bruto = await fetch(`${app.baseUrl}/api/login`, { method: 'POST', body: '{quebrado' });
  assert.equal(bruto.status, 400);
  const nulo = await fetch(`${app.baseUrl}/api/login`, { method: 'POST', body: 'null' });
  assert.equal(nulo.status, 400);
});

test('GET /api/eventos entrega o evento publicado no EventBus', async () => {
  const sse = await abrirEventos('ADM');
  assert.equal(sse.res.status, 200);
  assert.match(sse.res.headers.get('content-type'), /text\/event-stream/);
  await esperar(() => app.bus.size === 1);
  app.bus.publish('pedido', { id: 7, situacao: 'ABERTO' });
  assert.deepEqual(await sse.lerEvento(), { tipo: 'pedido', dados: { id: 7, situacao: 'ABERTO' } });
  sse.fechar();
});

test('nível C recebe apenas eventos de cozinha', async () => {
  const sse = await abrirEventos('COZ');
  await esperar(() => app.bus.size === 1);
  app.bus.publish('pedido', { id: 1 });
  app.bus.publish('cozinha', { envioId: 2, novo: true });
  assert.deepEqual(await sse.lerEvento(), { tipo: 'cozinha', dados: { envioId: 2, novo: true } });
  sse.fechar();
});

test('o canal SSE não vaza assinante quando a conexão fecha', async () => {
  const sse = await abrirEventos('ADM');
  await esperar(() => app.bus.size === 1);
  assert.equal(app.bus.size, 1);
  sse.fechar();
  await esperar(() => app.bus.size === 0);
  assert.equal(app.bus.size, 0);
});

test('exceção inesperada → 500 {error} sem stack, detalhe só no log', async () => {
  app.app.server.router.add('GET', '/api/boom', () => { throw new Error('detalhe-interno-secreto'); });
  const res = await app.request('GET', '/api/boom', { user: 'ADM' });
  assert.equal(res.status, 500);
  assert.deepEqual(Object.keys(res.body), ['error']);
  assert.doesNotMatch(JSON.stringify(res.body), /detalhe-interno-secreto|at .*\.js/);
  assert.equal(app.erros.length, 1);
  assert.match(app.erros[0].message, /detalhe-interno-secreto/);
});

test('arquivos estáticos: serve public e bloqueia saída do diretório', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-public-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>');
  fs.writeFileSync(path.join(os.tmpdir(), 'pdv-segredo.txt'), 'segredo');
  const outro = await createTestApp({ publicDir: dir });
  try {
    const raiz = await fetch(`${outro.baseUrl}/`);
    assert.equal(raiz.status, 200);
    assert.equal(await raiz.text(), '<h1>ok</h1>');
    assert.equal((await fetch(`${outro.baseUrl}/nao-existe.js`)).status, 404);
    assert.equal((await fetch(`${outro.baseUrl}/..%2Fpdv-segredo.txt`)).status, 404);
  } finally {
    await outro.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(os.tmpdir(), 'pdv-segredo.txt'), { force: true });
  }
});
