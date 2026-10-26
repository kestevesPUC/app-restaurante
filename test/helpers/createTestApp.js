'use strict';
const { buildApplication } = require('../../src/compositionRoot');

const SENHAS = { ADM: 'segredo1', ATEND: 'segredo2', COZ: 'segredo3', PROV: 'provisoria1' };

/** Relógio falso: `now()` em ms, avançado manualmente com `advance(ms)`. */
function criarRelogio(inicio = '2026-10-23T12:00:00.000Z') {
  let t = Date.parse(inicio);
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/**
 * Sobe a aplicação completa (SQLite em memória, porta efêmera em 127.0.0.1) e devolve um cliente HTTP.
 * Usuários semeados: ADM (A), ATEND (B), COZ (C) e PROV (B, com senha provisória pendente).
 * `request(método, caminho, { body, user, cookie })`: `user` é um dos usuários semeados (login em cache) e `cookie` um `sid=...` explícito.
 */
async function createTestApp(overrides = {}) {
  const relogio = criarRelogio();
  const erros = [];
  const app = buildApplication({ dbPath: ':memory:', relogio: relogio.now, logger: { error: (e) => erros.push(e) }, ...overrides });
  const { usuarios } = app.repositories;
  const semear = (usuario, nivel, mustChange = false) => usuarios.create({
    usuario, nome: usuario, nivel, senhaHash: app.services.hasher.hash(SENHAS[usuario]), mustChange, criadoEm: new Date(relogio.now()).toISOString(),
  });
  semear('ADM', 'A');
  semear('ATEND', 'B');
  semear('COZ', 'C');
  semear('PROV', 'B', true);

  const { port } = await app.server.listen(0);
  app.server.server.unref();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessoes = new Map();

  async function request(method, path, { body, user, cookie } = {}) {
    const sid = cookie ?? (user ? sessoes.get(user) : undefined);
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(sid && { cookie: sid }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = (res.headers.get('content-type') || '').includes('json') && text;
    return { status: res.status, headers: res.headers, body: json ? JSON.parse(text) : text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  }

  /** Entra e guarda o cookie para as próximas chamadas com `user: usuario`. */
  async function login(usuario, senha = SENHAS[usuario]) {
    const res = await request('POST', '/api/login', { body: { usuario, senha } });
    if (res.status === 200) sessoes.set(usuario, res.cookie);
    return res;
  }

  for (const nome of ['ADM', 'ATEND', 'COZ', 'PROV']) await login(nome);

  return { request, login, baseUrl, relogio, erros, bus: app.bus, db: app.db, app, close: () => app.close() };
}

module.exports = { createTestApp, SENHAS };
