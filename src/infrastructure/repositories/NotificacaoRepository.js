'use strict';

const COLUNAS = 'id, pedido_id, tipo, telefone, texto, situacao, erro, automatica, enviada_por, em';

/** Histórico de mensagens de WhatsApp por pedido (tabela `notificacoes_whatsapp`). */
class NotificacaoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #entidade(r) {
    return {
      id: r.id, pedidoId: r.pedido_id, tipo: r.tipo, telefone: r.telefone, texto: r.texto, situacao: r.situacao,
      erro: r.erro, automatica: r.automatica, enviadaPor: r.enviada_por, em: r.em,
    };
  }

  insert({ pedidoId, tipo, telefone, texto, situacao, erro = null, automatica, enviadaPor = null, em }) {
    const { lastInsertRowid } = this.db.prepare(
      `INSERT INTO notificacoes_whatsapp (pedido_id, tipo, telefone, texto, situacao, erro, automatica, enviada_por, em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(pedidoId, tipo, telefone, texto, situacao, erro, automatica ? 1 : 0, enviadaPor, em);
    return this.findById(Number(lastInsertRowid));
  }

  findById(id) {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM notificacoes_whatsapp WHERE id = ?`).get(id);
    return row ? this.#entidade(row) : null;
  }

  /** Mais recente primeiro. */
  listarPorPedido(pedidoId) {
    return this.db.prepare(`SELECT ${COLUNAS} FROM notificacoes_whatsapp WHERE pedido_id = ? ORDER BY id DESC`).all(pedidoId).map((r) => this.#entidade(r));
  }
}

module.exports = NotificacaoRepository;
