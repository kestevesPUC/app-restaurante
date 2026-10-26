'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');

const COLUNAS = 'id, numero, capacidade, situacao, ativo';

/** Persistência das mesas. `numero_norm` (sem acento, minúsculas) garante a unicidade do número. */
class MesaRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #toEntity(row) {
    return row && { id: row.id, numero: row.numero, capacidade: row.capacidade, situacao: row.situacao, ativo: !!row.ativo };
  }

  findAll() {
    return this.db.prepare(`SELECT ${COLUNAS} FROM mesas ORDER BY length(numero_norm), numero_norm, id`).all().map((r) => this.#toEntity(r));
  }

  /** Mesas com `pedidoAberto`: a comanda ABERTO/AGUARDANDO_PAGAMENTO (ou null). */
  findAllComPedidoAberto() {
    const comandas = new Map(this.db.prepare(`SELECT id, mesa_id, numero_dia, situacao, total_cents, criado_em FROM pedidos
      WHERE tipo = 'MESA' AND situacao IN ('ABERTO','AGUARDANDO_PAGAMENTO')`).all().map((r) => [r.mesa_id, {
      id: r.id, numeroDia: r.numero_dia, situacao: r.situacao, totalCents: r.total_cents, criadoEm: r.criado_em,
    }]));
    return this.findAll().map((m) => ({ ...m, pedidoAberto: comandas.get(m.id) ?? null }));
  }

  findById(id) {
    return this.#toEntity(this.db.prepare(`SELECT ${COLUNAS} FROM mesas WHERE id = ?`).get(Number(id)));
  }

  findByNumero(numero) {
    return this.#toEntity(this.db.prepare(`SELECT ${COLUNAS} FROM mesas WHERE numero_norm = ?`).get(normalizarNome(numero)));
  }

  create({ numero, capacidade, situacao = 'LIVRE', ativo }) {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO mesas (numero, numero_norm, capacidade, situacao, ativo) VALUES (?, ?, ?, ?, ?)')
      .run(numero, normalizarNome(numero), capacidade, situacao, ativo ? 1 : 0);
    return this.findById(Number(lastInsertRowid));
  }

  update(id, { numero, capacidade, ativo }) {
    this.db.prepare('UPDATE mesas SET numero = ?, numero_norm = ?, capacidade = ?, ativo = ? WHERE id = ?')
      .run(numero, normalizarNome(numero), capacidade, ativo ? 1 : 0, Number(id));
    return this.findById(id);
  }

  setSituacao(id, situacao) {
    this.db.prepare('UPDATE mesas SET situacao = ? WHERE id = ?').run(situacao, Number(id));
    return this.findById(id);
  }

  delete(id) {
    this.db.prepare('DELETE FROM mesas WHERE id = ?').run(Number(id));
  }
}

module.exports = MesaRepository;
