'use strict';

/** Garante que exista ao menos um usuário: cria ADMIN (nível A) com senha provisória na primeira execução (RN-01). */
class AdminBootstrap {
  /** @param {{usuarios: object, hasher: object, audit: import('./AuditTrail'), clock?: () => Date}} deps */
  constructor({ usuarios, hasher, audit, clock = () => new Date() }) {
    this.usuarios = usuarios;
    this.hasher = hasher;
    this.audit = audit;
    this.clock = clock;
  }

  /** @returns {{senhaProvisoria: string}|null} null se já havia usuários */
  run() {
    if (this.usuarios.count() > 0) return null;
    const senhaProvisoria = this.hasher.generateTemporary();
    const admin = this.usuarios.create({
      usuario: 'ADMIN', nome: 'Administrador', nivel: 'A', senhaHash: this.hasher.hash(senhaProvisoria), mustChange: true, criadoEm: this.clock().toISOString(),
    });
    this.audit.record({
      actor: null, acao: 'criar', entidade: 'usuario', entidadeId: admin.id, descricao: 'Usuário ADMIN inicial criado pelo sistema',
      depois: { id: admin.id, usuario: 'ADMIN', nivel: 'A' },
    });
    return { senhaProvisoria };
  }
}

module.exports = AdminBootstrap;
