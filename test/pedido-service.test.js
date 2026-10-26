'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let B; let C; let eventos;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const usuario = (u) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(u);
  A = { ...usuario('ADM') };
  B = { ...usuario('ATEND') };
  C = { ...usuario('COZ') };
  eventos = [];
  app.bus.subscribe((e) => { if (e.tipo === 'pedido' || e.tipo === 'estoque') eventos.push(e); });
});
afterEach(async () => { await app.close(); });

const status = (fn) => { try { fn(); return 200; } catch (e) { if (!e.status) throw e; return e.status; } };
const erroDe = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('não falhou'); };

function cardapio({ estoque = 25 } = {}) {
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const cebola = s.ingredientes.create(A, { nome: 'Cebola', unidadeMedida: 'UN' });
  const bacon = s.ingredientes.create(A, { nome: 'Bacon', unidadeMedida: 'FATIA', podeSerAdicional: true, precoAdicionalCents: 400 });
  const burger = s.pratos.create(A, {
    nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: cebola.id, removivel: true, ordem: 0 }],
  });
  const batata = s.pratos.create(A, { nome: 'Batata', categoriaId: lanches.id, precoCents: 1200, tempoPreparoMin: 15, ingredientes: [{ ingredienteId: cebola.id }] });
  const coca = s.bebidas.create(A, { nome: 'Coca-Cola', precoCents: 600, estoqueQtd: estoque, estoqueMinimo: 0 });
  return { lanches, cebola, bacon, burger, batata, coca };
}
const prato = (p, extra = {}) => ({ tipo: 'PRATO', itemId: p.id, quantidade: 1, ...extra });
const bebida = (b, quantidade = 1) => ({ tipo: 'BEBIDA', itemId: b.id, quantidade });
const ANA = { nome: 'Ana', telefone: '(11) 99999-8888' };
const rascunho = (itens, cliente = ANA, user = B) => s.pedidos.criarRascunho(user, { cliente, itens });
const saldo = (b) => app.db.prepare('SELECT estoque_qtd FROM bebidas WHERE id = ?').get(b.id).estoque_qtd;
const movimentos = (pedidoId) => app.db.prepare('SELECT tipo, quantidade, pedido_id FROM movimentacoes_estoque WHERE pedido_id = ? ORDER BY id').all(pedidoId);
const auditoria = (acao) => app.db.prepare("SELECT * FROM auditoria WHERE entidade = 'pedido' AND acao = ?").all(acao);

test('rascunho: cria ABERTO com retrato dos itens e totais', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger, { quantidade: 2, adicionar: [{ ingredienteId: c.bacon.id, quantidade: 1 }] }), bebida(c.coca, 2)]);
  assert.equal(p.status, 'ABERTO');
  assert.deepEqual(p.cliente, { id: null, nome: 'Ana', telefone: '+5511999998888' });
  assert.equal(p.itens[0].nome, 'X-Burger');
  assert.equal(p.itens[0].adicionaisCents, 400);
  assert.equal(p.itens[0].totalCents, 5800);
  assert.equal(p.itens[1].tipo, 'BEBIDA');
  assert.equal(p.itens[1].tempoPreparoMin, 0);
  assert.equal(p.subtotalCents, 5800 + 1200);
  assert.equal(p.totalCents, 7000);
  assert.equal(p.confirmadoEm, null);
  assert.deepEqual(p.historico, []);
  assert.equal(saldo(c.coca), 25, 'rascunho não baixa estoque');
});

test('rascunho: bebida acima do saldo (soma das linhas) → 409 com a bebida e o saldo; tipo inválido → 400', () => {
  const c = cardapio({ estoque: 3 });
  const e = erroDe(() => rascunho([bebida(c.coca, 2), bebida(c.coca, 2)]));
  assert.equal(e.status, 409);
  assert.match(e.message, /Coca-Cola \(saldo 3, pedido 4\)/);
  assert.equal(status(() => rascunho([{ tipo: 'LANCHE', itemId: 1, quantidade: 1 }])), 400);
  assert.equal(status(() => rascunho([prato(c.burger)], { nome: 'Ana', telefone: '123' })), 400);
  assert.equal(status(() => rascunho([prato(c.burger)], { nome: 'x'.repeat(81), telefone: ANA.telefone })), 400);
});

