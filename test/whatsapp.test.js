'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const WhatsAppWebMensageiro = require('../src/infrastructure/whatsapp/WhatsAppWebMensageiro');
const { detectarNavegador } = require('../src/infrastructure/whatsapp/detectarNavegador');
const EventBus = require('../src/infrastructure/events/EventBus');
const MensageiroError = require('../src/domain/errors/MensageiroError');

const naoTratadas = [];
const aoRejeitar = (e) => naoTratadas.push(e);
beforeEach(() => { naoTratadas.length = 0; process.on('unhandledRejection', aoRejeitar); });
afterEach(async () => {
  process.off('unhandledRejection', aoRejeitar);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(naoTratadas, []);
});

/** Cliente falso controlado pelo teste: nada de rede nem navegador. */
function criarClienteFalso({ falhaInicializar = false } = {}) {
  const handlers = {};
  const c = {
    handlers, enviados: [], consultados: [], destruidos: 0, inicializados: 0, info: { wid: { user: '5511988887777' } },
    numeroValido: true,
    on(evento, fn) { handlers[evento] = fn; },
    emitir(evento, ...args) { return handlers[evento]?.(...args); },
    async initialize() { c.inicializados += 1; if (falhaInicializar) throw new Error('falha ao abrir o navegador'); },
    async getNumberId(n) { c.consultados.push(n); return c.numeroValido ? { _serialized: `${n}@c.us` } : null; },
    async sendMessage(id, texto) { c.enviados.push({ id, texto }); return { id: { _serialized: `msg-${c.enviados.length}` } }; },
    async destroy() { c.destruidos += 1; },
  };
  return c;
}

function montar(opcoes = {}) {
  const clientes = [];
  const agendados = [];
  const eventos = [];
  const bus = new EventBus({ logger: { error: () => {} } });
  bus.subscribe((e) => { if (e.tipo === 'whatsapp') eventos.push(e.dados); });
  const logs = [];
  const m = new WhatsAppWebMensageiro({
    criarCliente: () => { const c = criarClienteFalso(opcoes.cliente); clientes.push(c); return c; },
    relogio: () => 0, bus, logger: { error: (e) => logs.push(e) },
    agendar: (fn, ms) => { const t = { fn, ms, cancelado: false }; agendados.push(t); return t; },
    cancelar: (t) => { t.cancelado = true; },
    ...opcoes.mensageiro,
  });
  return { m, clientes, agendados, eventos, logs, cliente: () => clientes.at(-1) };
}

test('estado inicial DESCONECTADO; iniciar leva a CONECTANDO', async () => {
  const { m, eventos } = montar();
  assert.equal(m.estado(), 'DESCONECTADO');
  await m.iniciar();
  assert.equal(m.estado(), 'CONECTANDO');
  assert.deepEqual(eventos.at(-1), { estado: 'CONECTANDO' });
});

test('qr → AGUARDANDO_QR e publica o QR', async () => {
  const { m, cliente, eventos } = montar();
  await m.iniciar();
  cliente().emitir('qr', 'QR-123');
  assert.equal(m.estado(), 'AGUARDANDO_QR');
  assert.equal(m.qrAtual(), 'QR-123');
  assert.deepEqual(eventos.at(-1), { estado: 'AGUARDANDO_QR', qr: 'QR-123' });
});

test('ready → CONECTADO e guarda o número; o qr some', async () => {
  const { m, cliente, eventos } = montar();
  await m.iniciar();
  cliente().emitir('qr', 'QR-123');
  cliente().emitir('authenticated');
  cliente().emitir('ready');
  assert.equal(m.estado(), 'CONECTADO');
  assert.equal(m.numeroConectado(), '5511988887777');
  assert.equal(m.qrAtual(), null);
  assert.deepEqual(eventos.at(-1), { estado: 'CONECTADO', numero: '5511988887777' });
});

test('enviar usa getNumberId com 55DDDNÚMERO e envia para o id devolvido', async () => {
  const { m, cliente } = montar();
  await m.iniciar();
  cliente().emitir('ready');
  const r = await m.enviar({ telefoneE164: '+5511999998888', texto: 'Olá' });
  assert.deepEqual(cliente().consultados, ['5511999998888']);
  assert.deepEqual(cliente().enviados, [{ id: '5511999998888@c.us', texto: 'Olá' }]);
  assert.deepEqual(r, { id: 'msg-1' });
});

