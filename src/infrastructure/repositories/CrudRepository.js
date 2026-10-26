'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');

/**
 * CRUD genérico de tabelas simples com `nome` único sem acento (`nome_norm`).
 * Subclasses declaram tabela, campos (`prop` da API -> `col` do banco, `bool` para 0/1) e ordenação.
 */
class CrudRepository {
  /**
   * @param {import('../database/SqliteDatabase')} db
   * @param {string} table nome fixo da tabela (nunca vem de entrada do usuário)
   * @param {{prop:string, col:string, bool?:boolean}[]} fields campos graváveis (inclui `nome`)
   * @param {string} orderBy cláusula ORDER BY fixa
   */
  constructor(db, table, fields, orderBy = 'nome COLLATE NOCASE, id') {
    this.db = db;
    this.table = table;
    this.fields = fields;
    this.orderBy = orderBy;
    this.select = `SELECT id, ${fields.map((f) => f.col).join(', ')} FROM ${table}`;
  }

  #toEntity(row) {
    if (!row) return null;
    const entity = { id: row.id };
    for (const f of this.fields) entity[f.prop] = f.bool ? !!row[f.col] : row[f.col];
    return entity;
  }

  #values(data) {
    return this.fields.map((f) => (f.bool ? (data[f.prop] ? 1 : 0) : data[f.prop]));
  }

  findAll() {
    return this.db.prepare(`${this.select} ORDER BY ${this.orderBy}`).all().map((r) => this.#toEntity(r));
  }

  findById(id) {
    return this.#toEntity(this.db.prepare(`${this.select} WHERE id = ?`).get(Number(id)));
  }

  /** Registro (se houver) com o mesmo nome, ignorando acento e maiúsculas. */
  findByNome(nome) {
    return this.#toEntity(this.db.prepare(`${this.select} WHERE nome_norm = ?`).get(normalizarNome(nome)));
  }

  create(data) {
    const cols = [...this.fields.map((f) => f.col), 'nome_norm'];
    const marks = cols.map(() => '?').join(', ');
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${marks})`)
      .run(...this.#values(data), normalizarNome(data.nome));
    return this.findById(Number(lastInsertRowid));
  }

  update(id, data) {
    const sets = [...this.fields.map((f) => `${f.col} = ?`), 'nome_norm = ?'].join(', ');
    this.db.prepare(`UPDATE ${this.table} SET ${sets} WHERE id = ?`).run(...this.#values(data), normalizarNome(data.nome), Number(id));
    return this.findById(id);
  }

  delete(id) {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(Number(id));
  }
}

module.exports = CrudRepository;