test('atualizarRascunho substitui os itens inteiros e só vale em ABERTO', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  const novo = s.pedidos.atualizarRascunho(B, p.id, { itens: [bebida(c.coca, 3)], observacao: 'sem gelo' });
  assert.deepEqual(novo.itens.map((i) => [i.tipo, i.quantidade]), [['BEBIDA', 3]]);
  assert.equal(novo.observacao, 'sem gelo');
  assert.equal(novo.cliente.nome, 'Ana');
  s.pedidos.confirmar(B, p.id);
  assert.equal(status(() => s.pedidos.atualizarRascunho(B, p.id, { itens: [prato(c.burger)] })), 409);
});

test('confirmar sem nome ou sem telefone do cliente → 400', () => {
  const c = cardapio();
  const semCliente = rascunho([prato(c.burger)], null);
  const semFone = rascunho([prato(c.burger)], { nome: 'Ana' });
  for (const p of [semCliente, semFone]) {
    const e = erroDe(() => s.pedidos.confirmar(B, p.id));
    assert.equal(e.status, 400);
    assert.equal(e.message, 'Informe o nome e o telefone do cliente');
    assert.equal(s.pedidos.obter(B, p.id).status, 'ABERTO');
  }
});

test('confirmar sem itens → 400', () => {
  cardapio();
  const p = rascunho([]);
  assert.equal(status(() => s.pedidos.confirmar(B, p.id)), 400);
  assert.equal(s.pedidos.obter(B, p.id).status, 'ABERTO');
});

test('confirmar baixa o estoque das bebidas e grava VENDA com o pedido', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger), bebida(c.coca, 2), bebida(c.coca, 1)]);
  const conf = s.pedidos.confirmar(B, p.id);
  assert.equal(conf.status, 'RECEBIDO');
  assert.equal(conf.confirmadoEm, new Date(app.relogio.now()).toISOString());
  assert.equal(saldo(c.coca), 22);
  assert.deepEqual(movimentos(p.id).map((m) => ({ ...m })), [{ tipo: 'VENDA', quantidade: -3, pedido_id: p.id }]);
  assert.deepEqual(conf.historico.map((h) => [h.de, h.para, h.usuario]), [['ABERTO', 'RECEBIDO', 'ATEND']]);
});

test('confirmar com bebida acima do saldo → 409 listando a bebida, estoque e status intactos', () => {
  const c = cardapio({ estoque: 5 });
  const p = rascunho([bebida(c.coca, 4)]);
  s.estoque.movimentar(A, c.coca.id, { tipo: 'SAIDA', quantidade: 3, motivo: 'quebra' });
  const e = erroDe(() => s.pedidos.confirmar(B, p.id));
  assert.equal(e.status, 409);
  assert.match(e.message, /Coca-Cola \(saldo 2, pedido 4\)/);
  assert.equal(saldo(c.coca), 2);
  const depois = s.pedidos.obter(B, p.id);
  assert.equal(depois.status, 'ABERTO');
  assert.equal(depois.cliente.id, null, 'cliente não fica gravado');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 0);
  assert.deepEqual(depois.historico, []);
});

test('confirmar duas vezes o mesmo pedido → 409 e estoque baixado uma vez', () => {
  const c = cardapio();
  const p = rascunho([bebida(c.coca, 2)]);
  s.pedidos.confirmar(B, p.id);
  assert.equal(status(() => s.pedidos.confirmar(B, p.id)), 409);
  assert.equal(saldo(c.coca), 23);
  assert.equal(movimentos(p.id).length, 1);
});

test('10 pedidos de 3 unidades num estoque de 25: 8 passam, o 9º falha, saldo final 1, nunca negativo', () => {
  const c = cardapio({ estoque: 25 });
  const pedidos = Array.from({ length: 10 }, () => rascunho([bebida(c.coca, 3)]));
  const resultados = pedidos.map((p) => {
    const r = status(() => s.pedidos.confirmar(B, p.id));
    assert.ok(saldo(c.coca) >= 0);
    return r;
  });
  assert.deepEqual(resultados, [200, 200, 200, 200, 200, 200, 200, 200, 409, 409]);
  assert.equal(saldo(c.coca), 1);
  assert.equal(s.pedidos.obter(B, pedidos[8].id).status, 'ABERTO');
});