test('número sem WhatsApp → NUMERO_SEM_WHATSAPP e nada é enviado', async () => {
  const { m, cliente } = montar();
  await m.iniciar();
  cliente().emitir('ready');
  cliente().numeroValido = false;
  await assert.rejects(m.enviar({ telefoneE164: '+5511999998888', texto: 'x' }), (e) => e instanceof MensageiroError && e.code === 'NUMERO_SEM_WHATSAPP');
  assert.equal(cliente().enviados.length, 0);
});

test('enviar desconectado → NAO_CONECTADO', async () => {
  const { m } = montar();
  await assert.rejects(m.enviar({ telefoneE164: '+5511999998888', texto: 'x' }), (e) => e.code === 'NAO_CONECTADO');
});

test('erro inesperado do cliente → ERRO_ENVIO', async () => {
  const { m, cliente } = montar();
  await m.iniciar();
  cliente().emitir('ready');
  cliente().sendMessage = async () => { throw new Error('boom'); };
  await assert.rejects(m.enviar({ telefoneE164: '+5511999998888', texto: 'x' }), (e) => e instanceof MensageiroError && e.code === 'ERRO_ENVIO');
});

test('sem resposta no limite → TIMEOUT, sem rejeição não tratada quando o cliente responde depois', async () => {
  const { m, cliente } = montar({ mensageiro: { timeoutMs: 20 } });
  await m.iniciar();
  cliente().emitir('ready');
  let falhar;
  cliente().getNumberId = () => new Promise((_, rej) => { falhar = rej; });
  await assert.rejects(m.enviar({ telefoneE164: '+5511999998888', texto: 'x' }), (e) => e.code === 'TIMEOUT');
  falhar(new Error('chegou tarde'));
});

