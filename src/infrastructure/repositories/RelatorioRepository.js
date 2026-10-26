'use strict';

/** Última entrada em FINALIZADO de cada pedido (um pedido finalizado mais de uma vez conta pela última). */
const ULTIMA_FINALIZACAO = `SELECT pedido_id, MAX(em) AS em FROM pedido_status_historico WHERE status_novo = 'FINALIZADO' GROUP BY pedido_id`;
const ITENS = `(SELECT COALESCE(SUM(i.quantidade), 0) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.cancelado_em IS NULL)`;

/** Consultas de leitura dos relatórios: uma consulta por relatório, limites `[inicio, fim)` em ISO UTC. */
class RelatorioRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  /** Pedidos confirmados (status ≠ ABERTO) com `confirmado_em` no período. */
  pedidosConfirmados(inicio, fim) {
    return this.db.prepare(`SELECT p.id, p.confirmado_em, p.cliente_nome, p.cliente_telefone, p.total_cents, p.status, ${ITENS} AS itens
      FROM pedidos p WHERE p.status <> 'ABERTO' AND p.confirmado_em >= ? AND p.confirmado_em < ? ORDER BY p.confirmado_em, p.id`).all(inicio, fim);
  }

  /** Pedidos FINALIZADOS cuja última finalização caiu no período (com o cadastro do cliente, se houver). */
  pedidosFinalizados(inicio, fim) {
    return this.db.prepare(`SELECT p.id, f.em AS finalizado_em, p.cliente_id, COALESCE(c.nome, p.cliente_nome) AS cliente_nome,
        COALESCE(c.telefone, p.cliente_telefone) AS cliente_telefone, p.total_cents, ${ITENS} AS itens
      FROM pedidos p JOIN (${ULTIMA_FINALIZACAO}) f ON f.pedido_id = p.id LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.status = 'FINALIZADO' AND f.em >= ? AND f.em < ? ORDER BY f.em, p.id`).all(inicio, fim);
  }

  pedidosCancelados(inicio, fim) {
    return this.db.prepare(`SELECT p.id, p.cancelado_em, p.cliente_nome, p.cliente_telefone, p.total_cents, p.motivo_cancelamento
      FROM pedidos p WHERE p.status = 'CANCELADO' AND p.cancelado_em >= ? AND p.cancelado_em < ? ORDER BY p.cancelado_em, p.id`).all(inicio, fim);
  }

  /** Histórico completo (em ordem) dos pedidos não cancelados com alguma entrada PRONTO_* no período. */
  historicoDePreparo(inicio, fim) {
    return this.db.prepare(`SELECT h.pedido_id, h.status_novo, h.em, p.cliente_nome
      FROM pedido_status_historico h JOIN pedidos p ON p.id = h.pedido_id
      WHERE p.status <> 'CANCELADO' AND h.pedido_id IN (SELECT pedido_id FROM pedido_status_historico
        WHERE status_novo IN ('PRONTO_RETIRADA','PRONTO_ENTREGA') AND em >= ? AND em < ?)
      ORDER BY h.pedido_id, h.em, h.id`).all(inicio, fim);
  }

  /** Itens de BEBIDA (não cancelados) de pedidos finalizados no período, somados por bebida; nome do item mais recente. */
  bebidasVendidas(inicio, fim) {
    return this.db.prepare(`SELECT i.bebida_id, SUM(i.quantidade) AS quantidade, SUM(i.total_cents) AS total_cents,
        (SELECT i2.item_nome FROM pedido_itens i2 WHERE i2.bebida_id = i.bebida_id ORDER BY i2.id DESC LIMIT 1) AS nome
      FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id JOIN (${ULTIMA_FINALIZACAO}) f ON f.pedido_id = p.id
      WHERE i.item_tipo = 'BEBIDA' AND i.cancelado_em IS NULL AND p.status = 'FINALIZADO' AND f.em >= ? AND f.em < ?
      GROUP BY i.bebida_id`).all(inicio, fim);
  }

  bebidas() {
    return this.db.prepare('SELECT id, nome, estoque_qtd, estoque_minimo, ativo FROM bebidas').all();
  }
}

module.exports = RelatorioRepository;