test('reabrir estorna o estoque e volta a ABERTO', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger), bebida(c.coca, 4)]);
  s.pedidos.confirmar(B, p.id);
  const r = s.pedidos.reabrir(B, p.id);
  assert.equal(r.status, 'ABERTO');
  assert.equal(r.confirmadoEm, null);
  assert.equal(r.tempoEstimadoMin, 10, 'rascunho: estimativa calculada na leitura');
  assert.equal(saldo(c.coca), 25);
  assert.deepEqual(movimentos(p.id).map((m) => [m.tipo, m.quantidade]), [['VENDA', -4], ['ESTORNO', 4]]);
  assert.deepEqual(r.historico.map((h) => [h.de, h.para]), [['ABERTO', 'RECEBIDO'], ['RECEBIDO', 'ABERTO']]);
  s.pedidos.confirmar(B, p.id);
  assert.equal(saldo(c.coca), 21);
  s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
  assert.equal(status(() => s.pedidos.reabrir(B, p.id)), 409);
});

test('cancelar RECEBIDO estorna; cancelar ABERTO não mexe no estoque; cancelar FINALIZADO → 409', () => {
  const c = cardapio();
  const recebido = rascunho([bebida(c.coca, 5)]);
  s.pedidos.confirmar(B, recebido.id);
  const cancelado = s.pedidos.cancelar(B, recebido.id, 'cliente desistiu');
  assert.equal(cancelado.status, 'CANCELADO');
  assert.equal(cancelado.motivoCancelamento, 'cliente desistiu');
  assert.equal(cancelado.canceladoPor, B.id);
  assert.equal(saldo(c.coca), 25);
  assert.deepEqual(cancelado.historico.at(-1).para, 'CANCELADO');

  const aberto = rascunho([bebida(c.coca, 5)]);
  s.pedidos.cancelar(B, aberto.id, 'erro');
  assert.equal(movimentos(aberto.id).length, 0);
  assert.equal(status(() => s.pedidos.cancelar(B, aberto.id, 'de novo')), 409);

  const fim = rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, fim.id);
  for (const st of ['EM_PREPARO', 'PRONTO_RETIRADA', 'FINALIZADO']) s.pedidos.mudarStatus(A, fim.id, st);
  assert.equal(status(() => s.pedidos.cancelar(A, fim.id, 'tarde')), 409);
});

test('cancelar exige motivo 1–200', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  for (const motivo of [undefined, '', '   ', 'x'.repeat(201), 5]) assert.equal(status(() => s.pedidos.cancelar(B, p.id, motivo)), 400);
  assert.equal(s.pedidos.cancelar(B, p.id, 'x'.repeat(200)).status, 'CANCELADO');
});

test('mudarStatus grava histórico (anterior, novo, usuário, instante) na mesma transação; falha forçada no histórico reverte o status', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, p.id);
  app.relogio.advance(60000);
  const r = s.pedidos.mudarStatus(C, p.id, 'EM_PREPARO');
  assert.deepEqual(r.historico.at(-1), { de: 'RECEBIDO', para: 'EM_PREPARO', usuario: 'COZ', em: new Date(app.relogio.now()).toISOString() });

  const repo = app.app.repositories.pedidos;
  const original = repo.registrarHistorico;
  repo.registrarHistorico = () => { throw new Error('falha forçada'); };
  eventos.length = 0;
  assert.throws(() => s.pedidos.mudarStatus(C, p.id, 'PRONTO_RETIRADA'), /falha forçada/);
  repo.registrarHistorico = original;
  assert.equal(s.pedidos.obter(B, p.id).status, 'EM_PREPARO');
  assert.equal(s.pedidos.obter(B, p.id).historico.length, 2);
  assert.deepEqual(eventos, []);
});

test('mudarStatus inválido (RECEBIDO→FINALIZADO) → 409', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, p.id);
  assert.equal(status(() => s.pedidos.mudarStatus(A, p.id, 'FINALIZADO')), 409);
  for (const alvo of ['ABERTO', 'RECEBIDO', 'CANCELADO', 'XYZ']) {
    const e = erroDe(() => s.pedidos.mudarStatus(A, p.id, alvo));
    assert.equal(e.status, 400);
    assert.equal(e.message, 'Use confirmar, reabrir ou cancelar');
  }
  assert.equal(status(() => s.pedidos.mudarStatus(A, 999, 'EM_PREPARO')), 404);
});

