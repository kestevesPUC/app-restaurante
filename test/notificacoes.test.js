'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('./helpers/createTestApp');
const MensageiroError = require('../src/domain/errors/MensageiroError');
const ExternalServiceError = require('../src/domain/errors/ExternalServiceError');
const NotificacaoService = require('../src/application/NotificacaoService');

const naoTratadas = [];
const aoRejeitar = (e) => naoTratadas.push(e);
let app; let s; let A; let B; let C; let burger; let eventos;

async function subir(overrides) {
  app = await createTestApp(overrides);
  s = app.app.services;
  const u = (n) => app.db.prepare('SELECT id, usuario, nivel FROM usuarios WHERE usuario = ?').get(n);
  A = u('ADM'); B = u('ATEND'); C = u('COZ');
  const lanches = s.categorias.create(A, { nome: 'Lanches' });
  const pao = s.ingredientes.create(A, { nome: 'Pão', unidadeMedida: 'UN' });
  burger = s.pratos.create(A, { nome: 'X-Burger', categoriaId: lanches.id, precoCents: 2500, tempoPreparoMin: 10, ingredientes: [{ ingredienteId: pao.id }] });
  eventos = [];
  app.bus.subscribe((e) => { if (e.tipo === 'notificacao') eventos.push(e.dados); });
}
beforeEach(async () => { naoTratadas.length = 0; process.on('unhandledRejection', aoRejeitar); await subir(); });
afterEach(async () => {
  process.off('unhandledRejection', aoRejeitar);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(naoTratadas, []);
  await app.close();
});

const emPreparo = (nome = 'João Silva') => {
  const p = s.pedidos.criarRascunho(B, { cliente: { nome, telefone: '(11) 99999-8888' }, itens: [{ tipo: 'PRATO', itemId: burger.id, quantidade: 1 }] });
  s.pedidos.confirmar(B, p.id);
  return s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
};
const linhas = (id) => app.db.prepare('SELECT * FROM notificacoes_whatsapp WHERE pedido_id = ? ORDER BY id').all(id);

test('PRONTO_RETIRADA envia exatamente o texto de retirada para o telefone do pedido', async () => {
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const [env] = app.mensageiro.enviadas;
  assert.equal(app.mensageiro.enviadas.length, 1);
  assert.equal(env.telefoneE164, '+5511999998888');
  assert.equal(env.texto, `Olá, *João*!\n\nSeu pedido nº ${p.id} está pronto para retirada.\n\nAgradecemos a preferência.`);
  const [l] = linhas(p.id);
  assert.deepEqual([l.tipo, l.situacao, l.erro, l.automatica, l.enviada_por], ['RETIRADA', 'ENVIADA', null, 1, null]);
  assert.deepEqual(eventos, [{ id: l.id, pedidoId: p.id, situacao: 'ENVIADA', erro: null, automatica: true }]);
});

test('PRONTO_ENTREGA envia o texto de entrega; EM_PREPARO e FINALIZADO não enviam', async () => {
  const p = emPreparo();
  await s.notificacoes.aguardarPendentes();
  assert.equal(app.mensageiro.enviadas.length, 0);
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_ENTREGA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(app.mensageiro.enviadas[0].texto, `Olá, *João*!\n\nSeu pedido nº ${p.id} foi finalizado e está pronto para entrega.\n\nAgradecemos a preferência.`);
  s.pedidos.mudarStatus(A, p.id, 'FINALIZADO');
  await s.notificacoes.aguardarPendentes();
  assert.equal(app.mensageiro.enviadas.length, 1);
  assert.equal(linhas(p.id)[0].tipo, 'ENTREGA');
});

test('falha NUMERO_SEM_WHATSAPP grava FALHOU, publica o evento e mantém o status', async () => {
  const p = emPreparo();
  app.mensageiro.falharProxima('NUMERO_SEM_WHATSAPP');
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const [l] = linhas(p.id);
  assert.equal(l.situacao, 'FALHOU');
  assert.match(l.erro, /WhatsApp/);
  assert.equal(eventos[0].situacao, 'FALHOU');
  assert.equal(eventos[0].erro, l.erro);
  assert.equal(s.pedidos.obter(A, p.id).status, 'PRONTO_RETIRADA');
});

test('mensageiro desconectado grava FALHOU com NAO_CONECTADO', async () => {
  const p = emPreparo();
  app.mensageiro.definirEstado('DESCONECTADO');
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(linhas(p.id)[0].situacao, 'FALHOU');
  assert.match(linhas(p.id)[0].erro, /conectado/i);
  assert.equal(app.mensageiro.enviadas.length, 0);
});

