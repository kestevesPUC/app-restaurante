'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');

let app; let s; let A; let B; let eventos;
const DIA = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  app = await createTestApp();
  s = app.app.services;
  const usuario = (u) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(u);
  A = { ...usuario('ADM') };
  B = { ...usuario('ATEND') };
  eventos = [];
  app.bus.subscribe((e) => { if (e.tipo === 'pedido') eventos.push(e.dados); });
});
afterEach(async () => { await app.close(); });

const status = (fn) => { try { fn(); return 200; } catch (e) { if (!e.status) throw e; return e.status; } };

function cardapio() {
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const bebidas = s.categorias.create(A, { nome: 'Bebidas', vaiParaCozinha: false });
  const cebola = s.ingredientes.create(A, { nome: 'Cebola', unidadeMedida: 'UN' });
  const bacon = s.ingredientes.create(A, { nome: 'Bacon', unidadeMedida: 'FATIA', podeSerAdicional: true, precoAdicionalCents: 400 });
  const burger = s.pratos.create(A, {
    nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: cebola.id, removivel: true, ordem: 0 }],
  });
  const suco = s.pratos.create(A, { nome: 'Suco', categoriaId: bebidas.id, precoCents: 800, tempoPreparoMin: 2, ingredientes: [{ ingredienteId: cebola.id }] });
  return { lanches, bebidas, cebola, bacon, burger, suco };
}
const it = (prato, extra = {}) => ({ pratoId: prato.id, quantidade: 1, remover: [], adicionar: [], ...extra });
const balcao = (c, itens = [it(c.burger)]) => s.pedidos.criar(B, { tipo: 'BALCAO', clienteNome: 'Ana', itens });
const mesa = (numero = '1') => s.mesas.create(A, { numero, capacidade: 4 });

test('numero_dia é sequencial no dia e volta a 1 no dia seguinte', () => {
  const c = cardapio();
  assert.equal(balcao(c).numeroDia, 1);
  assert.equal(balcao(c).numeroDia, 2);
  app.relogio.advance(DIA);
  const p = balcao(c);
  assert.equal(p.numeroDia, 1);
  assert.match(p.dataLocal, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.criadoEm, new Date(app.relogio.now()).toISOString());
});

test('50 pedidos criados em sequência no mesmo instante recebem 1..50 sem repetição', () => {
  const c = cardapio();
  const numeros = Array.from({ length: 50 }, () => balcao(c).numeroDia);
  assert.deepEqual(numeros, Array.from({ length: 50 }, (_, i) => i + 1));
});

test('retrato: mudar o preço do prato depois não altera o item gravado', () => {
  const c = cardapio();
  const p = balcao(c, [it(c.burger, { quantidade: 2, remover: [c.cebola.id], adicionar: [{ ingredienteId: c.bacon.id, quantidade: 1 }] })]);
  s.pratos.update(A, c.burger.id, { precoCents: 9999, nome: 'X-Novo' });
  s.ingredientes.update(A, c.bacon.id, { precoAdicionalCents: 1000, nome: 'Bacon2' });
  const item = s.pedidos.obter(p.id).itens[0];
  assert.equal(item.pratoNome, 'X-Burger');
  assert.equal(item.precoUnitCents, 2500);
  assert.equal(item.adicionaisCents, 400);
  assert.equal(item.totalCents, 5800);
  const add = item.modificacoes.find((m) => m.tipo === 'ADICIONAR');
  assert.deepEqual([add.ingredienteNome, add.precoUnitCents], ['Bacon', 400]);
  const rem = item.modificacoes.find((m) => m.tipo === 'REMOVER');
  assert.deepEqual([rem.ingredienteNome, rem.quantidade, rem.precoUnitCents], ['Cebola', 1, 0]);
  assert.equal(s.pedidos.obter(p.id).totalCents, 5800);
});

test('preço enviado pelo cliente é ignorado', () => {
  const c = cardapio();
  const p = balcao(c, [it(c.burger, { precoCents: 1, precoUnitCents: 1, totalCents: 1, adicionar: [{ ingredienteId: c.bacon.id, quantidade: 1, precoUnitCents: 1 }] })]);
  assert.equal(p.itens[0].precoUnitCents, 2500);
  assert.equal(p.itens[0].totalCents, 2900);
  assert.equal(p.totalCents, 2900);
});