test('nível C não confirma/cancela/reabre (403) e muda RECEBIDO→EM_PREPARO', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  assert.equal(status(() => s.pedidos.criarRascunho(C, { itens: [] })), 403);
  assert.equal(status(() => s.pedidos.atualizarRascunho(C, p.id, { itens: [] })), 403);
  assert.equal(status(() => s.pedidos.confirmar(C, p.id)), 403);
  s.pedidos.confirmar(B, p.id);
  assert.equal(status(() => s.pedidos.reabrir(C, p.id)), 403);
  assert.equal(status(() => s.pedidos.cancelar(C, p.id, 'x')), 403);
  assert.equal(status(() => s.pedidos.mudarStatus(B, p.id, 'EM_PREPARO')), 403, 'B não faz transição da cozinha');
  assert.equal(s.pedidos.mudarStatus(C, p.id, 'EM_PREPARO').status, 'EM_PREPARO');
  assert.equal(s.pedidos.mudarStatus(C, p.id, 'PRONTO_ENTREGA').status, 'PRONTO_ENTREGA');
  assert.equal(s.pedidos.mudarStatus(B, p.id, 'FINALIZADO').status, 'FINALIZADO');
});

test('tempoEstimadoMin = máximo dos pratos', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger, { quantidade: 3 }), prato(c.batata), bebida(c.coca)]);
  assert.equal(p.tempoEstimadoMin, 15);
  assert.equal(s.pedidos.confirmar(B, p.id).tempoEstimadoMin, 15);
  assert.equal(rascunho([bebida(c.coca)]).tempoEstimadoMin, 0);
});

test('tempoEstimadoMin com SOMA em cozinha.estimativa', () => {
  const c = cardapio();
  assert.equal(s.config.get('cozinha.estimativa'), 'MAXIMO');
  s.config.set(A, 'cozinha.estimativa', 'SOMA');
  assert.equal(status(() => s.config.set(A, 'cozinha.estimativa', 'MEDIA')), 400);
  const p = rascunho([prato(c.burger, { quantidade: 3 }), prato(c.batata)]);
  assert.equal(s.pedidos.confirmar(B, p.id).tempoEstimadoMin, 45);
  s.config.set(A, 'cozinha.estimativa', 'MAXIMO');
  assert.equal(s.pedidos.obter(B, p.id).tempoEstimadoMin, 45, 'confirmado: valor gravado');
});

test('prato com tempo de preparo inválido no banco → erro claro, nada gravado', () => {
  const c = cardapio();
  app.db.connection.exec('PRAGMA ignore_check_constraints = ON');
  app.db.prepare('UPDATE pratos SET tempo_preparo_min = 0 WHERE id = ?').run(c.burger.id);
  app.db.connection.exec('PRAGMA ignore_check_constraints = OFF');
  const e = erroDe(() => rascunho([prato(c.burger)]));
  assert.equal(e.status, 409);
  assert.match(e.message, /tempo de preparo/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n, 0);
});

test('quantidadeTotal soma as quantidades', () => {
  const c = cardapio();
  assert.equal(rascunho([prato(c.burger, { quantidade: 2 }), bebida(c.coca, 3)]).quantidadeTotal, 5);
});

test('preço do cliente ignorado e retrato mantido ao mudar o preço do prato/bebida depois', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger, { precoUnitCents: 1, remover: [c.cebola.id] }), { ...bebida(c.coca), precoCents: 1 }]);
  assert.equal(p.itens[0].precoUnitCents, 2500);
  assert.equal(p.itens[1].precoUnitCents, 600);
  s.pratos.update(A, c.burger.id, { precoCents: 9999, nome: 'X-Novo' });
  s.bebidas.update(A, c.coca.id, { nome: 'Coca Nova', precoCents: 999, estoqueMinimo: 0, ativo: true });
  const depois = s.pedidos.obter(B, p.id);
  assert.deepEqual(depois.itens.map((i) => [i.nome, i.precoUnitCents, i.tempoPreparoMin]), [['X-Burger', 2500, 10], ['Coca-Cola', 600, 0]]);
  assert.deepEqual(depois.itens[0].modificacoes.map((m) => [m.ingredienteNome, m.tipo]), [['Cebola', 'REMOVER']]);
  assert.equal(depois.totalCents, 3100);
});

