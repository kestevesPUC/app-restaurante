'use strict';

const toEntity = (row) => row && {
  id: row.id,
  usuario: row.usuario,
  nome: row.nome,
  nivel: row.nivel,
  senhaHash: row.senha_hash,
  mustChange: !!row.must_change,
  ativo: !!row.ativo,
  criadoEm: row.criado_em,
};

class UsuarioRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  findAll() {
    return this.db.prepare('SELECT * FROM usuarios ORDER BY usuario').all().map(toEntity);
  }

  findById(id) {
    return toEntity(this.db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id))) || null;
  }

  findByUsuario(usuario) {
    return toEntity(this.db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario)) || null;
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  }

  /** Quantidade de administradores ativos (para proteger o último). */
  countAdministradoresAtivos() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE nivel = 'A' AND ativo = 1").get().n;
  }

  /** @param {{usuario:string, nome:string, nivel:string, senhaHash:string, mustChange?:boolean, criadoEm:string}} u */
  create(u) {
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO usuarios (usuario, nome, nivel, senha_hash, must_change, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(u.usuario, u.nome, u.nivel, u.senhaHash, u.mustChange === false ? 0 : 1, u.criadoEm);
    return this.findById(Number(lastInsertRowid));
  }

  update(id, { nome, nivel, ativo }) {
    this.db.prepare('UPDATE usuarios SET nome = ?, nivel = ?, ativo = ? WHERE id = ?').run(nome, nivel, ativo ? 1 : 0, Number(id));
    return this.findById(id);
  }

  updatePassword(id, senhaHash, mustChange) {
    this.db.prepare('UPDATE usuarios SET senha_hash = ?, must_change = ? WHERE id = ?').run(senhaHash, mustChange ? 1 : 0, Number(id));
  }
}

module.exports = UsuarioRepository;