test('prato inativo, categoria inativa ou adicional não permitido não podem ser pedidos', () => {
  const c = cardapio();
  s.pratos.desativar(A, c.suco.id);
  assert.equal(status(() => balcao(c, [it(c.suco)])), 409);
  s.categorias.update(A, c.lanches.id, { ativo: false });
  assert.equal(status(() => balcao(c, [it(c.burger)])), 409);
  s.categorias.update(A, c.lanches.id, { ativo: true });
  assert.equal(status(() => balcao(c, [it(c.burger, { adicionar: [{ ingredienteId: c.cebola.id, quantidade: 1 }] })])), 400);
  s.ingredientes.update(A, c.bacon.id, { ativo: false });
  assert.equal(status(() => balcao(c, [it(c.burger, { adicionar: [{ ingredienteId: c.bacon.id, quantidade: 1 }] })])), 400);
  assert.equal(status(() => balcao(c, [it({ id: 999 })])), 400);
});

test('abrir comanda em mesa livre deixa a mesa OCUPADA', () => {
  const c = cardapio();
  const m = mesa();
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [it(c.burger)] });
  assert.equal(p.tipo, 'MESA');
  assert.equal(p.mesaId, m.id);
  assert.equal(app.app.repositories.mesas.findById(m.id).situacao, 'OCUPADA');
});

test('mesa já ocupada à mão aceita a comanda; mesa inativa → 409', () => {
  const m = mesa();
  s.mesas.ocupar(B, m.id);
  assert.equal(s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [] }).situacao, 'ABERTO');
  const inativa = s.mesas.create(A, { numero: '9', capacidade: 2, ativo: false });
  assert.equal(status(() => s.pedidos.criar(B, { tipo: 'MESA', mesaId: inativa.id, itens: [] })), 409);
});

test('segunda comanda na mesma mesa → 409', () => {
  const m = mesa();
  s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [] });
  assert.equal(status(() => s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [] })), 409);
  // O índice único parcial também barra direto no banco.
  assert.throws(() => app.db.prepare("INSERT INTO pedidos (data_local, numero_dia, tipo, mesa_id, criado_por, criado_em) VALUES ('2000-01-01', 1, 'MESA', ?, ?, 'x')").run(m.id, A.id), /UNIQUE/);
});

test('enviarCozinha cria a rodada 1 e depois a 2 com os itens pendentes', () => {
  const c = cardapio();
  const p = balcao(c);
  const r1 = s.pedidos.enviarCozinha(B, p.id);
  assert.equal(r1.rodada, 1);
  assert.equal(r1.cozinhaSituacao, 'NA_FILA');
  assert.equal(r1.vaiParaCozinha, true);
  s.pedidos.adicionarItens(B, p.id, [it(c.suco), it(c.burger)]);
  const r2 = s.pedidos.enviarCozinha(B, p.id);
  assert.equal(r2.rodada, 2);
  const o = s.pedidos.obter(p.id);
  assert.deepEqual(o.itens.map((i) => i.envioId), [r1.id, r2.id, r2.id]);
  assert.equal(o.envios.length, 2);
});

test('enviarCozinha sem itens pendentes → 400', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.enviarCozinha(B, p.id);
  assert.equal(status(() => s.pedidos.enviarCozinha(B, p.id)), 400);
});

test('rodada só com bebidas (categoria sem cozinha) tem vai_para_cozinha = 0', () => {
  const c = cardapio();
  const p = balcao(c, [it(c.suco)]);
  const r = s.pedidos.enviarCozinha(B, p.id);
  assert.equal(r.vaiParaCozinha, false);
  assert.equal(app.db.prepare('SELECT vai_para_cozinha FROM pedido_envios WHERE id = ?').get(r.id).vai_para_cozinha, 0);
});

test('substituirPendentes não altera item já enviado', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.enviarCozinha(B, p.id);
  s.pedidos.adicionarItens(B, p.id, [it(c.suco)]);
  const o = s.pedidos.substituirPendentes(B, p.id, { clienteNome: 'Bia', observacao: 'sem pressa', itens: [it(c.suco, { quantidade: 3 })] });
  assert.equal(o.itens.length, 2);
  assert.equal(o.itens[0].pratoNome, 'X-Burger');
  assert.notEqual(o.itens[0].envioId, null);
  assert.deepEqual([o.itens[1].pratoNome, o.itens[1].quantidade, o.itens[1].envioId], ['Suco', 3, null]);
  assert.equal(o.clienteNome, 'Bia');
  assert.equal(o.observacao, 'sem pressa');
  assert.equal(o.totalCents, 2500 + 2400);
});

