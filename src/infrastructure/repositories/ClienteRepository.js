'use strict';

const COLUNAS = 'id, nome, telefone, criado_em, atualizado_em';

/** Clientes da lanchonete (um por telefone normalizado). Escritas dentro da transação do chamador. */
class ClienteRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #entidade(row) {
    return { id: row.id, nome: row.nome, telefone: row.telefone, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em };
  }

  findByTelefone(telefone) {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM clientes WHERE telefone = ?`).get(telefone);
    return row ? this.#entidade(row) : null;
  }

  create(nome, telefone, em) {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO clientes (nome, telefone, criado_em, atualizado_em) VALUES (?, ?, ?, ?)').run(nome, telefone, em, em);
    return this.#entidade(this.db.prepare(`SELECT ${COLUNAS} FROM clientes WHERE id = ?`).get(Number(lastInsertRowid)));
  }

  atualizarNome(id, nome, em) {
    this.db.prepare('UPDATE clientes SET nome = ?, atualizado_em = ? WHERE id = ?').run(nome, em, Number(id));
  }

  /** Todos, do mais recente ao mais antigo (a busca por nome sem acento filtra em JS). */
  todos() {
    return this.db.prepare(`SELECT ${COLUNAS} FROM clientes ORDER BY atualizado_em DESC, id DESC`).all().map((r) => this.#entidade(r));
  }

  recentes(limite) {
    return this.db.prepare(`SELECT ${COLUNAS} FROM clientes ORDER BY atualizado_em DESC, id DESC LIMIT ?`).all(limite).map((r) => this.#entidade(r));
  }

  /** Telefone contém os dígitos (LIKE com escape; dígitos não têm curinga, mas o escape é mantido por segurança). */
  porDigitos(digitos, limite) {
    const padrao = `%${digitos.replace(/[!%_]/g, '!$&')}%`;
    return this.db.prepare(`SELECT ${COLUNAS} FROM clientes WHERE telefone LIKE ? ESCAPE '!' ORDER BY atualizado_em DESC, id DESC LIMIT ?`)
      .all(padrao, limite).map((r) => this.#entidade(r));
  }
}

module.exports = ClienteRepository;
