'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SqliteDatabase = require('../src/infrastructure/database/SqliteDatabase');
const PasswordHasher = require('../src/infrastructure/security/PasswordHasher');
const LoginThrottle = require('../src/infrastructure/security/LoginThrottle');
const SessionStore = require('../src/infrastructure/security/SessionStore');
const UsuarioRepository = require('../src/infrastructure/repositories/UsuarioRepository');
const AuditRepository = require('../src/infrastructure/repositories/AuditRepository');
const ConfiguracaoRepository = require('../src/infrastructure/repositories/ConfiguracaoRepository');
const AuditTrail = require('../src/application/AuditTrail');
const AuthService = require('../src/application/AuthService');
const UsuarioService = require('../src/application/UsuarioService');
const AdminBootstrap = require('../src/application/AdminBootstrap');
const ConfigService = require('../src/application/ConfigService');
const { NIVEIS } = require('../src/domain/niveis');
const UnauthorizedError = require('../src/domain/errors/UnauthorizedError');
const TooManyAttemptsError = require('../src/domain/errors/TooManyAttemptsError');
const ValidationError = require('../src/domain/errors/ValidationError');
const ConflictError = require('../src/domain/errors/ConflictError');

const MIN = 60 * 1000;
const HORA = 60 * MIN;

let t;
let db;
let usuarios;
let auditRepo;
let audit;
let hasher;
let auth;
let usuarioService;
let config;
let admin;
let senhaAdmin;

beforeEach(() => {
  t = Date.parse('2026-10-23T12:00:00.000Z');
  const now = () => t;
  const clock = () => new Date(t);
  db = new SqliteDatabase(':memory:');
  hasher = new PasswordHasher();
  usuarios = new UsuarioRepository(db);
  auditRepo = new AuditRepository(db);
  audit = new AuditTrail({ repository: auditRepo, clock });
  const sessions = new SessionStore({ ttlPorNivel: { A: 12 * HORA, B: 12 * HORA, C: null }, now });
  const throttle = new LoginThrottle({ now });
  auth = new AuthService({ usuarios, hasher, sessions, throttle, audit });
  usuarioService = new UsuarioService({ usuarios, hasher, audit, sessions, clock });
  config = new ConfigService({ repository: new ConfiguracaoRepository(db), audit });
  senhaAdmin = new AdminBootstrap({ usuarios, hasher, audit, clock }).run().senhaProvisoria;
  admin = usuarios.findByUsuario('ADMIN');
});

const criarUsuario = (usuario, nivel, nome = usuario) => usuarioService.criar(admin, { usuario, nome, nivel });

test('NIVEIS descreve os três perfis', () => {
  assert.deepEqual(NIVEIS, { A: 'Administrador', B: 'Atendente', C: 'Cozinha' });
});

test('login correto devolve sid e user sem senha_hash', () => {
  const { sid, user } = auth.login('admin', senhaAdmin);
  assert.ok(sid);
  assert.equal(user.usuario, 'ADMIN');
  assert.equal(user.nivel, 'A');
  assert.equal('senha_hash' in user, false);
  assert.equal('senhaHash' in user, false);
  assert.equal(auth.resolveUser(sid).id, user.id);
  auth.logout(sid);
  assert.equal(auth.resolveUser(sid), null);
});

test('login com senha errada lança UnauthorizedError e usuário inativo não entra', () => {
  assert.throws(() => auth.login('ADMIN', 'errada'), UnauthorizedError);
  assert.throws(() => auth.login('NINGUEM', 'qualquer'), UnauthorizedError);
  const { user, senhaProvisoria } = criarUsuario('JOAO', 'B');
  usuarioService.atualizar(admin, user.id, { ativo: false });
  assert.throws(() => auth.login('JOAO', senhaProvisoria), UnauthorizedError);
});