test('prato inativo e bebida inativa não podem ser pedidos', () => {
  const c = cardapio();
  s.pratos.update(A, c.burger.id, { ativo: false });
  let e = erroDe(() => rascunho([prato(c.burger)]));
  assert.equal(e.status, 409);
  assert.match(e.message, /X-Burger.*inativo/);
  s.bebidas.update(A, c.coca.id, { nome: 'Coca-Cola', precoCents: 600, estoqueMinimo: 0, ativo: false });
  e = erroDe(() => rascunho([bebida(c.coca)]));
  assert.equal(e.status, 409);
  assert.match(e.message, /Coca-Cola.*inativa/);
  s.categorias.update(A, c.lanches.id, { nome: 'Lanches', ativo: false });
  assert.equal(status(() => rascunho([prato(c.batata)])), 409);
  assert.equal(status(() => rascunho([{ tipo: 'BEBIDA', itemId: 999, quantidade: 1 }])), 400);
});

test('número do pedido é o id e cresce', () => {
  const c = cardapio();
  const ids = Array.from({ length: 5 }, () => rascunho([prato(c.burger)]).id);
  assert.deepEqual(ids, [ids[0], ids[0] + 1, ids[0] + 2, ids[0] + 3, ids[0] + 4]);
});

test('cliente é criado/atualizado pelo telefone ao confirmar e o pedido guarda o retrato do nome/telefone', () => {
  const c = cardapio();
  const p1 = rascunho([prato(c.burger)], { nome: 'Ana', telefone: '11999998888' });
  const c1 = s.pedidos.confirmar(B, p1.id).cliente;
  assert.equal(c1.telefone, '+5511999998888');
  assert.ok(c1.id);
  const p2 = rascunho([prato(c.burger)], { nome: 'Ana Maria', telefone: '+55 (11) 99999-8888' });
  const c2 = s.pedidos.confirmar(B, p2.id).cliente;
  assert.equal(c2.id, c1.id);
  assert.equal(app.db.prepare('SELECT nome FROM clientes WHERE id = ?').get(c1.id).nome, 'Ana Maria');
  assert.equal(s.pedidos.obter(B, p1.id).cliente.nome, 'Ana', 'retrato do pedido antigo');
  assert.equal(s.pedidos.obter(B, p2.id).cliente.nome, 'Ana Maria');
});

test('eventos pedido/estoque só após o commit (nenhum evento quando a transação falha)', () => {
  const c = cardapio({ estoque: 2 });
  const ok = rascunho([bebida(c.coca, 2)]);
  const falha = rascunho([bebida(c.coca, 1)]);
  eventos.length = 0;
  let durante = null;
  app.bus.subscribe((e) => { if (e.tipo === 'pedido') durante = app.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(e.dados.id).status; });
  s.pedidos.confirmar(B, ok.id);
  assert.equal(durante, 'RECEBIDO', 'evento publicado com o commit já feito');
  assert.deepEqual(eventos.map((e) => [e.tipo, e.dados.bebidaId ?? e.dados.id, e.dados.estoqueQtd ?? e.dados.status]), [
    ['estoque', c.coca.id, 0],
    ['pedido', ok.id, 'RECEBIDO'],
  ]);
  eventos.length = 0;
  assert.equal(status(() => s.pedidos.confirmar(B, falha.id)), 409);
  assert.deepEqual(eventos, []);
});

test('aposMudarStatus chamado só depois do commit, com o pedido atualizado', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  const chamadas = [];
  s.pedidos.aposMudarStatus = (pedido, user) => {
    const gravado = app.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedido.id).status;
    chamadas.push([pedido.status, gravado, user.usuario, app.db.inTransaction]);
  };
  s.pedidos.confirmar(B, p.id);
  s.pedidos.mudarStatus(C, p.id, 'EM_PREPARO');
  assert.deepEqual(chamadas, [['RECEBIDO', 'RECEBIDO', 'ATEND', false], ['EM_PREPARO', 'EM_PREPARO', 'COZ', false]]);
  s.pedidos.atualizarRascunho(B, rascunho([]).id, { itens: [] });
  assert.equal(chamadas.length, 2, 'rascunho não chama a porta');
});