test('cancelarItem exige motivo, tira o item do subtotal e mantém a linha', () => {
  const c = cardapio();
  const p = balcao(c, [it(c.burger), it(c.suco)]);
  assert.equal(status(() => s.pedidos.cancelarItem(B, p.id, p.itens[0].id, 'x')), 400); // pendente
  s.pedidos.enviarCozinha(B, p.id);
  assert.equal(status(() => s.pedidos.cancelarItem(B, p.id, p.itens[0].id, '  ')), 400);
  assert.equal(status(() => s.pedidos.cancelarItem(B, p.id, p.itens[0].id, 'a'.repeat(201))), 400);
  const o = s.pedidos.cancelarItem(B, p.id, p.itens[0].id, 'cliente desistiu');
  assert.equal(o.itens.length, 2);
  assert.equal(o.itens[0].motivoCancelamento, 'cliente desistiu');
  assert.equal(o.itens[0].canceladoPor, B.id);
  assert.equal(o.subtotalCents, 800);
  assert.equal(o.totalCents, 800);
});

test('finalizar comanda com itens pendentes → 409', () => {
  const c = cardapio();
  const m = mesa();
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [it(c.burger)] });
  assert.equal(status(() => s.pedidos.finalizar(B, p.id)), 409);
  s.pedidos.enviarCozinha(B, p.id);
  const f = s.pedidos.finalizar(B, p.id);
  assert.equal(f.situacao, 'AGUARDANDO_PAGAMENTO');
  assert.equal(f.totalCents, 2500);
  assert.equal(s.pedidos.reabrir(B, p.id).situacao, 'ABERTO');
});

test('finalizar quando todos os itens estão cancelados → 400 (total zero)', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.enviarCozinha(B, p.id);
  s.pedidos.cancelarItem(B, p.id, p.itens[0].id, 'erro');
  assert.equal(status(() => s.pedidos.finalizar(B, p.id)), 400);
  const vazio = s.pedidos.criar(B, { tipo: 'BALCAO', clienteNome: 'Zé', itens: [] });
  assert.equal(status(() => s.pedidos.finalizar(B, vazio.id)), 400);
});

test('balcão com cozinha.enviar_em=FINALIZADO cria rodada ao finalizar; com PAGO não cria', () => {
  const c = cardapio();
  const p1 = balcao(c);
  assert.equal(s.pedidos.finalizar(B, p1.id).envios.length, 0); // padrão PAGO
  s.config.set(A, 'cozinha.enviar_em', 'FINALIZADO');
  const p2 = balcao(c);
  const f = s.pedidos.finalizar(B, p2.id);
  assert.equal(f.envios.length, 1);
  assert.equal(f.itens[0].envioId, f.envios[0].id);
});

test('reabrir com pagamento pendente → 409', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.finalizar(B, p.id);
  s.pedidos.temPagamentoPendente = () => true;
  assert.equal(status(() => s.pedidos.reabrir(B, p.id)), 409);
});

test('cancelar pedido PAGO por nível B → 403, por A com motivo → ok', () => {
  const c = cardapio();
  const p = balcao(c);
  app.db.prepare("UPDATE pedidos SET situacao = 'PAGO' WHERE id = ?").run(p.id);
  assert.equal(status(() => s.pedidos.cancelar(B, p.id, 'erro')), 403);
  assert.equal(status(() => s.pedidos.cancelar(A, p.id, '')), 400);
  const o = s.pedidos.cancelar(A, p.id, 'estorno');
  assert.equal(o.situacao, 'CANCELADO');
  assert.equal(o.motivoCancelamento, 'estorno');
  assert.equal(status(() => s.pedidos.cancelar(A, p.id, 'de novo')), 409);
  assert.equal(s.pedidos.cancelar(B, balcao(c).id, 'desistiu').situacao, 'CANCELADO');
});

test('cancelar comanda não libera a mesa automaticamente', () => {
  const m = mesa();
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [] });
  s.pedidos.cancelar(B, p.id, 'foram embora');
  assert.equal(app.app.repositories.mesas.findById(m.id).situacao, 'OCUPADA');
  assert.equal(s.mesas.liberar(B, m.id).mesa.situacao, 'LIVRE');
});