test('3 senhas erradas bloqueiam por 5 minutos e liberam depois', () => {
  for (let i = 0; i < 3; i += 1) assert.throws(() => auth.login('ADMIN', 'errada'), UnauthorizedError);
  assert.throws(() => auth.login('ADMIN', senhaAdmin), TooManyAttemptsError);
  t += 4 * MIN;
  assert.throws(() => auth.login('ADMIN', senhaAdmin), TooManyAttemptsError);
  t += 2 * MIN;
  assert.ok(auth.login('ADMIN', senhaAdmin).sid);
});

test('usuário novo nasce com must_change = 1', () => {
  const { user, senhaProvisoria } = criarUsuario('MARIA', 'B', 'Maria');
  assert.ok(senhaProvisoria.length >= 6);
  assert.equal(user.mustChange, true);
  assert.equal(db.prepare('SELECT must_change FROM usuarios WHERE usuario = ?').get('MARIA').must_change, 1);
  assert.equal(JSON.stringify(user).includes('hash'), false);
  assert.throws(() => criarUsuario('maria', 'B'), ConflictError);
  assert.throws(() => criarUsuario('ZE', 'X'), ValidationError);
  assert.equal(auth.login('MARIA', senhaProvisoria).user.mustChange, true);
});

test('trocarSenha exige senha atual e mínimo de 6', () => {
  const { user } = auth.login('ADMIN', senhaAdmin);
  assert.throws(() => auth.trocarSenha(user, 'errada', 'novasenha'), ValidationError);
  assert.throws(() => auth.trocarSenha(user, senhaAdmin, '12345'), ValidationError);
  auth.trocarSenha(user, senhaAdmin, 'novasenha');
  assert.throws(() => auth.login('ADMIN', senhaAdmin), UnauthorizedError);
  assert.equal(auth.login('ADMIN', 'novasenha').user.mustChange, false);
});

test('trocarSenha rejeita senha igual, encerra sessões e limita tentativas', () => {
  const { sid, user } = auth.login('ADMIN', senhaAdmin);
  assert.throws(() => auth.trocarSenha(user, senhaAdmin, senhaAdmin), /diferente/);
  auth.trocarSenha(user, senhaAdmin, 'novasenha');
  assert.equal(auth.resolveUser(sid), null);
  const { user: u2 } = auth.login('ADMIN', 'novasenha');
  for (let i = 0; i < 3; i += 1) assert.throws(() => auth.trocarSenha(u2, 'errada', 'outrasenha'), ValidationError);
  assert.throws(() => auth.trocarSenha(u2, 'novasenha', 'outrasenha'), TooManyAttemptsError);
  t += 6 * MIN;
  auth.trocarSenha(u2, 'novasenha', 'outrasenha');
});

test('login de usuário inexistente executa a verificação de senha (tempo constante)', () => {
  let chamadas = 0;
  const original = hasher.verify.bind(hasher);
  hasher.verify = (...args) => { chamadas += 1; return original(...args); };
  assert.throws(() => auth.login('FANTASMA', 'x'), UnauthorizedError);
  assert.equal(chamadas, 1);
});

test('mudar o nível encerra as sessões vivas do usuário', () => {
  const { user, senhaProvisoria } = criarUsuario('TROCA', 'C');
  const { sid } = auth.login('TROCA', senhaProvisoria);
  usuarioService.atualizar(admin, user.id, { nivel: 'B' });
  assert.equal(auth.resolveUser(sid), null);
});

test('LoginThrottle poda entradas expiradas e limita o tamanho da chave', () => {
  const th = new LoginThrottle({ now: () => t });
  for (let i = 0; i < 50; i += 1) th.registerFailure(`U${i}`);
  assert.equal(th.failures.size, 50);
  t += 6 * MIN;
  th.registerFailure('NOVO');
  assert.equal(th.failures.size, 1);
  th.registerFailure('X'.repeat(500));
  assert.ok([...th.failures.keys()].every((k) => k.length <= 64));
  for (let i = 0; i < 2; i += 1) th.registerFailure('X'.repeat(600));
  assert.equal(th.isBlocked('X'.repeat(70)), true);
});

