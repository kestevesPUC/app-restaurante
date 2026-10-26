'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let pedidoSeq;
beforeEach(async () => { app = await createTestApp(); pedidoSeq = 0; });
afterEach(async () => { await app.close(); });

const post = (rota, body, user = 'ADM') => app.request('POST', rota, { user, body });
const get = (rota, user = 'ADM') => app.request('GET', rota, { user });
const nova = async (extra = {}) => (await post('/api/bebidas', { nome: 'Coca-Cola', precoCents: 600, estoqueQtd: 10, ...extra })).body;
const mov = (id, corpo, user) => post(`/api/bebidas/${id}/movimentacoes`, corpo, user);
const saldo = (id) => app.db.prepare('SELECT estoque_qtd FROM bebidas WHERE id = ?').get(id).estoque_qtd;
const movimentos = (id) => app.db.prepare('SELECT * FROM movimentacoes_estoque WHERE bebida_id = ? ORDER BY id').all(id);
const novoPedido = () => {
  const adm = app.db.prepare("SELECT id FROM usuarios WHERE usuario = 'ADM'").get().id;
  pedidoSeq += 1;
  return Number(app.db.prepare("INSERT INTO pedidos (data_local, numero_dia, tipo, cliente_nome, criado_por, criado_em) VALUES ('2026-10-23', ?, 'BALCAO', 'Ana', ?, '2026-10-23T12:00:00.000Z')").run(pedidoSeq, adm).lastInsertRowid);
};
const ADM = { id: 1, usuario: 'ADM' };
const estoque = () => app.app.services.estoque;
/** Simula a transação do chamador (Tarefa 5). */
const naTransacao = (fn) => app.db.transaction(fn);
const baixar = (pedido, itens) => naTransacao(() => estoque().baixarParaPedido(ADM, pedido, itens));
const estornar = (pedido) => naTransacao(() => estoque().estornarPedido(ADM, pedido));
const falhaCom = (status) => (e) => e.status === status;

test('entrada 5 sobre saldo 10 → saldo 15, com movimento e instante', async () => {
  const b = await nova();
  const res = await mov(b.id, { tipo: 'ENTRADA', quantidade: 5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.estoqueQtd, 15);
  const m = movimentos(b.id)[1];
  assert.deepEqual([m.tipo, m.quantidade, m.saldo_apos, m.usuario], ['ENTRADA', 5, 15, 'ADM']);
  assert.equal(m.em, '2026-10-23T12:00:00.000Z');
});

test('entrada aceita motivo opcional; quantidade deve ser inteira >= 1', async () => {
  const b = await nova();
  assert.equal((await mov(b.id, { tipo: 'ENTRADA', quantidade: 2, motivo: 'Compra do fornecedor' })).status, 200);
  assert.equal(movimentos(b.id)[1].motivo, 'Compra do fornecedor');
  for (const quantidade of [0, -1, 1.5, '3', undefined]) assert.equal((await mov(b.id, { tipo: 'ENTRADA', quantidade })).status, 400, String(quantidade));
  assert.equal(saldo(b.id), 12);
});

test('saída 20 com saldo 15 → 409 e saldo continua 15', async () => {
  const b = await nova({ estoqueQtd: 15 });
  const res = await mov(b.id, { tipo: 'SAIDA', quantidade: 20, motivo: 'Perda' });
  assert.equal(res.status, 409);
  assert.equal(saldo(b.id), 15);
  assert.equal(movimentos(b.id).length, 1);
});

test('saída válida grava quantidade negativa, motivo e saldo_apos', async () => {
  const b = await nova();
  const res = await mov(b.id, { tipo: 'SAIDA', quantidade: 4, motivo: 'Quebrou' });
  assert.equal(res.body.estoqueQtd, 6);
  const m = movimentos(b.id)[1];
  assert.deepEqual([m.tipo, m.quantidade, m.saldo_apos, m.motivo], ['SAIDA', -4, 6, 'Quebrou']);
  assert.equal((await mov(b.id, { tipo: 'SAIDA', quantidade: 6, motivo: 'Tudo' })).body.estoqueQtd, 0);
});

test('ajuste para 7 com saldo 15 grava delta -8 e saldo_apos 7', async () => {
  const b = await nova({ estoqueQtd: 15 });
  const res = await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 7, motivo: 'Contagem' });
  assert.equal(res.status, 200);
  assert.equal(res.body.estoqueQtd, 7);
  const m = movimentos(b.id)[1];
  assert.deepEqual([m.tipo, m.quantidade, m.saldo_apos], ['AJUSTE', -8, 7]);
  assert.equal((await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 0, motivo: 'Zerou' })).body.estoqueQtd, 0);
});