test('disconnected → DESCONECTADO e nova tentativa em 5, 10, 20, 40, 60, 60 s; ready reinicia a contagem', async () => {
  const { m, clientes, agendados, cliente } = montar();
  await m.iniciar();
  cliente().emitir('ready');
  const esperas = [];
  for (let i = 0; i < 6; i += 1) {
    cliente().emitir('disconnected', 'LOGOUT');
    assert.equal(m.estado(), 'DESCONECTADO');
    const t = agendados.at(-1);
    esperas.push(t.ms);
    await t.fn();
    assert.equal(m.estado(), 'CONECTANDO');
  }
  assert.deepEqual(esperas, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(clientes.length, 7);
  assert.equal(clientes[0].destruidos, 1); // o cliente antigo é descartado
  cliente().emitir('ready');
  cliente().emitir('disconnected', 'X');
  assert.equal(agendados.at(-1).ms, 5000);
});

test('auth_failure → DESCONECTADO com log e SEM reconexão automática', async () => {
  const { m, cliente, logs, agendados } = montar();
  await m.iniciar();
  cliente().emitir('auth_failure', 'sessão inválida');
  assert.equal(m.estado(), 'DESCONECTADO');
  assert.equal(logs.length, 1);
  assert.equal(agendados.length, 0);
  await m.iniciar(); // só o operador reconecta
  assert.equal(m.estado(), 'CONECTANDO');
});

test('falha em initialize → DESCONECTADO + backoff, sem unhandledRejection', async () => {
  const { m, agendados, logs } = montar({ cliente: { falhaInicializar: true } });
  await m.iniciar();
  assert.equal(m.estado(), 'DESCONECTADO');
  assert.equal(logs.length, 1);
  assert.equal(agendados.at(-1).ms, 5000);
  await agendados.at(-1).fn();
  assert.equal(agendados.at(-1).ms, 10000);
});

test('parar chama destroy uma vez, cancela a reconexão e é idempotente', async () => {
  const { m, cliente, agendados } = montar();
  await m.iniciar();
  const c = cliente();
  c.emitir('ready');
  c.emitir('disconnected', 'X');
  const t = agendados.at(-1);
  await m.parar();
  await m.parar();
  assert.equal(t.cancelado, true);
  assert.equal(c.destruidos, 1);
  assert.equal(m.estado(), 'DESCONECTADO');
});

test('iniciar não duplica o cliente quando já está conectando', async () => {
  const { m, clientes } = montar();
  await m.iniciar();
  await m.iniciar();
  assert.equal(clientes.length, 1);
});

test('detectarNavegador escolhe o Edge (x86 primeiro), respeita o configurado e devolve null sem ele', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\Arquivos86', ProgramFiles: 'C:\\Arquivos' };
  const x86 = path.join('C:\\Arquivos86', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const x64 = path.join('C:\\Arquivos', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(detectarNavegador({ existe: (p) => p === x86 || p === x64, env }), x86);
  assert.equal(detectarNavegador({ existe: (p) => p === x64, env }), x64);
  assert.equal(detectarNavegador({ existe: () => false, env }), null);
  assert.equal(detectarNavegador({ existe: () => false, env: {} }), null);
  assert.equal(detectarNavegador({ configurado: 'D:\\x\\edge.exe', existe: (p) => p === 'D:\\x\\edge.exe', env }), 'D:\\x\\edge.exe');
  assert.equal(detectarNavegador({ configurado: 'D:\\nao\\existe.exe', existe: (p) => p === x64, env }), x64);
});

test('cliente antigo que emite ready/qr depois da reconexão não altera o estado', async () => {
  const { m, clientes, agendados } = montar();
  await m.iniciar();
  const antigo = clientes[0];
  antigo.emitir('disconnected', 'X');
  await agendados.at(-1).fn();
  assert.equal(clientes.length, 2);
  antigo.emitir('ready');
  antigo.emitir('qr', 'QR-VELHO');
  assert.equal(m.estado(), 'CONECTANDO');
  assert.equal(m.qrAtual(), null);
  assert.equal(m.numeroConectado(), null);
});

test('parar com initialize pendente e rejeição tardia: sem unhandledRejection e sem mudar o estado', async () => {
  let falhar;
  const base = criarClienteFalso();
  base.initialize = () => new Promise((_, rej) => { falhar = rej; });
  const m2 = new WhatsAppWebMensageiro({ criarCliente: () => base, logger: { error: () => {} }, agendar: () => ({}), cancelar: () => {} });
  const iniciando = m2.iniciar();
  await m2.parar();
  falhar(new Error('tarde'));
  await iniciando;
  assert.equal(m2.estado(), 'DESCONECTADO');
  assert.equal(base.destruidos, 1);
});

test('destroy rejeitando dentro de parar é logado e não propaga', async () => {
  const { m, cliente, logs } = montar();
  await m.iniciar();
  cliente().destroy = async () => { throw new Error('destroy travou'); };
  await m.parar();
  assert.equal(m.estado(), 'DESCONECTADO');
  assert.equal(logs.length, 1);
});

test('função agendada que dispara depois de parar não cria cliente novo', async () => {
  const { m, clientes, agendados } = montar();
  await m.iniciar();
  clientes[0].emitir('disconnected', 'X');
  const t = agendados.at(-1);
  await m.parar();
  await t.fn();
  assert.equal(clientes.length, 1);
  assert.equal(m.estado(), 'DESCONECTADO');
});

test('ambienteDoNavegador remove __COMPAT_LAYER (qualquer caixa) e mantém o resto', () => {
  const { ambienteDoNavegador } = require('../src/infrastructure/whatsapp/criarClienteWhatsApp');
  const env = { __COMPAT_LAYER: 'RunAsInvoker', __compat_layer: 'x', PATH: 'C:/bin', USERPROFILE: 'C:/u' };
  assert.deepEqual(ambienteDoNavegador(env), { PATH: 'C:/bin', USERPROFILE: 'C:/u' });
  assert.equal(env.__COMPAT_LAYER, 'RunAsInvoker'); // não altera o original
});

test('encerrarNavegadorOrfao mira o perfil da sessão no Windows e não faz nada fora dele', async () => {
  const { encerrarNavegadorOrfao } = require('../src/infrastructure/whatsapp/criarClienteWhatsApp');
  const chamadas = [];
  const executar = (cmd, args, opcoes, cb) => { chamadas.push({ cmd, args }); cb(new Error('falhou')); };
  await encerrarNavegadorOrfao("C:\\Dados\\o'brien\\session", { executar, plataforma: 'win32' });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].cmd, 'powershell.exe');
  assert.match(chamadas[0].args.at(-1), /o''brien\\session/);
  await encerrarNavegadorOrfao('/tmp/session', { executar, plataforma: 'linux' });
  await encerrarNavegadorOrfao('', { executar, plataforma: 'win32' });
  assert.equal(chamadas.length, 1);
});