test('aplicarDesconto: só nível A e até o subtotal', () => {
  const c = cardapio();
  const p = balcao(c);
  assert.equal(status(() => s.pedidos.aplicarDesconto(B, p.id, 100)), 403);
  assert.equal(status(() => s.pedidos.aplicarDesconto(A, p.id, 2501)), 400);
  const o = s.pedidos.aplicarDesconto(A, p.id, 500);
  assert.deepEqual([o.subtotalCents, o.descontoCents, o.totalCents], [2500, 500, 2000]);
});

test('mover comanda para mesa ocupada → 409, para livre libera a antiga', () => {
  const m1 = mesa('1'); const m2 = mesa('2'); const m3 = mesa('3');
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m1.id, itens: [] });
  s.pedidos.criar(B, { tipo: 'MESA', mesaId: m2.id, itens: [] });
  assert.equal(status(() => s.pedidos.mover(B, p.id, m2.id)), 409);
  const o = s.pedidos.mover(B, p.id, m3.id);
  assert.equal(o.mesaId, m3.id);
  const mesas = app.app.repositories.mesas;
  assert.equal(mesas.findById(m1.id).situacao, 'LIVRE');
  assert.equal(mesas.findById(m3.id).situacao, 'OCUPADA');
});

test('prato já pedido: excluir → 409, desativar → ok', () => {
  const c = cardapio();
  balcao(c);
  assert.equal(status(() => s.pratos.remove(A, c.burger.id)), 409);
  assert.equal(s.pratos.desativar(A, c.burger.id).ativo, false);
  assert.equal(status(() => s.pratos.remove(A, c.suco.id)), 200);
});

test('mesa com comanda aberta não libera (409) e depois de PAGA libera', () => {
  const m = mesa();
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [] });
  assert.equal(status(() => s.mesas.liberar(B, m.id)), 409);
  app.db.prepare("UPDATE pedidos SET situacao = 'PAGO' WHERE id = ?").run(p.id);
  assert.equal(s.mesas.liberar(B, m.id).mesa.situacao, 'LIVRE');
});

test('auditoria registra criar, enviar, cancelar', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.enviarCozinha(B, p.id);
  s.pedidos.cancelar(B, p.id, 'teste');
  const acoes = app.db.prepare("SELECT acao FROM auditoria WHERE entidade = 'pedido' AND entidade_id = ? ORDER BY id").all(p.id).map((r) => r.acao);
  assert.deepEqual(acoes, ['criar', 'enviar', 'cancelar']);
});

test('eventos "pedido" são publicados', () => {
  const c = cardapio();
  const p = balcao(c);
  s.pedidos.finalizar(B, p.id);
  assert.equal(status(() => s.pedidos.finalizar(B, p.id)), 409);
  assert.deepEqual(eventos, [{ id: p.id, situacao: 'ABERTO' }, { id: p.id, situacao: 'AGUARDANDO_PAGAMENTO' }]);
});

test('listar por id crescente, filtra por dia, situação e busca sem acento', () => {
  const c = cardapio();
  const a = s.pedidos.criar(B, { tipo: 'BALCAO', clienteNome: 'José', itens: [it(c.burger)] });
  const b = s.pedidos.criar(A, { tipo: 'BALCAO', clienteNome: 'Maria_1', itens: [it(c.suco)] });
  assert.deepEqual(s.pedidos.listar().map((p) => p.id), [a.id, b.id]);
  assert.deepEqual(s.pedidos.listar({ q: 'jose' }).map((p) => p.id), [a.id]);
  assert.deepEqual(s.pedidos.listar({ q: '%' }).map((p) => p.id), []);
  assert.deepEqual(s.pedidos.listar({ q: '2' }).map((p) => p.id), [b.id]);
  assert.deepEqual(s.pedidos.listar({ atendenteId: A.id }).map((p) => p.id), [b.id]);
  assert.deepEqual(s.pedidos.listar({ situacao: 'PAGO' }), []);
  assert.deepEqual(s.pedidos.listar({ de: '2000-01-01', ate: '2000-01-02' }), []);
  const [l] = s.pedidos.listar();
  assert.equal(l.qtdItens, 1);
  assert.equal(l.forma, null);
  assert.deepEqual(l.pagamentos, []);
  assert.deepEqual(s.pedidos.obter(a.id).pagamentos, []);
});