test('exceção em aposMudarStatus não derruba a confirmação e é registrada', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  s.pedidos.aposMudarStatus = () => { throw new Error('whatsapp fora'); };
  assert.equal(s.pedidos.confirmar(B, p.id).status, 'RECEBIDO');
  assert.equal(s.pedidos.obter(B, p.id).status, 'RECEBIDO');
  assert.ok(app.erros.some((e) => /whatsapp fora/.test(String(e?.message ?? e))));
});

test('auditoria de criar/confirmar/reabrir/cancelar/mudarStatus', () => {
  const c = cardapio();
  const p = rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, p.id);
  s.pedidos.reabrir(B, p.id);
  s.pedidos.confirmar(B, p.id);
  s.pedidos.mudarStatus(C, p.id, 'EM_PREPARO');
  s.pedidos.cancelar(A, p.id, 'faltou pão');
  assert.equal(auditoria('criar').length, 1);
  assert.equal(auditoria('confirmar').length, 2);
  assert.equal(auditoria('reabrir').length, 1);
  assert.equal(auditoria('mudar_status').length, 1);
  const [cancelar] = auditoria('cancelar');
  assert.match(cancelar.descricao, new RegExp(`Pedido ${p.id} cancelado: faltou pão`));
  assert.equal(cancelar.usuario, 'ADM');
});

test('listar: hoje por padrão, id crescente, filtros de status e busca por número, nome e telefone nacional', () => {
  const c = cardapio();
  const ana = rascunho([prato(c.burger)], { nome: 'Ána Souza', telefone: '(21) 98888-7777' });
  const bia = rascunho([prato(c.burger)], { nome: 'Bia', telefone: '(11) 95555-1234' });
  s.pedidos.confirmar(B, bia.id);
  const ids = (filtros) => s.pedidos.listar(B, filtros).map((p) => p.id);
  assert.deepEqual(ids(), [ana.id, bia.id]);
  assert.deepEqual(ids({ status: 'RECEBIDO' }), [bia.id]);
  assert.ok(ids({ q: String(ana.id) }).includes(ana.id), 'número exato do pedido');
  assert.deepEqual(ids({ q: '7' }), [ana.id], 'só o telefone nacional da Ana tem 7 (nenhum id é 7)');
  assert.deepEqual(ids({ q: 'ana' }), [ana.id]);
  assert.deepEqual(ids({ q: '98888' }), [ana.id]);
  assert.deepEqual(ids({ q: '5511955' }), [bia.id]);
  assert.deepEqual(ids({ q: '55' }), [bia.id], '"55" não casa o +55 de todos');
  assert.deepEqual(ids({ limite: 1 }), [ana.id]);
  assert.deepEqual(ids({ de: '2000-01-01', ate: '2000-01-02' }), []);
  assert.equal(status(() => s.pedidos.listar(B, { limite: 1001 })), 400);
  assert.equal(status(() => s.pedidos.listar(B, { status: 'PAGO' })), 400);
  const linha = s.pedidos.listar(B, { q: String(bia.id) }).find((p) => p.id === bia.id);
  assert.equal(linha.itens.length, 1);
  assert.equal(linha.historico.length, 1);
});

test('listarCozinha: só RECEBIDO/EM_PREPARO/PRONTO_* por confirmação; C obtém só pedidos da cozinha', () => {
  const c = cardapio();
  const p1 = rascunho([prato(c.burger)]);
  const p2 = rascunho([prato(c.burger)]);
  const p3 = rascunho([prato(c.burger)]);
  rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, p2.id);
  app.relogio.advance(1000);
  s.pedidos.confirmar(B, p1.id);
  s.pedidos.confirmar(B, p3.id);
  s.pedidos.cancelar(B, p3.id, 'x');
  s.pedidos.mudarStatus(C, p1.id, 'EM_PREPARO');
  assert.deepEqual(s.pedidos.listarCozinha(C).map((p) => [p.id, p.status]), [[p2.id, 'RECEBIDO'], [p1.id, 'EM_PREPARO']]);
  assert.equal(s.pedidos.obter(C, p1.id).id, p1.id);
  assert.equal(status(() => s.pedidos.obter(C, p3.id)), 403);
  assert.equal(status(() => s.pedidos.obter(B, 999)), 404);
});

