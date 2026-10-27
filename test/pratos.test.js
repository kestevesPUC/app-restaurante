'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let baseId;
beforeEach(async () => { app = await createTestApp(); baseId = undefined; });
afterEach(async () => { await app.close(); });

const post = (rota, body, user = 'ADM') => app.request('POST', rota, { user, body });
const put = (rota, body, user = 'ADM') => app.request('PUT', rota, { user, body });
const novaCategoria = async (nome = 'Lanches', extra = {}) => (await post('/api/categorias', { nome, ...extra })).body;
const novoIngrediente = async (nome, extra = {}) => (await post('/api/ingredientes', { nome, unidadeMedida: 'UN', ...extra })).body;
// Todo prato exige pelo menos um ingrediente: sem lista explícita, usa um ingrediente-base criado sob demanda.
const prato = async (categoriaId, extra = {}) => {
  if (!extra.ingredientes && !baseId) baseId = (await novoIngrediente('Base')).id;
  return post('/api/pratos', { nome: 'X-Burger', categoriaId, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: baseId }], ...extra });
};
const item = (ingredienteId, ordem = 0, extra = {}) => ({ ingredienteId, removivel: true, ordem, ...extra });

// PNG mínimo (só a assinatura importa) e variações para os testes de foto.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const uri = (buf, tipo = 'image/png') => `data:${tipo};base64,${buf.toString('base64')}`;

test('preço 0 ou não inteiro → 400', async () => {
  const cat = await novaCategoria();
  assert.equal((await prato(cat.id, { precoCents: 0 })).status, 400);
  assert.equal((await prato(cat.id, { precoCents: -5 })).status, 400);
  assert.equal((await prato(cat.id, { precoCents: 10.5 })).status, 400);
  assert.equal((await prato(cat.id, { precoCents: 1 })).status, 200);
});

test('mesmo ingrediente duas vezes no prato → 400', async () => {
  const cat = await novaCategoria();
  const pao = await novoIngrediente('Pão');
  const res = await prato(cat.id, { ingredientes: [item(pao.id, 0, { removivel: false }), item(pao.id, 1)] });
  assert.equal(res.status, 400);
});

test('ingrediente inativo não entra em prato novo nem é adicionado numa atualização', async () => {
  const cat = await novaCategoria();
  const velho = await novoIngrediente('Velho', { ativo: false });
  const ok = await novoIngrediente('Queijo');
  assert.equal((await prato(cat.id, { ingredientes: [item(velho.id)] })).status, 400);
  const criado = (await prato(cat.id)).body;
  assert.equal((await put(`/api/pratos/${criado.id}`, { ingredientes: [item(velho.id), item(ok.id, 1)] })).status, 400);
});

test('ingrediente desativado depois continua no prato existente', async () => {
  const cat = await novaCategoria();
  const alface = await novoIngrediente('Alface');
  const criado = (await prato(cat.id, { ingredientes: [item(alface.id)] })).body;
  await put(`/api/ingredientes/${alface.id}`, { ativo: false });
  const res = await put(`/api/pratos/${criado.id}`, { precoCents: 3000, ingredientes: [item(alface.id, 0, { removivel: false })] });
  assert.equal(res.status, 200);
  assert.equal(res.body.precoCents, 3000);
  assert.equal(res.body.ingredientes.length, 1);
  assert.equal(res.body.ingredientes[0].removivel, false);
});

test('código curto duplicado → 409; nome duplicado sem acento → 409', async () => {
  const cat = await novaCategoria();
  assert.equal((await prato(cat.id, { nome: 'Pão de queijo', codigo: '12' })).status, 200);
  assert.equal((await prato(cat.id, { nome: 'Outro', codigo: '12' })).status, 409);
  assert.equal((await prato(cat.id, { nome: 'PAO DE QUEIJO', codigo: '13' })).status, 409);
  assert.equal((await prato(cat.id, { nome: 'Sem código 1' })).status, 200);
  assert.equal((await prato(cat.id, { nome: 'Sem código 2' })).status, 200);
});

