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

  /** Pedidos ainda prontos cujo aviso automático falhou só porque o WhatsApp estava desconectado (e que depois não foram avisados). */
  pedidosComAvisoPendente() {
    return this.db.prepare(`SELECT DISTINCT n.pedido_id AS id FROM notificacoes_whatsapp n JOIN pedidos p ON p.id = n.pedido_id
      WHERE p.status IN ('PRONTO_RETIRADA','PRONTO_ENTREGA') AND n.situacao = 'FALHOU' AND n.erro LIKE '%não está conectado%'
        AND NOT EXISTS (SELECT 1 FROM notificacoes_whatsapp o WHERE o.pedido_id = n.pedido_id AND o.situacao = 'ENVIADA' AND o.id > n.id)`)
      .all().map((r) => r.id);
  }

  /** Mais recente primeiro. */
  listarPorPedido(pedidoId) {
    return this.db.prepare(`SELECT ${COLUNAS} FROM notificacoes_whatsapp WHERE pedido_id = ? ORDER BY id DESC`).all(pedidoId).map((r) => this.#entidade(r));
  }
}

module.exports = NotificacaoRepository;