test('saída/ajuste sem motivo (ou motivo inválido) → 400', async () => {
  const b = await nova();
  assert.equal((await mov(b.id, { tipo: 'SAIDA', quantidade: 1 })).status, 400);
  assert.equal((await mov(b.id, { tipo: 'SAIDA', quantidade: 1, motivo: '   ' })).status, 400);
  assert.equal((await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 3 })).status, 400);
  assert.equal((await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 3, motivo: 'x'.repeat(201) })).status, 400);
  assert.equal(saldo(b.id), 10);
});

test('tipo inválido e ajuste com novaQuantidade inválida → 400', async () => {
  const b = await nova();
  const invalidos = [{}, { tipo: 'VENDA', quantidade: 1 }, { tipo: 'ESTORNO', quantidade: 1 }, { tipo: 'AJUSTE', novaQuantidade: -1, motivo: 'm' },
    { tipo: 'AJUSTE', novaQuantidade: 1.5, motivo: 'm' }, { tipo: 'AJUSTE', motivo: 'm' }];
  for (const corpo of invalidos) assert.equal((await mov(b.id, corpo)).status, 400, JSON.stringify(corpo));
});

test('auditoria de toda movimentação avulsa', async () => {
  const b = await nova();
  await mov(b.id, { tipo: 'ENTRADA', quantidade: 1 });
  await mov(b.id, { tipo: 'SAIDA', quantidade: 1, motivo: 'm' });
  await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 3, motivo: 'm' });
  await mov(b.id, { tipo: 'SAIDA', quantidade: 99, motivo: 'm' }); // recusada: não audita
  const linhas = app.db.prepare("SELECT acao, usuario, descricao FROM auditoria WHERE entidade = 'estoque' ORDER BY id").all();
  assert.deepEqual(linhas.map((l) => l.acao), ['entrada', 'saida', 'ajuste']);
  assert.ok(linhas.every((l) => l.usuario === 'ADM' && l.descricao.includes('Coca-Cola')));
});

test('evento estoque publicado após o commit da movimentação avulsa', async () => {
  const b = await nova({ estoqueMinimo: 5 });
  const eventos = [];
  app.bus.subscribe((e) => eventos.push(e));
  await mov(b.id, { tipo: 'SAIDA', quantidade: 6, motivo: 'm' });
  assert.deepEqual(eventos.filter((e) => e.tipo === 'estoque'), [{ tipo: 'estoque', dados: { bebidaId: b.id, estoqueQtd: 4, critico: true } }]);
  await mov(b.id, { tipo: 'SAIDA', quantidade: 50, motivo: 'm' });
  assert.equal(eventos.filter((e) => e.tipo === 'estoque').length, 1);
});

test('GET movimentações: mais recente primeiro, limite padrão 50, máx. 500, inválido → 400', async () => {
  const b = await nova({ estoqueQtd: 0 });
  for (let i = 1; i <= 55; i += 1) await mov(b.id, { tipo: 'ENTRADA', quantidade: 1 });
  const padrao = (await get(`/api/bebidas/${b.id}/movimentacoes`)).body;
  assert.equal(padrao.length, 50);
  assert.equal(padrao[0].saldoApos, 55);
  assert.equal(padrao[49].saldoApos, 6);
  assert.deepEqual(Object.keys(padrao[0]).sort(), ['bebidaId', 'em', 'id', 'motivo', 'pedidoId', 'quantidade', 'saldoApos', 'tipo', 'usuario']);
  assert.equal((await get(`/api/bebidas/${b.id}/movimentacoes?limite=3`)).body.length, 3);
  assert.equal((await get(`/api/bebidas/${b.id}/movimentacoes?limite=500`)).body.length, 55);
  for (const limite of ['0', '-1', 'abc', '501', '1.5']) assert.equal((await get(`/api/bebidas/${b.id}/movimentacoes?limite=${limite}`)).status, 400, limite);
});

