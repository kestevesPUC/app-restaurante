'use strict';

const COLUNAS = 'id, descricao, tipo, chave, nome_recebedor, cidade, padrao';

/** Persistência das chaves PIX. Um índice único parcial garante no máximo uma chave padrão. */
class ChavePixRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #toEntity(row) {
    return row && {
      id: row.id, descricao: row.descricao, tipo: row.tipo, chave: row.chave, nomeRecebedor: row.nome_recebedor, cidade: row.cidade, padrao: !!row.padrao,
    };
  }

  findAll() {
    return this.db.prepare(`SELECT ${COLUNAS} FROM chaves_pix ORDER BY padrao DESC, descricao, id`).all().map((r) => this.#toEntity(r));
  }

  findById(id) {
    return this.#toEntity(this.db.prepare(`SELECT ${COLUNAS} FROM chaves_pix WHERE id = ?`).get(Number(id)));
  }

  findByChave(chave) {
    return this.#toEntity(this.db.prepare(`SELECT ${COLUNAS} FROM chaves_pix WHERE chave = ?`).get(chave));
  }

  findPadrao() {
    return this.#toEntity(this.db.prepare(`SELECT ${COLUNAS} FROM chaves_pix WHERE padrao = 1`).get());
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM chaves_pix').get().n;
  }

  create({ descricao, tipo, chave, nomeRecebedor, cidade }, criadoEm) {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO chaves_pix (descricao, tipo, chave, nome_recebedor, cidade, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
      .run(descricao, tipo, chave, nomeRecebedor, cidade, criadoEm);
    return this.findById(Number(lastInsertRowid));
  }

  update(id, { descricao, tipo, chave, nomeRecebedor, cidade }) {
    this.db.prepare('UPDATE chaves_pix SET descricao = ?, tipo = ?, chave = ?, nome_recebedor = ?, cidade = ? WHERE id = ?')
      .run(descricao, tipo, chave, nomeRecebedor, cidade, Number(id));
    return this.findById(id);
  }

  /** Torna `id` a única chave padrão. */
  definirPadrao(id) {
    this.db.prepare('UPDATE chaves_pix SET padrao = 0 WHERE padrao = 1').run();
    this.db.prepare('UPDATE chaves_pix SET padrao = 1 WHERE id = ?').run(Number(id));
    return this.findById(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM chaves_pix WHERE id = ?').run(Number(id));
  }
}

module.exports = ChavePixRepository;