test('MensageiroError é um ExternalServiceError 502 com código', () => {
  const e = new MensageiroError('TIMEOUT');
  assert.ok(e instanceof ExternalServiceError);
  assert.equal(e.status, 502);
  assert.equal(e.code, 'TIMEOUT');
});

test('Error genérico do mensageiro vira FALHOU ERRO_ENVIO sem rejeição não tratada', async () => {
  await app.close();
  const falho = { estado: () => 'CONECTADO', enviar: async () => { throw new Error('segredo interno'); } };
  await subir({ mensageiro: falho });
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const [l] = linhas(p.id);
  assert.equal(l.situacao, 'FALHOU');
  assert.equal(l.erro, 'Falha ao enviar a mensagem');
  assert.equal(app.erros.length >= 1, true);
  assert.equal(s.pedidos.obter(A, p.id).status, 'PRONTO_RETIRADA');
});

test('mensageiro lento: timeout grava FALHOU e a rejeição tardia não escapa', async () => {
  await app.close();
  const lento = { estado: () => 'CONECTADO', enviar: () => new Promise((_, rej) => setTimeout(() => rej(new Error('tarde')), 80)) };
  await subir({ mensageiro: lento, notificacaoTimeoutMs: 20 });
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const [l] = linhas(p.id);
  assert.equal(l.situacao, 'FALHOU');
  assert.match(l.erro, /tempo/i);
  await new Promise((r) => setTimeout(r, 120));
});

test('reenviar cria nova linha manual, só com PRONTO_*, e respeita permissões', async () => {
  const p = emPreparo();
  await assert.rejects(() => s.notificacoes.reenviar(B, p.id), { status: 409 });
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const nova = await s.notificacoes.reenviar(B, p.id);
  assert.equal(nova.automatica, 0);
  assert.equal(nova.enviadaPor, B.id);
  assert.equal(nova.situacao, 'ENVIADA');
  assert.equal(linhas(p.id).length, 2);
  assert.equal(s.notificacoes.historico(A, p.id)[0].id, nova.id);
  app.mensageiro.falharProxima('TIMEOUT');
  assert.equal((await s.notificacoes.reenviar(A, p.id)).situacao, 'FALHOU');
  await assert.rejects(() => s.notificacoes.reenviar(C, p.id), { status: 403 });
  await assert.rejects(() => s.notificacoes.reenviar(undefined, p.id), { status: 403 });
  await assert.rejects(() => s.notificacoes.reenviar(A, 9999), { status: 404 });
  assert.throws(() => s.notificacoes.historico(C, p.id), { status: 403 });
  const acao = app.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE acao = 'notificacao_reenviada'").get().n;
  assert.equal(acao, 2);
});

test('desfazer e voltar a PRONTO envia de novo (sem deduplicação)', async () => {
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  s.pedidos.mudarStatus(A, p.id, 'EM_PREPARO');
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(app.mensageiro.enviadas.length, 2);
});

test('renderizar: primeiro nome, acento, emoji, vazio, repetido e marcador desconhecido', () => {
  const r = (m, nome, numero = 7) => s.notificacoes.renderizar(m, { nome, numero });
  assert.equal(r('Olá, {nome}!', '  ÁLVARO souza '), 'Olá, *Álvaro*!');
  assert.equal(r('{nome}', '😀 Zé'), '*😀*');
  assert.equal(r('{nome}', ''), 'cliente');
  assert.equal(r('{nome}', '   '), 'cliente');
  assert.equal(r('{nome}', null), 'cliente');
  assert.equal(r('nº {numero} e {numero} {mesa}', 'Ana'), 'nº 7 e 7 {mesa}');
});

test('NotificacaoService.aoMudarStatus nunca lança, mesmo com dependências quebradas', async () => {
  const quebrado = new NotificacaoService({
    repository: { insert() { throw new Error('banco'); } }, mensageiro: { enviar: async () => { throw new Error('x'); } },
    carregarPedido: () => null, config: { get() { throw new Error('cfg'); } }, audit: {}, bus: null, relogio: Date.now, logger: { error() {} },
  });
  assert.doesNotThrow(() => quebrado.aoMudarStatus({ id: 1, status: 'PRONTO_RETIRADA', cliente: { nome: 'A', telefone: '+5511999998888' } }, B));
  assert.doesNotThrow(() => quebrado.aoMudarStatus(null, B));
  await quebrado.aguardarPendentes();
});

