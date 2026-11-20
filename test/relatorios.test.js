'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let B; let C; let burger;
const MIN = 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const u = (nome) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(nome);
  A = u('ADM'); B = u('ATEND'); C = u('COZ');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão' });
  burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2000, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
});
afterEach(async () => { await app.close(); });

/** Avança o relógio falso até o instante LOCAL dado (só para frente). */
function ir(a, m, d, h = 12, min = 0) {
  const alvo = new Date(a, m - 1, d, h, min).getTime();
  assert.ok(alvo >= app.relogio.now(), 'o relógio só anda para frente');
  app.relogio.advance(alvo - app.relogio.now());
}
const prato = (quantidade = 1) => ({ tipo: 'PRATO', itemId: burger.id, quantidade });
const rascunho = (itens = [prato()], nome = 'Ana', telefone = '11999998888') => s.pedidos.criarRascunho(B, { cliente: { nome, telefone }, itens });
function confirmado(itens, nome, telefone) {
  const p = rascunho(itens, nome, telefone);
  s.pedidos.confirmar(B, p.id);
  return p;
}
/** Confirma, prepara por `preparoMin` minutos e finaliza; a finalização ocorre no instante atual + preparoMin. */
function finalizado(itens, nome, telefone, preparoMin = 0) {
  const p = confirmado(itens, nome, telefone);
  s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
  app.relogio.advance(preparoMin * MIN);
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  s.pedidos.mudarStatus(A, p.id, 'FINALIZADO');
  return p;
}
const gerar = (tipo, filtros = {}) => s.relatorios.gerar(A, tipo, filtros);

test('faturamento diário: finalizado às 23:50 e outro às 00:10 caem em dias diferentes', () => {
  ir(2026, 10, 23, 23, 50);
  finalizado([prato(1)]);
  ir(2026, 10, 24, 0, 10);
  finalizado([prato(2)]);
  const r = gerar('faturamento', { de: '2026-10-23', ate: '2026-10-24' });
  assert.equal(r.titulo, 'Faturamento');
  assert.deepEqual(r.periodo, { de: '2026-10-23', ate: '2026-10-24' });
  assert.deepEqual(r.linhas, [
    { periodo: '2026-10-23', quantidade: 1, faturamentoCents: 2000, ticketMedioCents: 2000 },
    { periodo: '2026-10-24', quantidade: 1, faturamentoCents: 4000, ticketMedioCents: 4000 },
  ]);
  assert.deepEqual(r.totais, { quantidade: 2, faturamentoCents: 6000, ticketMedioCents: 3000 });
  assert.deepEqual(r.colunas.map((c) => [c.chave, c.tipo]), [['periodo', 'data'], ['quantidade', 'inteiro'], ['faturamentoCents', 'dinheiro'], ['ticketMedioCents', 'dinheiro']]);
});

test('faturamento mensal e anual (virada de mês e de ano)', () => {
  ir(2026, 11, 30, 23, 50); finalizado([prato(1)]);
  ir(2026, 12, 1, 0, 10); finalizado([prato(1)]);
  ir(2026, 12, 31, 23, 50); finalizado([prato(2)]);
  ir(2027, 1, 1, 0, 10); finalizado([prato(3)]);
  const mes = gerar('faturamento', { de: '2026-11-01', ate: '2027-01-31', agrupar: 'mes' });
  assert.deepEqual(mes.linhas.map((l) => [l.periodo, l.quantidade, l.faturamentoCents]), [['2026-11', 1, 2000], ['2026-12', 2, 6000], ['2027-01', 1, 6000]]);
  const ano = gerar('faturamento', { de: '2026-01-01', ate: '2027-12-31', agrupar: 'ano' });
  assert.deepEqual(ano.linhas.map((l) => [l.periodo, l.quantidade, l.faturamentoCents]), [['2026', 3, 8000], ['2027', 1, 6000]]);
  assert.deepEqual(ano.totais, { quantidade: 4, faturamentoCents: 14000, ticketMedioCents: 3500 });
});

