'use strict';

const COLUNAS = 'id, bebida_id, tipo, quantidade, saldo_apos, motivo, pedido_id, usuario, em';

/** Histórico de movimentações de estoque (somente inserção). */
class MovimentacaoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  insert({ bebidaId, tipo, quantidade, saldoApos, motivo = null, pedidoId = null, actor, em }) {
    this.db.prepare(
      'INSERT INTO movimentacoes_estoque (bebida_id, tipo, quantidade, saldo_apos, motivo, pedido_id, usuario_id, usuario, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Number(bebidaId), tipo, quantidade, saldoApos, motivo, pedidoId, actor?.id ?? null, actor?.usuario ?? null, em);
  }

  /** Mais recentes primeiro. */
  listar(bebidaId, limite) {
    return this.db.prepare(`SELECT ${COLUNAS} FROM movimentacoes_estoque WHERE bebida_id = ? ORDER BY id DESC LIMIT ?`)
      .all(Number(bebidaId), limite).map((r) => ({
        id: r.id,
        bebidaId: r.bebida_id,
        tipo: r.tipo,
        quantidade: r.quantidade,
        saldoApos: r.saldo_apos,
        motivo: r.motivo,
        pedidoId: r.pedido_id,
        usuario: r.usuario,
        em: r.em,
      }));
  }

  /** Quantidade baixada e ainda não devolvida por bebida para o pedido (soma de VENDA − ESTORNO). */
  liquidoBaixadoPorBebida(pedidoId) {
    return this.db.prepare(`
      SELECT bebida_id, -SUM(quantidade) AS liquido FROM movimentacoes_estoque
      WHERE pedido_id = ? AND tipo IN ('VENDA','ESTORNO') GROUP BY bebida_id ORDER BY bebida_id`).all(Number(pedidoId))
      .map((r) => ({ bebidaId: r.bebida_id, liquido: r.liquido }));
  }

  /** Movimentos que impedem excluir a bebida: qualquer um além do "Estoque inicial". */
  contarAlemDoInicial(bebidaId) {
    return this.db.prepare(
      "SELECT COUNT(*) AS n FROM movimentacoes_estoque WHERE bebida_id = ? AND NOT (tipo = 'ENTRADA' AND COALESCE(motivo, '') = 'Estoque inicial')",
    ).get(Number(bebidaId)).n;
  }

  excluirDaBebida(bebidaId) {
    this.db.prepare('DELETE FROM movimentacoes_estoque WHERE bebida_id = ?').run(Number(bebidaId));
  }
}

module.exports = MovimentacaoRepository;
