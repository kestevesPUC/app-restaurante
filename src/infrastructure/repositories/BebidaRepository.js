'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');
const { critico } = require('../../domain/estoque/movimentos');

const COLUNAS = 'id, nome, preco_cents, estoque_qtd, estoque_minimo, ativo';

/** Bebidas e o saldo de estoque. Gravação de saldo sempre dentro de uma transação aberta pelo chamador. */
class BebidaRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #entidade(row) {
    const bebida = {
      id: row.id,
      nome: row.nome,
      precoCents: row.preco_cents,
      estoqueQtd: row.estoque_qtd,
      estoqueMinimo: row.estoque_minimo,
      ativo: !!row.ativo,
    };
    return { ...bebida, critico: critico(bebida) };
  }

  findAll() {
    return this.db.prepare(`SELECT ${COLUNAS} FROM bebidas ORDER BY nome COLLATE NOCASE, id`).all().map((r) => this.#entidade(r));
  }

  findCriticas() {
    return this.findAll().filter((b) => b.critico);
  }

  findById(id) {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM bebidas WHERE id = ?`).get(Number(id));
    return row ? this.#entidade(row) : null;
  }

  findByNome(nome) {
    const row = this.db.prepare('SELECT id FROM bebidas WHERE nome_norm = ?').get(normalizarNome(nome));
    return row ? this.findById(row.id) : null;
  }

  create(dados, criadoEm) {
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO bebidas (nome, nome_norm, preco_cents, estoque_qtd, estoque_minimo, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(dados.nome, normalizarNome(dados.nome), dados.precoCents, dados.estoqueInicial, dados.estoqueMinimo, dados.ativo ? 1 : 0, criadoEm);
    return this.findById(Number(lastInsertRowid));
  }

  update(id, dados) {
    this.db.prepare('UPDATE bebidas SET nome = ?, nome_norm = ?, preco_cents = ?, estoque_minimo = ?, ativo = ? WHERE id = ?')
      .run(dados.nome, normalizarNome(dados.nome), dados.precoCents, dados.estoqueMinimo, dados.ativo ? 1 : 0, Number(id));
    return this.findById(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM bebidas WHERE id = ?').run(Number(id));
  }

  definirSaldo(id, saldo) {
    this.db.prepare('UPDATE bebidas SET estoque_qtd = ? WHERE id = ?').run(saldo, Number(id));
  }

  /** Devolve saldo (estorno e entrada): sem restrição de bebida ativa. */
  somarSaldo(id, quantidade) {
    this.db.prepare('UPDATE bebidas SET estoque_qtd = estoque_qtd + ? WHERE id = ?').run(quantidade, Number(id));
  }

  /** Baixa atômica: só acontece se a bebida estiver ativa e houver saldo. @returns {boolean} se baixou */
  baixar(id, quantidade) {
    const { changes } = this.db.prepare('UPDATE bebidas SET estoque_qtd = estoque_qtd - ? WHERE id = ? AND ativo = 1 AND estoque_qtd >= ?')
      .run(quantidade, Number(id), quantidade);
    return changes === 1;
  }
}

module.exports = BebidaRepository;