test('nível C (cozinha) ou usuário sem nível não escreve pedidos → 403; B não cancela PAGO', () => {
  const c = cardapio();
  const C = app.db.prepare("SELECT id, usuario, nivel FROM usuarios WHERE usuario = 'COZ'").get();
  const m = mesa('1'); const m2 = mesa('2');
  const p = balcao(c);
  const comanda = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m.id, itens: [it(c.burger)] });
  s.pedidos.enviarCozinha(B, comanda.id);
  const fin = balcao(c); s.pedidos.finalizar(B, fin.id);
  for (const u of [C, { id: C.id, usuario: 'x' }]) {
    const chamadas = [
      () => s.pedidos.criar(u, { tipo: 'BALCAO', clienteNome: 'Ana', itens: [it(c.burger)] }),
      () => s.pedidos.adicionarItens(u, p.id, [it(c.suco)]),
      () => s.pedidos.substituirPendentes(u, p.id, { itens: [] }),
      () => s.pedidos.enviarCozinha(u, p.id),
      () => s.pedidos.cancelarItem(u, comanda.id, comanda.itens[0].id, 'x'),
      () => s.pedidos.mover(u, comanda.id, m2.id),
      () => s.pedidos.finalizar(u, p.id),
      () => s.pedidos.reabrir(u, fin.id),
      () => s.pedidos.cancelar(u, p.id, 'x'),
      () => s.pedidos.aplicarDesconto(u, p.id, 1),
    ];
    for (const fn of chamadas) assert.equal(status(fn), 403);
  }
  app.db.prepare("UPDATE pedidos SET situacao = 'PAGO' WHERE id = ?").run(fin.id);
  assert.equal(status(() => s.pedidos.cancelar(B, fin.id, 'x')), 403);
  assert.equal(s.pedidos.obter(p.id).itens.length, 1);
});

test('falha depois de ocupar/liberar a mesa: rollback e nenhum evento mesa/pedido sai', () => {
  const todos = [];
  app.bus.subscribe((e) => todos.push(e.tipo));
  const m1 = mesa('1'); const m2 = mesa('2');
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m1.id, itens: [] });
  todos.length = 0;
  const original = s.audit.record.bind(s.audit);
  s.audit.record = (e) => { if (e.entidade === 'pedido') throw new Error('falha'); return original(e); };
  assert.throws(() => s.pedidos.criar(B, { tipo: 'MESA', mesaId: m2.id, itens: [] }), /falha/);
  assert.throws(() => s.pedidos.mover(B, p.id, m2.id), /falha/);
  s.audit.record = original;
  assert.deepEqual(todos, []);
  const mesas = app.app.repositories.mesas;
  assert.equal(mesas.findById(m1.id).situacao, 'OCUPADA');
  assert.equal(mesas.findById(m2.id).situacao, 'LIVRE');
  assert.equal(s.pedidos.obter(p.id).mesaId, m1.id);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n, 1);
  s.pedidos.mover(B, p.id, m2.id);
  assert.deepEqual(todos, ['mesa', 'mesa', 'pedido']);
});

test('auditoria registra cancelar_item, finalizar, reabrir, mover e desconto com ator e entidade', () => {
  const c = cardapio();
  const m1 = mesa('1'); const m2 = mesa('2');
  const p = s.pedidos.criar(B, { tipo: 'MESA', mesaId: m1.id, itens: [it(c.burger), it(c.suco)] });
  s.pedidos.enviarCozinha(B, p.id);
  s.pedidos.cancelarItem(B, p.id, p.itens[0].id, 'erro');
  s.pedidos.mover(B, p.id, m2.id);
  s.pedidos.aplicarDesconto(A, p.id, 100);
  s.pedidos.finalizar(B, p.id);
  s.pedidos.reabrir(B, p.id);
  const linhas = app.db.prepare("SELECT acao, usuario, usuario_id, entidade FROM auditoria WHERE entidade = 'pedido' AND entidade_id = ? ORDER BY id").all(p.id);
  const esperado = [['criar', B], ['enviar', B], ['cancelar_item', B], ['mover', B], ['desconto', A], ['finalizar', B], ['reabrir', B]];
  assert.deepEqual(linhas.map((l) => [l.acao, l.usuario, l.usuario_id, l.entidade]), esperado.map(([a, u]) => [a, u.usuario, u.id, 'pedido']));
});