test('ponta a ponta: confirmar → EM_PREPARO → PRONTO_RETIRADA dispara um envio', async () => {
  const p = emPreparo('Maria');
  assert.equal(app.mensageiro.enviadas.length, 0);
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(app.mensageiro.enviadas.length, 1);
});

test('mensageiro que lança de forma síncrona vira FALHOU ERRO_ENVIO', async () => {
  await app.close();
  await subir({ mensageiro: { estado: () => 'CONECTADO', enviar() { throw new Error('x'); } } });
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(linhas(p.id)[0].erro, 'Falha ao enviar a mensagem');
  assert.equal(linhas(p.id)[0].situacao, 'FALHOU');
});

test('nome com $& e $1 é preservado literalmente', async () => {
  const p = emPreparo('Zé $& $1 Silva');
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.match(app.mensageiro.enviadas[0].texto, /^Olá, \*Zé\*!/);
  const r = (nome) => s.notificacoes.renderizar('Olá, {nome}! nº {numero}', { nome, numero: 3 });
  assert.equal(r('$& Silva'), 'Olá, *$&*! nº 3');
  assert.equal(r('$1'), 'Olá, *$1*! nº 3');
});

test('pedido sem cliente ou sem telefone: nada é enviado nem registrado; reenviar recusa com 409', async () => {
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  app.mensageiro.enviadas.length = 0;
  const antes = app.app.repositories.notificacoes.listarPorPedido(p.id).length;
  for (const cliente of [null, { id: 1, nome: 'Ana', telefone: null }, { id: 1, nome: 'Ana', telefone: '   ' }, { id: 1, nome: 'Ana', telefone: '' }]) {
    eventos.length = 0;
    const pedidoFalso = { id: p.id, status: 'PRONTO_RETIRADA', cliente };
    const svc = new NotificacaoService({
      repository: app.app.repositories.notificacoes, mensageiro: app.mensageiro, carregarPedido: () => pedidoFalso,
      config: s.config, audit: app.app.services.audit, bus: app.bus, relogio: Date.now, logger: { error() {} },
    });
    svc.aoMudarStatus(pedidoFalso, B);
    await svc.aguardarPendentes();
    await new Promise((r) => setImmediate(r));
    assert.equal(eventos.length, 0);
    await assert.rejects(() => svc.reenviar(B, p.id), (e) => e.status === 409 && /sem telefone/.test(e.message));
  }
  assert.equal(app.mensageiro.enviadas.length, 0);
  assert.equal(app.app.repositories.notificacoes.listarPorPedido(p.id).length, antes);
  assert.equal(s.pedidos.obter(A, p.id).status, 'PRONTO_RETIRADA');
});

test('bus.publish lançando após o INSERT não derruba o reenviar', async () => {
  const p = emPreparo();
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  const original = s.notificacoes.bus;
  s.notificacoes.bus = { publish() { throw new Error('bus'); } };
  const r = await s.notificacoes.reenviar(B, p.id);
  s.notificacoes.bus = original;
  assert.equal(r.situacao, 'ENVIADA');
  assert.equal(linhas(p.id).length, 2);
});

test('envio real com primeiro nome $& ou $1 preserva o texto exatamente', async () => {
  for (const [nome, primeiro] of [['$& Silva', '$&'], ['$1 Souza', '$1']]) {
    app.mensageiro.enviadas.length = 0;
    const p = emPreparo(nome);
    s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
    await s.notificacoes.aguardarPendentes();
    assert.equal(app.mensageiro.enviadas[0].texto, `Olá, *${primeiro}*!

Seu pedido nº ${p.id} está pronto para retirada.

Agradecemos a preferência.`);
  }
});

test('telefone mal formatado é problema do adaptador: o FALHOU fica registrado', async () => {
  await app.close();
  const recusa = { estado: () => 'CONECTADO', enviar: async () => { throw new MensageiroError('NUMERO_SEM_WHATSAPP'); } };
  await subir({ mensageiro: recusa });
  const p = emPreparo();
  app.db.prepare("UPDATE pedidos SET cliente_telefone = 'abc' WHERE id = ?").run(p.id);
  s.pedidos.mudarStatus(A, p.id, 'PRONTO_RETIRADA');
  await s.notificacoes.aguardarPendentes();
  assert.equal(linhas(p.id)[0].situacao, 'FALHOU');
  assert.equal(linhas(p.id)[0].telefone, 'abc');
});
