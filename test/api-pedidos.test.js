'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

// API de pedidos: consulta (pedidos criados pelo serviço) e escrita (rascunho, confirmar, reabrir, cancelar, status).
let app; let s; let B; let c;
const DIA = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  B = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ATEND');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  const burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  c = { burger };
});
afterEach(async () => { await app.close(); });

const req = (method, path, user = 'ATEND') => app.request(method, path, { user });
const pedido = (nome = 'Ana', telefone = '(11) 99999-8888') => s.pedidos.criarRascunho(B, {
  cliente: { nome, telefone }, itens: [{ tipo: 'PRATO', itemId: c.burger.id, quantidade: 1 }],
});

test('GET /api/pedidos devolve ordem crescente de id e só o dia atual por padrão', async () => {
  const ontem = pedido('Ontem');
  app.relogio.advance(DIA);
  await app.login('ATEND');
  const a = pedido('A');
  const b = pedido('B');
  const res = await req('GET', '/api/pedidos');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.id), [a.id, b.id]);
  const dois = await req('GET', `/api/pedidos?de=${ontem.dataLocal}&ate=${a.dataLocal}`);
  assert.deepEqual(dois.body.map((p) => p.id), [ontem.id, a.id, b.id]);
  const linha = res.body[0];
  assert.equal(linha.status, 'ABERTO');
  assert.equal(linha.quantidadeTotal, 1);
  assert.equal(linha.totalCents, 2500);
  assert.equal(linha.cliente.nome, 'A');
});

test('filtro por status, q (nome) e limite', async () => {
  const p1 = pedido('Maria Souza');
  const p2 = pedido('João');
  s.pedidos.confirmar(B, p2.id);
  const ids = async (qs) => (await req('GET', `/api/pedidos?${qs}`)).body.map((p) => p.id);
  assert.deepEqual(await ids('status=RECEBIDO'), [p2.id]);
  assert.deepEqual(await ids('q=maria'), [p1.id]);
  assert.deepEqual(await ids('q=joao'), [p2.id]);
  assert.deepEqual(await ids('limite=1'), [p1.id]);
  for (const qs of ['status=PAGO', 'limite=0', 'limite=1001', 'limite=abc']) assert.equal((await req('GET', `/api/pedidos?${qs}`)).status, 400, qs);
});