test('não rebaixa nem desativa o último administrador', () => {
  assert.throws(() => usuarioService.atualizar(admin, admin.id, { nivel: 'B' }), /último administrador/);
  assert.throws(() => usuarioService.atualizar(admin, admin.id, { ativo: false }), /último administrador/);
  const { user: outro } = criarUsuario('SEGUNDO', 'A');
  usuarioService.atualizar(admin, outro.id, { nivel: 'B' });
  assert.equal(usuarios.findById(outro.id).nivel, 'B');
  assert.throws(() => usuarioService.atualizar(outro, admin.id, { ativo: false }), /último administrador/);
});

test('usuário não exclui a si mesmo', () => {
  const { user: outro } = criarUsuario('SEGUNDO', 'A');
  assert.throws(() => usuarioService.atualizar(admin, admin.id, { ativo: false }), /si mesmo/);
  assert.equal(usuarios.findById(admin.id).ativo, true);
  usuarioService.atualizar(admin, outro.id, { ativo: false });
  assert.equal(usuarios.findById(outro.id).ativo, false);
});

test('resetarSenha gera provisória, força troca e derruba sessões', () => {
  const { user, senhaProvisoria } = criarUsuario('ANA', 'B');
  const { sid } = auth.login('ANA', senhaProvisoria);
  const reset = usuarioService.resetarSenha(admin, user.id);
  assert.equal(auth.resolveUser(sid), null);
  assert.equal(auth.login('ANA', reset.senhaProvisoria).user.mustChange, true);
  assert.equal(usuarioService.listar().length, 2);
});

test('sessão nível A expira após 12 h sem uso', () => {
  const { sid } = auth.login('ADMIN', senhaAdmin);
  t += 11 * HORA;
  assert.ok(auth.resolveUser(sid), 'uso renova a sessão');
  t += 11 * HORA;
  assert.ok(auth.resolveUser(sid), 'renovada pelo uso anterior');
  t += 12 * HORA + 1;
  assert.equal(auth.resolveUser(sid), null);
});

test('sessão nível C não expira por inatividade', () => {
  const { senhaProvisoria } = criarUsuario('COZ', 'C');
  const { sid } = auth.login('COZ', senhaProvisoria);
  t += 72 * HORA;
  assert.equal(auth.resolveUser(sid).nivel, 'C');
});

test('AdminBootstrap cria ADMIN uma única vez', () => {
  const boot = new AdminBootstrap({ usuarios, hasher, audit });
  assert.equal(boot.run(), null);
  assert.equal(usuarios.count(), 1);
  assert.equal(admin.nivel, 'A');
  assert.equal(admin.mustChange, true);
});

test('auditoria registra login, falha e criação de usuário', () => {
  assert.throws(() => auth.login('ADMIN', 'errada'));
  auth.login('ADMIN', senhaAdmin);
  criarUsuario('LUIZ', 'B');
  const acoes = auditRepo.search().map((a) => a.acao);
  for (const a of ['login_falha', 'login', 'criar']) assert.ok(acoes.includes(a), a);
});

test('ConfigService devolve DEFAULTS e persiste set com auditoria', () => {
  assert.equal(config.get('cozinha.enviar_em'), 'PAGO');
  assert.equal(config.get('pix.validade_min'), '15');
  assert.equal(config.get('rede.porta_local'), '8420');
  config.set(admin, 'pix.validade_min', 20);
  assert.equal(config.get('pix.validade_min'), '20');
  assert.equal(config.todas()['pix.validade_min'], '20');
  assert.equal(config.todas()['cozinha.som'], '1');
  const reg = auditRepo.search({ acao: 'configurar' })[0];
  assert.equal(reg.entidade, 'configuracao');
  const detalhe = auditRepo.findById(reg.id);
  assert.equal(detalhe.antes.valor, '15');
  assert.equal(detalhe.depois.valor, '20');
  assert.throws(() => config.set(admin, 'chave.inexistente', 'x'), ValidationError);
  assert.throws(() => config.get('chave.inexistente'), ValidationError);
});