test('baixarParaPedido: 3 baixas de 4 num saldo de 10, a terceira falha e o saldo fica 2', async () => {
  const b = await nova();
  const pedidos = [novoPedido(), novoPedido(), novoPedido()];
  const eventos = [];
  assert.throws(() => {
    for (const p of pedidos) eventos.push(...baixar(p, [{ bebidaId: b.id, quantidade: 4 }]));
  }, (e) => e.status === 409 && /Estoque insuficiente: Coca-Cola \(saldo 2, pedido 4\)/.test(e.message));
  assert.equal(saldo(b.id), 2);
  assert.equal(eventos.length, 2);
  const vendas = movimentos(b.id).filter((m) => m.tipo === 'VENDA');
  assert.deepEqual(vendas.map((m) => [m.quantidade, m.saldo_apos, m.pedido_id, m.usuario]), [[-4, 6, pedidos[0], 'ADM'], [-4, 2, pedidos[1], 'ADM']]);
});

test('baixa devolve os eventos estoque e não publica sozinha', async () => {
  const b = await nova({ estoqueMinimo: 6 });
  const publicados = [];
  app.bus.subscribe((e) => publicados.push(e));
  const eventos = baixar(novoPedido(), [{ bebidaId: b.id, quantidade: 4 }]);
  assert.deepEqual(eventos, [{ bebidaId: b.id, estoqueQtd: 6, critico: true }]);
  assert.equal(publicados.length, 0);
});

test('baixa de várias bebidas em que só uma falha: erro lista a insuficiente e nada persiste na transação', async () => {
  const a = await nova({ nome: 'Coca-Cola', estoqueQtd: 2 });
  const c = await nova({ nome: 'Fanta', estoqueQtd: 10 });
  const d = await nova({ nome: 'Sprite', estoqueQtd: 1 });
  let erro;
  try {
    baixar(novoPedido(), [{ bebidaId: c.id, quantidade: 3 }, { bebidaId: a.id, quantidade: 3 }, { bebidaId: d.id, quantidade: 1 }]);
  } catch (e) { erro = e; }
  assert.equal(erro.status, 409);
  assert.equal(erro.message, 'Estoque insuficiente: Coca-Cola (saldo 2, pedido 3)');
  assert.deepEqual(erro.detalhes, [{ bebidaId: a.id, bebida: 'Coca-Cola', saldo: 2, pedido: 3, motivo: 'SALDO' }]);
  assert.deepEqual([saldo(a.id), saldo(c.id), saldo(d.id)], [2, 10, 1]);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM movimentacoes_estoque WHERE tipo = 'VENDA'").get().n, 0);
});

test('várias bebidas insuficientes aparecem todas na mensagem', async () => {
  const a = await nova({ nome: 'Coca-Cola', estoqueQtd: 2 });
  const c = await nova({ nome: 'Fanta', estoqueQtd: 0 });
  let erro;
  try {
    baixar(novoPedido(), [{ bebidaId: a.id, quantidade: 3 }, { bebidaId: c.id, quantidade: 1 }]);
  } catch (e) { erro = e; }
  assert.equal(erro.message, 'Estoque insuficiente: Coca-Cola (saldo 2, pedido 3); Fanta (saldo 0, pedido 1)');
  assert.equal(erro.detalhes.length, 2);
});

test('itens repetidos da mesma bebida somam na baixa', async () => {
  const b = await nova();
  baixar(novoPedido(), [{ bebidaId: b.id, quantidade: 2 }, { bebidaId: b.id, quantidade: 3 }]);
  assert.equal(saldo(b.id), 5);
  assert.equal(movimentos(b.id).filter((m) => m.tipo === 'VENDA').length, 1);
});

test('bebida inativa não pode ser baixada; inexistente e quantidade inválida também falham', async () => {
  const b = await nova();
  await app.request('PUT', `/api/bebidas/${b.id}`, { user: 'ADM', body: { ativo: false } });
  assert.throws(() => baixar(novoPedido(), [{ bebidaId: b.id, quantidade: 1 }]), falhaCom(409));
  assert.equal(saldo(b.id), 10);
  assert.throws(() => baixar(novoPedido(), [{ bebidaId: 999, quantidade: 1 }]), falhaCom(400));
  const ativa = await nova({ nome: 'Fanta' });
  for (const quantidade of [0, -1, 1.5]) assert.throws(() => baixar(novoPedido(), [{ bebidaId: ativa.id, quantidade }]), falhaCom(400));
});