test('GET /api/cardapio omite pratos e categorias inativos e traz adicionais', async () => {
  const ativa = await novaCategoria('Lanches');
  const inativa = await novaCategoria('Antigos', { ativo: false });
  const queijo = await novoIngrediente('Queijo', { podeSerAdicional: true, precoAdicionalCents: 400 });
  await novoIngrediente('Bacon', { podeSerAdicional: true, precoAdicionalCents: 500, ativo: false });
  await novoIngrediente('Sal');
  const visivel = (await prato(ativa.id, { nome: 'Burger', codigo: '1', ingredientes: [item(queijo.id, 0, { quantidade: '2 fatias' })] })).body;
  const desativado = (await prato(ativa.id, { nome: 'Fora' })).body;
  await put(`/api/pratos/${desativado.id}`, { ativo: false });
  await prato(inativa.id, { nome: 'Da categoria inativa' });
  const res = await app.request('GET', '/api/cardapio', { user: 'ATEND' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categorias.map((c) => c.nome), ['Lanches']);
  assert.deepEqual(res.body.pratos.map((p) => p.nome), ['Burger']);
  const p = res.body.pratos[0];
  assert.equal(p.id, visivel.id);
  assert.equal(p.categoriaId, ativa.id);
  assert.equal(p.precoCents, 2500);
  assert.equal(p.codigo, '1');
  assert.equal(p.tempoPreparoMin, 10);
  assert.equal(p.temFoto, false);
  assert.deepEqual(p.ingredientes, [{ ingredienteId: queijo.id, nome: 'Queijo', removivel: true, quantidade: '2 fatias', ordem: 0 }]);
  assert.deepEqual(res.body.adicionais.map((a) => [a.nome, a.precoAdicionalCents]), [['Queijo', 400]]);
  assert.equal((await app.request('GET', '/api/cardapio', { user: 'COZ' })).status, 403);
});

test('foto sem limite de tamanho; assinatura inválida → 400; foto válida é gravada e servida', async () => {
  const cat = await novaCategoria();
  const p = (await prato(cat.id)).body;
  const rota = `/api/pratos/${p.id}/foto`;
  const grande = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 2)]);
  assert.equal((await put(rota, { foto: uri(Buffer.from('não sou imagem')) })).status, 400);
  assert.equal((await put(rota, { foto: 'texto' })).status, 400);
  assert.equal((await app.request('GET', rota, { user: 'ATEND' })).status, 404);
  assert.equal((await put(rota, { foto: uri(grande) })).status, 200);
  const ok = await put(rota, { foto: uri(PNG) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.temFoto, true);
  assert.equal(JSON.stringify(ok.body).includes('base64'), false);
  const cookie = (await app.login('ATEND')).cookie;
  const img = await fetch(`${app.baseUrl}${rota}`, { headers: { cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  const removida = await app.request('DELETE', rota, { user: 'ADM' });
  assert.equal(removida.body.temFoto, false);
});

test('alterar ingredientes substitui a lista em transação', async () => {
  const cat = await novaCategoria();
  const a = await novoIngrediente('A');
  const b = await novoIngrediente('B');
  const criado = (await prato(cat.id, { ingredientes: [item(a.id)] })).body;
  const res = await put(`/api/pratos/${criado.id}`, { ingredientes: [item(b.id)] });
  assert.deepEqual(res.body.ingredientes.map((i) => i.nome), ['B']);
  const falha = await put(`/api/pratos/${criado.id}`, { precoCents: 9999, ingredientes: [item(a.id), item(9999, 1)] });
  assert.equal(falha.status, 400);
  const lido = async () => (await app.request('GET', '/api/pratos', { user: 'ADM' })).body.find((x) => x.id === criado.id);
  assert.deepEqual((await lido()).ingredientes.map((i) => i.nome), ['B']);
  // erro de banco no meio da gravação desfaz o prato e a lista
  app.db.exec("CREATE TRIGGER falha BEFORE INSERT ON prato_ingredientes WHEN NEW.ordem = 7 BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const boom = await put(`/api/pratos/${criado.id}`, { precoCents: 7777, ingredientes: [item(a.id, 7)] });
  assert.equal(boom.status, 500);
  const intacto = await lido();
  assert.deepEqual(intacto.ingredientes.map((i) => i.nome), ['B']);
  assert.equal(intacto.precoCents, 2500);
  assert.equal(app.erros.length, 1);
});

test('excluir: porta pratoJaPedido → 409 "Em uso"; livre → ok', async () => {
  const cat = await novaCategoria();
  const p = (await prato(cat.id)).body;
  app.app.services.pratos.pratoJaPedido = (id) => id === p.id;
  const res = await app.request('DELETE', `/api/pratos/${p.id}`, { user: 'ADM' });
  assert.equal(res.status, 409);
  assert.match(JSON.stringify(res.body), /Em uso/);
  app.app.services.pratos.pratoJaPedido = () => false;
  assert.equal((await app.request('DELETE', `/api/pratos/${p.id}`, { user: 'ADM' })).status, 200);
  assert.equal((await app.request('DELETE', `/api/pratos/${p.id}`, { user: 'ADM' })).status, 404);
});

test('permissões e auditoria', async () => {
  const cat = await novaCategoria();
  assert.equal((await post('/api/pratos', { nome: 'Z', categoriaId: cat.id, precoCents: 100, tempoPreparoMin: 5 }, 'ATEND')).status, 403);
  assert.equal((await app.request('GET', '/api/pratos', { user: 'ATEND' })).status, 200);
  assert.equal((await app.request('GET', '/api/pratos', { user: 'COZ' })).status, 403);
  const p = (await prato(cat.id)).body;
  await put(`/api/pratos/${p.id}/foto`, { foto: uri(PNG) });
  await put(`/api/pratos/${p.id}`, { precoCents: 2600 });
  await app.request('DELETE', `/api/pratos/${p.id}`, { user: 'ADM' });
  const linhas = app.db.prepare("SELECT acao, depois FROM auditoria WHERE entidade = 'prato' ORDER BY id").all();
  assert.deepEqual(linhas.map((l) => l.acao), ['criar', 'alterar', 'alterar', 'excluir']);
  assert.equal(linhas.some((l) => (l.depois || '').includes('base64')), false);
});

test('excluir prato com ingredientes apaga prato_ingredientes em cascata e preserva os ingredientes', async () => {
  const cat = await novaCategoria();
  const a = await novoIngrediente('A');
  const b = await novoIngrediente('B');
  const p = (await prato(cat.id, { ingredientes: [item(a.id), item(b.id, 1)] })).body;
  const contar = () => app.db.prepare('SELECT COUNT(*) AS n FROM prato_ingredientes WHERE prato_id = ?').get(p.id).n;
  assert.equal(contar(), 2);
  assert.equal((await app.request('DELETE', `/api/pratos/${p.id}`, { user: 'ADM' })).status, 200);
  assert.equal(contar(), 0);
  const restantes = (await app.request('GET', '/api/ingredientes', { user: 'ADM' })).body.map((i) => i.id);
  assert.deepEqual(restantes.sort(), [a.id, b.id].sort());
});

test('prato sem tempo de preparo ou com 0, -1 ou 1.5 → 400', async () => {
  const cat = await novaCategoria();
  const ing = await novoIngrediente('Pão');
  const criar = (extra) => post('/api/pratos', { nome: 'T', categoriaId: cat.id, precoCents: 1000, ingredientes: [item(ing.id)], ...extra });
  assert.equal((await criar({})).status, 400);
  for (const v of [0, -1, 1.5, '10']) assert.equal((await criar({ tempoPreparoMin: v })).status, 400, String(v));
  const ok = await criar({ tempoPreparoMin: 1 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tempoPreparoMin, 1);
});

test('prato sem ingredientes → 400 "O prato precisa de pelo menos um ingrediente" (criar e atualizar)', async () => {
  const cat = await novaCategoria();
  const ing = await novoIngrediente('Pão');
  const base = { nome: 'S', categoriaId: cat.id, precoCents: 1000, tempoPreparoMin: 5 };
  for (const ingredientes of [undefined, []]) {
    const res = await post('/api/pratos', { ...base, ingredientes });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /O prato precisa de pelo menos um ingrediente/);
  }
  const criado = (await post('/api/pratos', { ...base, ingredientes: [item(ing.id)] })).body;
  const res = await put(`/api/pratos/${criado.id}`, { ingredientes: [] });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /O prato precisa de pelo menos um ingrediente/);
  const lido = (await app.request('GET', '/api/pratos', { user: 'ADM' })).body.find((x) => x.id === criado.id);
  assert.equal(lido.ingredientes.length, 1);
});

test('ativar/inativar prato por PUT {ativo} mantém a lista de ingredientes e o tempo', async () => {
  const cat = await novaCategoria();
  const criado = (await prato(cat.id)).body;
  const off = await put(`/api/pratos/${criado.id}`, { ativo: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.ativo, false);
  assert.equal(off.body.ingredientes.length, 1);
  assert.equal(off.body.tempoPreparoMin, 10);
  const on = await put(`/api/pratos/${criado.id}`, { ativo: true });
  assert.equal(on.body.ingredientes.length, 1);
});
