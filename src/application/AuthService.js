'use strict';
const UnauthorizedError = require('../domain/errors/UnauthorizedError');
const TooManyAttemptsError = require('../domain/errors/TooManyAttemptsError');
const ValidationError = require('../domain/errors/ValidationError');
const { usuarioPublico } = require('../domain/usuarioPublico');
const AuditTrail = require('./AuditTrail');

const SENHA_MINIMA = 6;
const DEZ_ANOS_S = 10 * 365 * 24 * 60 * 60;
const chaveSenha = (user) => `senha:${user.id}`;

/** Autenticação (RN-01): login com bloqueio por tentativas, sessões e troca de senha. Tudo é auditado. */
class AuthService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/UsuarioRepository')} deps.usuarios
   * @param {import('../infrastructure/security/PasswordHasher')} deps.hasher
   * @param {import('../infrastructure/security/SessionStore')} deps.sessions
   * @param {import('../infrastructure/security/LoginThrottle')} deps.throttle
   * @param {AuditTrail} deps.audit
   */
  constructor({ usuarios, hasher, sessions, throttle, audit }) {
    this.usuarios = usuarios;
    this.hasher = hasher;
    this.sessions = sessions;
    this.throttle = throttle;
    this.audit = audit;
    // Hash fixo para igualar o tempo de resposta quando o usuário não existe ou está inativo.
    this.dummyHash = hasher.hash('senha-inexistente');
  }

  /** @returns {{sid: string, user: object}} */
  login(usuarioInformado, senha) {
    const login = String(usuarioInformado || '').trim().toUpperCase();
    if (this.throttle.isBlocked(login)) {
      this.#registrarTentativa(login, 'login_bloqueado', `Login bloqueado por excesso de tentativas (${login})`);
      throw new TooManyAttemptsError();
    }
    const user = this.usuarios.findByUsuario(login);
    const senhaOk = this.hasher.verify(String(senha || ''), user ? user.senhaHash : this.dummyHash);
    if (!user || !user.ativo || !senhaOk) {
      this.throttle.registerFailure(login);
      this.#registrarTentativa(login, 'login_falha', `Tentativa de login com senha incorreta (${login})`);
      throw new UnauthorizedError('Usuário ou senha incorretos');
    }
    this.throttle.reset(login);
    this.audit.record({ actor: user, acao: 'login', entidade: 'sessao', entidadeId: user.id, descricao: `${user.usuario} entrou no sistema` });
    return { sid: this.sessions.create(user.id, user.nivel), user: usuarioPublico(user) };
  }

  /** Abre sessão para um usuário já autenticado (uso interno, ex.: após a troca de senha). Não confere senha. */
  abrirSessao(user) {
    return this.sessions.create(user.id, user.nivel);
  }

  /** Duração do cookie de sessão em segundos, derivada do mesmo TTL do SessionStore (nível sem TTL = ~10 anos). */
  cookieMaxAge(nivel) {
    const ttl = this.sessions.ttlPorNivel[nivel] ?? null;
    return ttl === null ? DEZ_ANOS_S : Math.floor(ttl / 1000);
  }

  logout(sid) {
    const user = this.resolveUser(sid);
    this.sessions.destroy(sid);
    if (user) this.audit.record({ actor: user, acao: 'logout', entidade: 'sessao', entidadeId: user.id, descricao: `${user.usuario} saiu do sistema` });
  }

  /** @returns {object|null} usuário (público) dono da sessão válida e ativa */
  resolveUser(sid) {
    const userId = this.sessions.userIdFor(sid);
    if (!userId) return null;
    const user = this.usuarios.findById(userId);
    if (!user || !user.ativo) {
      this.sessions.destroy(sid);
      return null;
    }
    return usuarioPublico(user);
  }

  /**
   * Senha atual errada conta no throttle (3 erros / 5 min). Após a troca todas as sessões do usuário
   * são encerradas (inclusive a atual): ele precisa entrar de novo com a senha nova.
   */
  trocarSenha(user, atual, nova) {
    const chave = chaveSenha(user);
    if (this.throttle.isBlocked(chave)) throw new TooManyAttemptsError();
    const entidade = this.usuarios.findById(user.id);
    if (!entidade || !this.hasher.verify(String(atual || ''), entidade.senhaHash)) {
      this.throttle.registerFailure(chave);
      throw new ValidationError('Senha atual incorreta');
    }
    if (String(nova || '').length < SENHA_MINIMA) throw new ValidationError(`A senha deve ter ao menos ${SENHA_MINIMA} caracteres`);
    if (nova === atual) throw new ValidationError('A nova senha deve ser diferente da atual');
    this.throttle.reset(chave);
    this.usuarios.updatePassword(entidade.id, this.hasher.hash(nova), false);
    this.sessions.destroyForUser(entidade.id);
    this.audit.record({ actor: user, acao: 'senha', entidade: 'usuario', entidadeId: entidade.id, descricao: `${entidade.usuario} trocou a própria senha` });
  }

  #registrarTentativa(login, acao, descricao) {
    this.audit.record({ actor: AuditTrail.anonymous(login), acao, entidade: 'sessao', descricao });
  }
}

module.exports = AuthService;
