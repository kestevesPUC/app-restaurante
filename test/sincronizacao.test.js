'use strict';
const { test, mock, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SincronizacaoNuvem = require('../src/application/SincronizacaoNuvem');
const { lerConfiguracaoSincronizacao } = require('../src/infrastructure/sync/configSincronizacao');
const { createTestApp } = require('./helpers/createTestApp');

const solta = () => new Promise((r) => setImmediate(r));
function syncFalso({ falhar = false } = {}) {
  const s = { chamadas: 0, estado: { x: 1 }, falhar, async sincronizar() { s.chamadas += 1; if (s.falhar) throw new Error('sem rede'); return { pedidos: { enviados: 1, removidos: 0 } }; } };
  return s;
}

test('rotina automática roda no intervalo e o botão reinicia a contagem', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const sync = syncFalso();
  const salvos = [];
  const svc = new SincronizacaoNuvem({ sync, intervaloMs: 5000, salvarEstado: (e) => salvos.push(e), logger: { error() {} } });
  try {
    svc.iniciar();
    mock.timers.tick(500); await solta();
    assert.equal(sync.chamadas, 1, 'primeira rodada logo depois de iniciar');
    mock.timers.tick(4000); await solta();
    assert.equal(sync.chamadas, 1, 'ainda dentro dos 5 s');

    await svc.sincronizarAgora();
    assert.equal(sync.chamadas, 2, 'o botão sincroniza na hora');
    mock.timers.tick(4000); await solta();
    assert.equal(sync.chamadas, 2, 'sem o reinício, a rodada automática teria disparado aqui (1 s depois da anterior)');
    mock.timers.tick(1000); await solta();
    assert.equal(sync.chamadas, 3, '5 s depois do clique a rotina volta a rodar');
    assert.deepEqual(salvos[0], { x: 1 });
  } finally { svc.parar(); mock.timers.reset(); }
});

test('falha: o botão devolve 502 com o motivo, o estado guarda o erro e a rotina segue tentando', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const sync = syncFalso({ falhar: true });
  const svc = new SincronizacaoNuvem({ sync, intervaloMs: 5000, logger: { error() {} } });
  try {
    svc.iniciar();
    await assert.rejects(svc.sincronizarAgora(), (e) => e.status === 502 && /sem rede/.test(e.message));
    assert.match(svc.status().ultimoErro, /sem rede/);
    sync.falhar = false;
    mock.timers.tick(5000); await solta();
    assert.equal(svc.status().ultimoErro, null);
    assert.ok(svc.status().ultimaEm);
  } finally { svc.parar(); mock.timers.reset(); }
});

test('duas chamadas ao mesmo tempo compartilham uma única rodada', async () => {
  const sync = syncFalso();
  const svc = new SincronizacaoNuvem({ sync });
  await Promise.all([svc.sincronizarAgora(), svc.sincronizarAgora()]);
  assert.equal(sync.chamadas, 1);
});

test('sem configuração: status informa e o botão responde 409', async () => {
  const svc = new SincronizacaoNuvem({});
  assert.deepEqual(svc.status(), { configurado: false });
  await assert.rejects(svc.sincronizarAgora(), (e) => e.status === 409);
  svc.iniciar(); // não faz nada
  assert.equal(svc.ativo, false);
});

test('API: A, B e C consultam e sincronizam; sem login é 401; sem configuração é 409', async () => {
  const enviados = [];
  const destino = { preparar: async () => {}, ler: async () => [], aplicar: async (t, linhas) => { enviados.push([t.nome, linhas]); } };
  const t = await createTestApp({ sincronizacao: { destino, intervaloMs: 60000 } });
  after(() => t.close());
  for (const user of ['ADM', 'ATEND', 'COZ']) {
    const st = await t.request('GET', '/api/sincronizacao', { user });
    assert.equal(st.status, 200, user);
    assert.equal(st.body.configurado, true);
  }
  const res = await t.request('POST', '/api/sincronizacao/agora', { user: 'COZ' });
  assert.equal(res.status, 200);
  assert.ok(res.body.ultimaEm);
  assert.equal(res.body.ultimoErro, null);
  const usuarios = enviados.find(([nome]) => nome === 'usuarios')[1];
  assert.ok(usuarios.length >= 3);
  assert.ok(!JSON.stringify(usuarios).includes('senha_hash') || usuarios.every((u) => !('senha_hash' in u)), 'a senha não pode ser enviada');
  assert.equal((await t.request('GET', '/api/sincronizacao')).status, 401);
  assert.equal((await t.request('POST', '/api/sincronizacao/agora')).status, 401);

  const sem = await createTestApp();
  after(() => sem.close());
  assert.deepEqual((await sem.request('GET', '/api/sincronizacao', { user: 'ADM' })).body, { configurado: false });
  assert.equal((await sem.request('POST', '/api/sincronizacao/agora', { user: 'ADM' })).status, 409);
});

test('configuração: variáveis de ambiente vencem o .env; sem url/chave fica desligada; intervalo padrão 5 s', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  assert.equal(lerConfiguracaoSincronizacao({ pastas: [pasta], env: {} }), null);
  fs.writeFileSync(path.join(pasta, '.env'), '# comentário\nSUPABASE_URL="https://a.supabase.co"\nSUPABASE_SECRET_KEY=sb_secret_1\nSYNC_INTERVALO=2\n');
  assert.deepEqual(lerConfiguracaoSincronizacao({ pastas: [pasta], env: {} }), { url: 'https://a.supabase.co', chave: 'sb_secret_1', intervaloMs: 2000, puxar: true });
  assert.equal(lerConfiguracaoSincronizacao({ pastas: [pasta], env: { SYNC_PUXAR: '0' } }).puxar, false);
  assert.equal(lerConfiguracaoSincronizacao({ pastas: [pasta], env: { SUPABASE_SECRET_KEY: 'outra' } }).chave, 'outra');
  fs.writeFileSync(path.join(pasta, '.env'), 'SUPABASE_URL=https://a.supabase.co\nSUPABASE_SECRET_KEY=k\n');
  assert.equal(lerConfiguracaoSincronizacao({ pastas: [pasta], env: {} }).intervaloMs, 5000);
});