test('estornarPedido devolve exatamente o que o pedido baixou; estornar duas vezes devolve só uma', async () => {
  const a = await nova({ nome: 'Coca-Cola' });
  const c = await nova({ nome: 'Fanta' });
  const pedido = novoPedido();
  baixar(pedido, [{ bebidaId: a.id, quantidade: 4 }, { bebidaId: c.id, quantidade: 2 }]);
  baixar(novoPedido(), [{ bebidaId: a.id, quantidade: 1 }]);
  assert.equal(estornar(pedido).length, 2);
  assert.deepEqual([saldo(a.id), saldo(c.id)], [9, 10]);
  assert.deepEqual(movimentos(a.id).filter((m) => m.tipo === 'ESTORNO').map((m) => [m.quantidade, m.saldo_apos, m.pedido_id]), [[4, 9, pedido]]);
  assert.deepEqual(estornar(pedido), []);
  assert.deepEqual([saldo(a.id), saldo(c.id)], [9, 10]);
  assert.equal(movimentos(a.id).filter((m) => m.tipo === 'ESTORNO').length, 1);
});

test('estornarPedido sem baixa prévia: nada a estornar, sem erro', async () => {
  const b = await nova();
  assert.deepEqual(estornar(novoPedido()), []);
  assert.equal(saldo(b.id), 10);
});

test('estornar bebida desativada depois da venda ainda devolve o saldo', async () => {
  const b = await nova();
  const pedido = novoPedido();
  baixar(pedido, [{ bebidaId: b.id, quantidade: 3 }]);
  await app.request('PUT', `/api/bebidas/${b.id}`, { user: 'ADM', body: { ativo: false } });
  estornar(pedido);
  assert.equal(saldo(b.id), 10);
});

const ABSURDOS = [1e20, Number.MAX_SAFE_INTEGER, 1_000_001];
const semEfeito = (id, saldoEsperado, movs) => {
  assert.equal(saldo(id), saldoEsperado);
  assert.equal(movimentos(id).length, movs);
};

test('quantidades absurdas (1e20, MAX_SAFE_INTEGER, 1.000.001) em ENTRADA, SAIDA e AJUSTE → 400, nada gravado, sem evento', async () => {
  const b = await nova({ estoqueQtd: 10 });
  const eventos = [];
  app.bus.subscribe((e) => eventos.push(e));
  for (const v of ABSURDOS) {
    assert.equal((await mov(b.id, { tipo: 'ENTRADA', quantidade: v })).status, 400, `ENTRADA ${v}`);
    assert.equal((await mov(b.id, { tipo: 'SAIDA', quantidade: v, motivo: 'm' })).status, 400, `SAIDA ${v}`);
    assert.equal((await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: v, motivo: 'm' })).status, 400, `AJUSTE ${v}`);
  }
  semEfeito(b.id, 10, 1);
  assert.equal(eventos.length, 0);
});

test('ENTRADA que estouraria o saldo máximo → 400 "Estoque máximo de 1.000.000 unidades", saldo intacto', async () => {
  const b = await nova({ estoqueQtd: 999_999 });
  const eventos = [];
  app.bus.subscribe((e) => eventos.push(e));
  const res = await mov(b.id, { tipo: 'ENTRADA', quantidade: 2 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Estoque máximo de 1\.000\.000 unidades/);
  semEfeito(b.id, 999_999, 1);
  assert.equal(eventos.length, 0);
  assert.equal((await mov(b.id, { tipo: 'ENTRADA', quantidade: 1 })).body.estoqueQtd, 1_000_000);
  assert.equal((await mov(b.id, { tipo: 'AJUSTE', novaQuantidade: 1_000_000, motivo: 'm' })).status, 200);
});

test('baixarParaPedido recusa quantidade acima do máximo ou não segura', async () => {
  const b = await nova();
  for (const quantidade of ABSURDOS) assert.throws(() => baixar(novoPedido(), [{ bebidaId: b.id, quantidade }]), falhaCom(400));
  semEfeito(b.id, 10, 1);
});

test('baixa de bebida inativa diz que está inativa e detalhes traz motivo INATIVA/SALDO', async () => {
  const inativa = await nova({ nome: 'Velha', estoqueQtd: 5 });
  const curta = await nova({ nome: 'Curta', estoqueQtd: 1 });
  await app.request('PUT', `/api/bebidas/${inativa.id}`, { user: 'ADM', body: { ativo: false } });
  let erro;
  try { baixar(novoPedido(), [{ bebidaId: inativa.id, quantidade: 1 }, { bebidaId: curta.id, quantidade: 2 }]); } catch (e) { erro = e; }
  assert.equal(erro.status, 409);
  assert.match(erro.message, /Bebida indisponível: Velha \(inativa\)/);
  assert.match(erro.message, /Estoque insuficiente: Curta \(saldo 1, pedido 2\)/);
  assert.deepEqual(erro.detalhes.map((d) => [d.bebida, d.motivo]), [['Velha', 'INATIVA'], ['Curta', 'SALDO']]);
});