test('GET /api/pedidos/:id devolve o Pedido com itens e histórico', async () => {
  const p = pedido();
  s.pedidos.confirmar(B, p.id);
  const res = await req('GET', `/api/pedidos/${p.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'RECEBIDO');
  assert.equal(res.body.itens[0].nome, 'X-Burger');
  assert.equal(res.body.historico[0].para, 'RECEBIDO');
  assert.equal(res.body.tempoEstimadoMin, 10);
});

test('nível C → 403 em /api/pedidos', async () => {
  assert.equal((await req('GET', '/api/pedidos', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos.csv', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos/1', 'COZ')).status, 403);
  assert.equal((await req('GET', '/api/pedidos')).status, 200);
});

test('pedidos.csv neutraliza célula começando com = + - @', async () => {
  const nomes = ['=1+1', '+SOMA(A1)', '-2', '@cmd', 'Normal'];
  for (const n of nomes) pedido(n);
  const res = await req('GET', '/api/pedidos.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  const linhas = res.body.trim().split('\r\n');
  assert.equal(linhas[0], 'Nº;Data;Hora;Cliente;Telefone;Itens;Total (R$);Tempo estimado (min);Status');
  assert.match(linhas[1], /^\d+;\d{2}\/\d{2}\/\d{4};\d{2}:\d{2};/);
  assert.deepEqual(linhas.slice(1).map((l) => l.split(';')[3]), ["'=1+1", "'+SOMA(A1)", "'-2", "'@cmd", 'Normal']);
  assert.equal(linhas[1].split(';')[6], '25,00');
  assert.equal(linhas[1].split(';')[4], "'+5511999998888");
  assert.equal(linhas[1].split(';')[7], '10');
});

test('nome de cliente com acento, emoji e & vai e volta intacto no JSON e no CSV', async () => {
  const nome = 'José & "Filhos" 🍕 São';
  const p = pedido(nome);
  assert.equal((await req('GET', `/api/pedidos/${p.id}`)).body.cliente.nome, nome);
  assert.equal((await req('GET', '/api/pedidos')).body[0].cliente.nome, nome);
  assert.ok((await req('GET', '/api/pedidos.csv')).body.includes('"José & ""Filhos"" 🍕 São"'));
});

test('id não numérico → 400; inexistente → 404', async () => {
  assert.equal((await req('GET', '/api/pedidos/abc')).status, 400);
  assert.equal((await req('GET', '/api/pedidos/0')).status, 400);
  assert.equal((await req('GET', '/api/pedidos/999')).status, 404);
});

test('endereço com %-encoding inválido → 400, não 500', async () => {
  const res = await req('GET', '/api/pedidos/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  assert.equal(app.erros.length, 0);
});

test('de inválido → 400', async () => {
  for (const qs of ['de=2026-13-01', 'de=hoje', 'ate=2026-02-30', 'de=2026-1-1']) {
    assert.equal((await req('GET', `/api/pedidos?${qs}`)).status, 400, qs);
    assert.equal((await req('GET', `/api/pedidos.csv?${qs}`)).status, 400, qs);
  }
  assert.equal((await req('GET', '/api/pedidos?de=2026-10-23&ate=2026-10-24')).status, 200);
});

test('rotas antigas não existem mais', async () => {
  const p = pedido();
  for (const [m, path] of [['POST', `/api/pedidos/${p.id}/finalizar`], ['POST', `/api/pedidos/${p.id}/enviar-cozinha`], ['POST', `/api/pedidos/${p.id}/itens`], ['POST', `/api/pedidos/${p.id}/mover`], ['POST', `/api/pedidos/${p.id}/desconto`], ['GET', '/api/mesas/1/comanda']]) {
    assert.equal((await req(m, path)).status, 404, path);
  }
});

test('de > ate → 400; q com mais de 80 caracteres → 400', async () => {
  assert.equal((await req('GET', '/api/pedidos?de=2026-10-24&ate=2026-10-23')).status, 400);
  assert.equal((await req('GET', '/api/pedidos.csv?de=2026-10-24&ate=2026-10-23')).status, 400);
  assert.equal((await req('GET', `/api/pedidos?q=${'a'.repeat(81)}`)).status, 400);
  assert.equal((await req('GET', `/api/pedidos?q=${'a'.repeat(80)}`)).status, 200);
  assert.equal((await req('GET', '/api/pedidos?q=a&q=b')).status, 200, 'q repetido: vale o último');
});

test('busca q por número, nome com acento e parte do telefone', async () => {
  const joao = pedido('João Ávila', '(11) 98888-1111');
  const ana = pedido('Ana', '(11) 99999-8888');
  const ids = async (q) => (await req('GET', `/api/pedidos?q=${encodeURIComponent(q)}`)).body.map((p) => p.id);
  assert.deepEqual(await ids(String(ana.id)), [ana.id]);
  assert.deepEqual(await ids('joao'), [joao.id]);
  assert.deepEqual(await ids('ÁVILA'), [joao.id]);
  assert.deepEqual(await ids('99999'), [ana.id]);
});

const item = () => ({ tipo: 'PRATO', itemId: c.burger.id, quantidade: 2 });
const post = (path, body, user = 'ATEND') => app.request('POST', path, { user, body });
const put = (path, body, user = 'ATEND') => app.request('PUT', path, { user, body });
const novo = async (extra = {}) => (await post('/api/pedidos', { cliente: { nome: 'Ana', telefone: '(11) 99999-8888' }, itens: [item()], ...extra })).body;

test('fluxo completo: rascunho → confirmar → EM_PREPARO → PRONTO_RETIRADA → FINALIZADO', async () => {
  const criado = await post('/api/pedidos', { cliente: { nome: 'Ana', telefone: '(11) 99999-8888' }, itens: [item()], observacao: 'sem cebola', totalCents: 1, precoCents: 1 });
  assert.equal(criado.status, 200);
  assert.equal(criado.body.status, 'ABERTO');
  assert.equal(criado.body.totalCents, 5000, 'preço do corpo é ignorado');
  const id = criado.body.id;
  const alt = await put(`/api/pedidos/${id}`, { itens: [{ ...item(), quantidade: 1 }] });
  assert.equal(alt.status, 200);
  assert.equal(alt.body.totalCents, 2500);
  assert.equal((await post(`/api/pedidos/${id}/confirmar`)).body.status, 'RECEBIDO');
  assert.equal((await post(`/api/pedidos/${id}/status`, { status: 'EM_PREPARO' }, 'COZ')).body.status, 'EM_PREPARO');
  assert.equal((await post(`/api/pedidos/${id}/status`, { status: 'PRONTO_RETIRADA' }, 'COZ')).body.status, 'PRONTO_RETIRADA');
  const fim = await post(`/api/pedidos/${id}/status`, { status: 'FINALIZADO' });
  assert.equal(fim.status, 200);
  assert.deepEqual(fim.body.historico.map((h) => h.para), ['RECEBIDO', 'EM_PREPARO', 'PRONTO_RETIRADA', 'FINALIZADO']);
  assert.equal((await post(`/api/pedidos/${id}/reabrir`)).status, 409);
  assert.equal(app.erros.length, 0);
});

test('reabrir e cancelar com motivo', async () => {
  const p = await novo();
  await post(`/api/pedidos/${p.id}/confirmar`);
  assert.equal((await post(`/api/pedidos/${p.id}/reabrir`)).body.status, 'ABERTO');
  assert.equal((await post(`/api/pedidos/${p.id}/cancelar`, {})).status, 400);
  assert.equal((await post(`/api/pedidos/${p.id}/cancelar`, { motivo: 7 })).status, 400);
  const c1 = await post(`/api/pedidos/${p.id}/cancelar`, { motivo: 'Desistiu' });
  assert.equal(c1.body.status, 'CANCELADO');
  assert.equal(c1.body.motivoCancelamento, 'Desistiu');
  assert.equal((await post(`/api/pedidos/${p.id}/confirmar`)).status, 409);
});

test('confirmar sem cliente → 400; inexistente → 404; PUT em pedido confirmado → 409', async () => {
  const sem = (await post('/api/pedidos', { itens: [item()] })).body;
  const r = await post(`/api/pedidos/${sem.id}/confirmar`);
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
  assert.equal((await post('/api/pedidos/999/confirmar')).status, 404);
  const p = await novo();
  await post(`/api/pedidos/${p.id}/confirmar`);
  assert.equal((await put(`/api/pedidos/${p.id}`, { observacao: 'x' })).status, 409);
});

test('bebida acima do estoque → 409 com a mensagem', async () => {
  const A = app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get('ADM');
  const coca = s.bebidas.create(A, { nome: 'Coca-Cola', precoCents: 600, estoqueQtd: 3, estoqueMinimo: 0 });
  const r = await post('/api/pedidos', { cliente: { nome: 'Ana', telefone: '(11) 99999-8888' }, itens: [{ tipo: 'BEBIDA', itemId: coca.id, quantidade: 5 }] });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Coca-Cola \(saldo 3, pedido 5\)/);
});

test('fronteira: status inválido, ids ruins, corpo vazio/array, itens demais → 400', async () => {
  const p = await novo();
  for (const status of ['PAGO', 'ABERTO', 7, null, ['EM_PREPARO']]) {
    assert.equal((await post(`/api/pedidos/${p.id}/status`, { status })).status, 400, String(status));
  }
  assert.equal((await post(`/api/pedidos/${p.id}/status`)).status, 400);
  for (const id of ['abc', '0', '-1', '1.5', '1e3']) {
    for (const rota of ['confirmar', 'reabrir', 'cancelar', 'status']) assert.equal((await post(`/api/pedidos/${id}/${rota}`, { motivo: 'x', status: 'EM_PREPARO' })).status, 400, `${id}/${rota}`);
    assert.equal((await put(`/api/pedidos/${id}`, {})).status, 400, `PUT ${id}`);
  }
  assert.equal((await post('/api/pedidos', [])).status, 400);
  assert.equal((await post('/api/pedidos', 'texto')).status, 400);
  assert.equal((await post('/api/pedidos')).status, 400, 'corpo vazio sem itens');
  assert.equal((await post('/api/pedidos', { itens: 'x' })).status, 400);
  assert.equal((await post('/api/pedidos', { itens: Array.from({ length: 101 }, item) })).status, 400);
  assert.equal((await put(`/api/pedidos/${p.id}`, [])).status, 400);
  assert.equal(app.erros.length, 0);
});

test('nível C: 403 em tudo menos cozinha e status; B não muda para EM_PREPARO; A faz tudo', async () => {
  const p = await novo();
  assert.equal((await post('/api/pedidos', { itens: [item()] }, 'COZ')).status, 403);
  assert.equal((await put(`/api/pedidos/${p.id}`, {}, 'COZ')).status, 403);
  for (const rota of ['confirmar', 'reabrir', 'cancelar']) assert.equal((await post(`/api/pedidos/${p.id}/${rota}`, { motivo: 'x' }, 'COZ')).status, 403, rota);
  assert.equal((await req('GET', '/api/pedidos', 'COZ')).status, 403);
  await post(`/api/pedidos/${p.id}/confirmar`);
  assert.equal((await post(`/api/pedidos/${p.id}/status`, { status: 'EM_PREPARO' }, 'ATEND')).status, 403);
  assert.equal((await post(`/api/pedidos/${p.id}/status`, { status: 'EM_PREPARO' }, 'COZ')).status, 200);
  const q = await novo();
  assert.equal((await post(`/api/pedidos/${q.id}/confirmar`, undefined, 'ADM')).status, 200);
  assert.equal((await post(`/api/pedidos/${q.id}/status`, { status: 'EM_PREPARO' }, 'ADM')).status, 200);
  assert.equal((await post(`/api/pedidos/${q.id}/cancelar`, { motivo: 'teste' }, 'ADM')).status, 200);
});

test('corpos hostis → 400 em português, nunca 500', async () => {
  const p = await novo();
  const itens = [null, [null], [{}], 'x', 5, {}, [[]], [{ tipo: 'PRATO' }], [{ tipo: 'PRATO', itemId: 'a', quantidade: 1 }], [{ tipo: 'PRATO', itemId: c.burger.id, quantidade: -1 }]];
  const clientes = ['x', [], 5, { nome: 5 }, { nome: {} }, { telefone: {} }, { nome: 'Ana', telefone: [] }];
  for (const i of itens) {
    assert.equal((await post('/api/pedidos', { itens: i })).status, 400, `POST itens ${JSON.stringify(i)}`);
    assert.equal((await put(`/api/pedidos/${p.id}`, { itens: i })).status, 400, `PUT itens ${JSON.stringify(i)}`);
  }
  for (const cl of clientes) {
    const a = await post('/api/pedidos', { itens: [item()], cliente: cl });
    assert.equal(a.status, 400, `POST cliente ${JSON.stringify(cl)}`);
    assert.ok(a.body.error);
    assert.equal((await put(`/api/pedidos/${p.id}`, { cliente: cl })).status, 400, `PUT cliente ${JSON.stringify(cl)}`);
  }
  for (const o of [5, {}, [], true]) {
    assert.equal((await post('/api/pedidos', { itens: [item()], observacao: o })).status, 400, `observacao ${JSON.stringify(o)}`);
    assert.equal((await put(`/api/pedidos/${p.id}`, { observacao: o })).status, 400);
  }
  for (const motivo of [{}, 5, [], null, '', '   ', 'x'.repeat(201)]) {
    assert.equal((await post(`/api/pedidos/${p.id}/cancelar`, { motivo })).status, 400, `motivo ${JSON.stringify(motivo)}`);
  }
  for (const rota of ['', '/confirmar', '/cancelar', '/status', '/reabrir']) {
    for (const m of ['POST', 'PUT']) {
      if (m === 'PUT' && rota) continue;
      const path = `/api/pedidos${m === 'PUT' ? `/${p.id}` : rota ? `/${p.id}${rota}` : ''}`;
      for (const corpo of [null, 'x', 5, []]) {
        const r = await app.request(m, path, { user: 'ATEND', body: corpo });
        assert.equal(r.status, 400, `${m} ${path} ${JSON.stringify(corpo)}`);
        assert.ok(r.body.error);
      }
    }
  }
  assert.equal((await req('GET', `/api/pedidos/${p.id}`)).body.status, 'ABERTO');
  assert.equal(app.erros.length, 0);
});