test('cancelados e rascunhos fora do faturamento', () => {
  finalizado([prato(1)]);
  const c = confirmado([prato(5)]);
  s.pedidos.cancelar(B, c.id, 'desistiu');
  rascunho([prato(7)]);
  confirmado([prato(9)]);
  const r = gerar('faturamento', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(r.totais, { quantidade: 1, faturamentoCents: 2000, ticketMedioCents: 2000 });
});

test('ticket médio: 3 pedidos somando 10000 → 3333; 0 sem pedidos', () => {
  const bebida = s.bebidas.create(A, { nome: 'Água', precoCents: 1000, estoqueQtd: 50, estoqueMinimo: 0 });
  finalizado([prato(1), { tipo: 'BEBIDA', itemId: bebida.id, quantidade: 1 }]); // 3000
  finalizado([prato(1), { tipo: 'BEBIDA', itemId: bebida.id, quantidade: 2 }]); // 4000
  finalizado([{ tipo: 'BEBIDA', itemId: bebida.id, quantidade: 3 }]); // 3000
  const r = gerar('ticket-medio', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(r.linhas, [{ quantidade: 3, faturamentoCents: 10000, ticketMedioCents: 3333 }]);
  assert.deepEqual(r.totais, { quantidade: 3, faturamentoCents: 10000, ticketMedioCents: 3333 });
  const vazio = gerar('ticket-medio', { de: '2026-10-01', ate: '2026-10-22' });
  assert.deepEqual(vazio.linhas, []);
  assert.deepEqual(vazio.totais, { quantidade: 0, faturamentoCents: 0, ticketMedioCents: 0 });
});

test('tempo médio de preparo: 2 pedidos de 10 e 20 minutos = 900 s', () => {
  finalizado([prato()], 'Ana', '11999998888', 10);
  finalizado([prato()], 'Bia', '11988887777', 20);
  const r = gerar('tempo-medio-preparo', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(r.linhas.map((l) => l.duracaoSegundos), [600, 1200]);
  assert.deepEqual(r.totais, { quantidade: 2, mediaSegundos: 900, minimoSegundos: 600, maximoSegundos: 1200 });
  assert.equal(r.colunas.find((c) => c.chave === 'duracaoSegundos').tipo, 'duracao');
  const vazio = gerar('tempo-medio-preparo', { de: '2026-10-01', ate: '2026-10-22' });
  assert.deepEqual(vazio.linhas, []);
  assert.deepEqual(vazio.totais, { quantidade: 0, mediaSegundos: null, minimoSegundos: null, maximoSegundos: null });
});

test('pedido com duas linhas de FINALIZADO no histórico conta UMA vez, pela última', () => {
  ir(2026, 10, 23, 23, 50);
  const p = finalizado([prato(1)]);
  // simula finalizado → desfeito para EM_PREPARO → finalizado de novo no dia seguinte
  const ins = app.db.prepare('INSERT INTO pedido_status_historico (pedido_id, status_anterior, status_novo, em) VALUES (?, ?, ?, ?)');
  ins.run(p.id, 'FINALIZADO', 'EM_PREPARO', new Date(2026, 9, 24, 0, 5).toISOString());
  ins.run(p.id, 'EM_PREPARO', 'PRONTO_RETIRADA', new Date(2026, 9, 24, 0, 8).toISOString());
  ins.run(p.id, 'PRONTO_RETIRADA', 'FINALIZADO', new Date(2026, 9, 24, 0, 10).toISOString());
  const r = gerar('faturamento', { de: '2026-10-23', ate: '2026-10-24' });
  assert.deepEqual(r.linhas.map((l) => [l.periodo, l.quantidade]), [['2026-10-24', 1]]);
  const f = gerar('pedidos-finalizados', { de: '2026-10-23', ate: '2026-10-24' });
  assert.equal(f.linhas.length, 1);
  assert.equal(f.linhas[0].finalizadoEm, new Date(2026, 9, 24, 0, 10).toISOString());
});

test('pedidos por período, finalizados e cancelados (com motivo)', () => {
  const f = finalizado([prato(2)], 'Zoé 🍔', '11999998888');
  const c = confirmado([prato(1)], 'Bia', '11988887777');
  s.pedidos.cancelar(B, c.id, 'cliente desistiu');
  const r1 = confirmado([prato(1)], 'Caio', '11977776666');
  rascunho([prato(1)]);
  const pp = gerar('pedidos-periodo', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(pp.linhas.map((l) => l.numero), [f.id, c.id, r1.id]);
  const lf = pp.linhas[0];
  assert.equal(lf.cliente, 'Zoé 🍔');
  assert.equal(lf.itens, 2);
  assert.equal(lf.totalCents, 4000);
  assert.equal(lf.status, 'FINALIZADO');
  assert.equal(pp.totais.quantidade, 3);
  assert.equal(pp.totais.totalCents, 8000);
  assert.deepEqual(pp.totais.porStatus.CANCELADO, { quantidade: 1, totalCents: 2000 });
  const fin = gerar('pedidos-finalizados', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(fin.linhas.map((l) => l.numero), [f.id]);
  assert.deepEqual(fin.totais, { quantidade: 1, totalCents: 4000 });
  const can = gerar('pedidos-cancelados', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(can.linhas.map((l) => [l.numero, l.motivo]), [[c.id, 'cliente desistiu']]);
  assert.deepEqual(can.totais, { quantidade: 1, totalCents: 2000 });
});

test('bebidas mais vendidas: só finalizados, por quantidade desc e empate por nome; limite', () => {
  const mk = (nome) => s.bebidas.create(A, { nome, precoCents: 500, estoqueQtd: 100, estoqueMinimo: 0 });
  const suco = mk('Suco'); const agua = mk('Água'); const coca = mk('Coca-Cola');
  const beb = (b, q) => ({ tipo: 'BEBIDA', itemId: b.id, quantidade: q });
  finalizado([beb(suco, 3), beb(agua, 2)]);
  finalizado([beb(coca, 3)]);
  const cancelado = confirmado([beb(agua, 10)]);
  s.pedidos.cancelar(B, cancelado.id, 'x');
  confirmado([beb(suco, 10)]);
  const r = gerar('bebidas-mais-vendidas', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(r.linhas.map((l) => [l.bebida, l.quantidade, l.totalCents]), [['Coca-Cola', 3, 1500], ['Suco', 3, 1500], ['Água', 2, 1000]]);
  assert.deepEqual(r.totais, { quantidade: 8, totalCents: 4000 });
  assert.deepEqual(gerar('bebidas-mais-vendidas', { de: '2026-10-23', ate: '2026-10-23', limite: 1 }).linhas.map((l) => l.bebida), ['Coca-Cola']);
});

test('estoque atual (todas, com situação) e estoque crítico (só ativas com saldo ≤ mínimo)', () => {
  const mk = (nome, estoqueQtd, estoqueMinimo) => s.bebidas.create(A, { nome, precoCents: 500, estoqueQtd, estoqueMinimo });
  mk('Água', 10, 5); mk('Coca-Cola', 5, 5); mk('Suco', 2, 5);
  const inativa = mk('Guaraná', 0, 5);
  s.bebidas.update(A, inativa.id, { ativo: false });
  const atual = gerar('estoque-atual');
  assert.equal(atual.periodo, null);
  assert.deepEqual(atual.linhas.map((l) => [l.bebida, l.saldo, l.minimo, l.situacao]),
    [['Água', 10, 5, 'OK'], ['Coca-Cola', 5, 5, 'CRITICO'], ['Guaraná', 0, 5, 'INATIVA'], ['Suco', 2, 5, 'CRITICO']]);
  const critico = gerar('estoque-critico');
  assert.deepEqual(critico.linhas.map((l) => l.bebida), ['Coca-Cola', 'Suco']);
  assert.deepEqual(critico.totais, { quantidade: 2 });
});

test('clientes frequentes e maior gasto contam só finalizados', () => {
  finalizado([prato(1)], 'Ana', '11999998888');
  finalizado([prato(1)], 'Ana', '11999998888');
  finalizado([prato(5)], 'Bia', '11988887777');
  finalizado([prato(1)], 'Caio', '11977776666');
  const c = confirmado([prato(9)], 'Caio', '11977776666');
  s.pedidos.cancelar(B, c.id, 'x');
  confirmado([prato(9)], 'Caio', '11977776666');
  const f = gerar('clientes-frequentes', { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(f.linhas.map((l) => [l.cliente, l.quantidade, l.gastoCents]), [['Ana', 2, 4000], ['Bia', 1, 10000], ['Caio', 1, 2000]]);
  const g = gerar('clientes-maior-gasto', { de: '2026-10-23', ate: '2026-10-23', limite: 2 });
  assert.deepEqual(g.linhas.map((l) => [l.cliente, l.gastoCents]), [['Bia', 10000], ['Ana', 4000]]);
});

test('período sem dados → linhas [] e totais zerados em todos os relatórios', () => {
  for (const tipo of ['pedidos-periodo', 'pedidos-finalizados', 'pedidos-cancelados', 'faturamento', 'bebidas-mais-vendidas', 'clientes-frequentes', 'clientes-maior-gasto', 'estoque-critico']) {
    const r = gerar(tipo, { de: '2026-10-01', ate: '2026-10-02' });
    assert.deepEqual(r.linhas, [], tipo);
    for (const [k, v] of Object.entries(r.totais)) if (k !== 'porStatus') assert.equal(v, 0, `${tipo}.${k}`);
  }
});

test('autorização no serviço: B, C e ausente → 403 antes do 404; tipo inexistente → 404', () => {
  for (const user of [B, C, undefined, null]) {
    assert.throws(() => s.relatorios.gerar(user, 'faturamento', {}), (e) => e.status === 403);
    assert.throws(() => s.relatorios.gerar(user, 'nada', {}), (e) => e.status === 403);
    assert.throws(() => s.relatorios.listar(user), (e) => e.status === 403);
  }
  assert.throws(() => gerar('nada'), (e) => e.status === 404);
});

test('GET /api/relatorios e /api/relatorios/:tipo: JSON, 400, 404 e 403', async () => {
  finalizado([prato(1)]);
  const lista = await app.request('GET', '/api/relatorios', { user: 'ADM' });
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 11);
  assert.ok(lista.body.find((t) => t.tipo === 'faturamento').filtros.includes('agrupar'));
  const ok = await app.request('GET', '/api/relatorios/faturamento?de=2026-10-23&ate=2026-10-23&agrupar=mes', { user: 'ADM' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.linhas, [{ periodo: '2026-10', quantidade: 1, faturamentoCents: 2000, ticketMedioCents: 2000 }]);
  for (const q of ['de=2026-10-24&ate=2026-10-23', 'de=2026-13-01', 'agrupar=semana', 'limite=0', 'limite=201', 'limite=abc']) {
    assert.equal((await app.request('GET', `/api/relatorios/faturamento?${q}`, { user: 'ADM' })).status, 400, q);
  }
  assert.equal((await app.request('GET', '/api/relatorios/nada', { user: 'ADM' })).status, 404);
  for (const user of ['ATEND', 'COZ']) {
    assert.equal((await app.request('GET', '/api/relatorios', { user })).status, 403);
    assert.equal((await app.request('GET', '/api/relatorios/nada', { user })).status, 403);
  }
  assert.equal((await app.request('GET', '/api/relatorios/faturamento')).status, 401);
});

test('dashboard: ranking, pedidos e faturamento, com filtro de item', () => {
  ir(2026, 10, 23, 12, 0);
  finalizado([prato(2)]);
  finalizado([prato(1)]);
  confirmado([prato(5)]); // não finalizado: fora do dashboard
  const r = s.relatorios.dashboard(A, { de: '2026-10-23', ate: '2026-10-23' });
  assert.deepEqual(r.resumo, { pedidos: 2, faturamentoCents: 6000, ticketMedioCents: 3000, itensVendidos: 3 });
  assert.equal(r.ranking[0].nome, 'X-Burger');
  assert.equal(r.ranking[0].quantidade, 3);
  assert.equal(r.porDia.length, 1);
  const f = s.relatorios.dashboard(A, { de: '2026-10-23', ate: '2026-10-23', itens: ['PRATO:9999'] });
  assert.equal(f.resumo.pedidos, 0);
  assert.throws(() => s.relatorios.dashboard(B, {}), /permissão/);
});