test('leitura autorizada no serviço: listar só A/B; obter C só pedidos da cozinha; usuário ausente/sem nível → 403', () => {
  const c = cardapio();
  const rasc = rascunho([prato(c.burger)]);
  const preparo = rascunho([prato(c.burger)]);
  const fim = rascunho([prato(c.burger)]);
  s.pedidos.confirmar(B, preparo.id);
  s.pedidos.mudarStatus(C, preparo.id, 'EM_PREPARO');
  s.pedidos.confirmar(B, fim.id);
  for (const st of ['EM_PREPARO', 'PRONTO_RETIRADA', 'FINALIZADO']) s.pedidos.mudarStatus(A, fim.id, st);

  assert.equal(status(() => s.pedidos.listar(C)), 403);
  assert.equal(status(() => s.pedidos.obter(C, rasc.id)), 403);
  assert.equal(status(() => s.pedidos.obter(C, fim.id)), 403);
  assert.equal(s.pedidos.obter(C, preparo.id).status, 'EM_PREPARO');
  for (const u of [null, undefined, {}, { nivel: 'X' }]) {
    assert.equal(status(() => s.pedidos.listar(u)), 403);
    assert.equal(status(() => s.pedidos.obter(u, preparo.id)), 403);
    assert.equal(status(() => s.pedidos.listarCozinha(u)), 403);
  }
  for (const u of [A, B]) {
    assert.equal(s.pedidos.listar(u).length, 3);
    assert.equal(s.pedidos.obter(u, rasc.id).id, rasc.id);
    assert.equal(s.pedidos.obter(u, fim.id).id, fim.id);
    assert.deepEqual(s.pedidos.listarCozinha(u).map((p) => p.id), [preparo.id]);
  }
  assert.deepEqual(s.pedidos.listarCozinha(C).map((p) => p.id), [preparo.id]);
});

test('confirmar com duas bebidas e a SEGUNDA sem saldo → 409; a primeira volta ao saldo original, sem VENDA nem cliente', () => {
  const c = cardapio({ estoque: 10 });
  const fanta = s.bebidas.create(A, { nome: 'Fanta', precoCents: 500, estoqueQtd: 1, estoqueMinimo: 0 });
  const p = rascunho([bebida(c.coca, 3), bebida(fanta, 1)]);
  s.estoque.movimentar(A, fanta.id, { tipo: 'SAIDA', quantidade: 1, motivo: 'quebra' });
  const e = erroDe(() => s.pedidos.confirmar(B, p.id));
  assert.equal(e.status, 409);
  assert.match(e.message, /Fanta/);
  assert.equal(saldo(c.coca), 10);
  assert.equal(saldo(fanta), 0);
  assert.equal(movimentos(p.id).length, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 0);
  assert.equal(s.pedidos.obter(B, p.id).status, 'ABERTO');
});

test('cancelar depois de reabrir não estorna duas vezes', () => {
  const c = cardapio({ estoque: 10 });
  const p = rascunho([bebida(c.coca, 4)]);
  s.pedidos.confirmar(B, p.id);
  s.pedidos.reabrir(B, p.id);
  s.pedidos.cancelar(B, p.id, 'desistiu');
  assert.equal(saldo(c.coca), 10);
  assert.deepEqual(movimentos(p.id).map((m) => [m.tipo, m.quantidade]), [['VENDA', -4], ['ESTORNO', 4]]);
});

test('falha forçada de audit.record em confirmar reverte estoque, status, cliente e histórico', () => {
  const c = cardapio({ estoque: 10 });
  const p = rascunho([prato(c.burger), bebida(c.coca, 2)]);
  const original = s.audit.record;
  s.audit.record = function (entrada) {
    if (entrada.acao === 'confirmar') throw new Error('auditoria fora');
    return original.call(this, entrada);
  };
  eventos.length = 0;
  assert.throws(() => s.pedidos.confirmar(B, p.id), /auditoria fora/);
  s.audit.record = original;
  const depois = s.pedidos.obter(B, p.id);
  assert.equal(depois.status, 'ABERTO');
  assert.equal(depois.cliente.id, null);
  assert.deepEqual(depois.historico, []);
  assert.equal(saldo(c.coca), 10);
  assert.equal(movimentos(p.id).length, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 0);
  assert.deepEqual(eventos, []);
});