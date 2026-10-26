'use strict';
const ValidationError = require('../domain/errors/ValidationError');
const ConflictError = require('../domain/errors/ConflictError');
const NotFoundError = require('../domain/errors/NotFoundError');
const { nivelValido } = require('../domain/niveis');
const { usuarioPublico, usuarioSnapshot } = require('../domain/usuarioPublico');

/** Administração de usuários (RN-01). A autorização (nível A) é aplicada na rota; tudo é auditado. */
class UsuarioService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/UsuarioRepository')} deps.usuarios
   * @param {import('../infrastructure/security/PasswordHasher')} deps.hasher
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/security/SessionStore')} [deps.sessions]
   * @param {() => Date} [deps.clock]
   */
  constructor({ usuarios, hasher, audit, sessions = null, clock = () => new Date() }) {
    this.usuarios = usuarios;
    this.hasher = hasher;
    this.audit = audit;
    this.sessions = sessions;
    this.clock = clock;
  }

  listar() {
    return this.usuarios.findAll().map(usuarioPublico);
  }

  /** @returns {{user: object, senhaProvisoria: string}} a senha provisória só é exibida nesta resposta */
  criar(actor, { usuario, nome, nivel }) {
    const login = String(usuario || '').trim().toUpperCase();
    const nivelUpper = String(nivel || '').toUpperCase();
    if (!login || /\s/.test(login)) throw new ValidationError('Informe o usuário (sem espaços)');
    if (!nivelValido(nivelUpper)) throw new ValidationError('Nível inválido (A, B ou C)');
    if (this.usuarios.findByUsuario(login)) throw new ConflictError('Usuário já existe');
    const senhaProvisoria = this.hasher.generateTemporary();
    const criado = this.usuarios.create({
      usuario: login,
      nome: String(nome || '').trim() || login,
      nivel: nivelUpper,
      senhaHash: this.hasher.hash(senhaProvisoria),
      mustChange: true,
      criadoEm: this.clock().toISOString(),
    });
    this.audit.record({
      actor, acao: 'criar', entidade: 'usuario', entidadeId: criado.id,
      descricao: `Usuário ${criado.usuario} criado (nível ${criado.nivel})`, depois: usuarioSnapshot(criado),
    });
    return { user: usuarioPublico(criado), senhaProvisoria };
  }

  /** Altera nome, nível e/ou situação (ativo). Protege o último administrador e o próprio ator. */
  atualizar(actor, id, dados) {
    const antes = this.#exigir(id);
    const nome = dados.nome === undefined ? antes.nome : String(dados.nome).trim() || antes.nome;
    const nivel = dados.nivel === undefined ? antes.nivel : String(dados.nivel).toUpperCase();
    const ativo = dados.ativo === undefined ? antes.ativo : !!dados.ativo;
    if (!nivelValido(nivel)) throw new ValidationError('Nível inválido (A, B ou C)');

    const perdeAdmin = antes.nivel === 'A' && antes.ativo && (nivel !== 'A' || !ativo);
    if (perdeAdmin && this.usuarios.countAdministradoresAtivos() <= 1) {
      throw new ConflictError('Não é possível rebaixar nem desativar o último administrador');
    }
    if (antes.ativo && !ativo && actor?.id === antes.id) throw new ConflictError('Não é possível desativar a si mesmo');

    const depois = this.usuarios.update(antes.id, { nome, nivel, ativo });
    if ((antes.ativo && !ativo) || nivel !== antes.nivel) this.sessions?.destroyForUser(antes.id);
    this.audit.record({
      actor, acao: 'alterar', entidade: 'usuario', entidadeId: antes.id, descricao: `Usuário ${antes.usuario} alterado`,
      antes: usuarioSnapshot(antes), depois: usuarioSnapshot(depois),
    });
    return usuarioPublico(depois);
  }

  /** Gera nova senha provisória, exige troca no próximo acesso e encerra as sessões do usuário. */
  resetarSenha(actor, id) {
    const alvo = this.#exigir(id);
    const senhaProvisoria = this.hasher.generateTemporary();
    this.usuarios.updatePassword(alvo.id, this.hasher.hash(senhaProvisoria), true);
    this.sessions?.destroyForUser(alvo.id);
    this.audit.record({ actor, acao: 'senha', entidade: 'usuario', entidadeId: alvo.id, descricao: `${actor.usuario} redefiniu a senha de ${alvo.usuario}` });
    return { senhaProvisoria };
  }

  #exigir(id) {
    const user = this.usuarios.findById(id);
    if (!user) throw new NotFoundError('Usuário não encontrado');
    return user;
  }
}

module.exports = UsuarioService;
