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

  /** Uma consulta agregada: totais dos pedidos FINALIZADOS por cliente (sem N+1). */
  #listar(onde, params, limite) {
    const sql = `SELECT c.id, c.nome, c.telefone, c.criado_em, c.atualizado_em, COALESCE(t.qtd, 0) AS qtd, COALESCE(t.gasto, 0) AS gasto
      FROM clientes c
      LEFT JOIN (SELECT cliente_id, COUNT(*) AS qtd, SUM(total_cents) AS gasto FROM pedidos WHERE status = 'FINALIZADO' GROUP BY cliente_id) t ON t.cliente_id = c.id
      ${onde} ORDER BY c.atualizado_em DESC, c.id DESC ${limite === undefined ? '' : 'LIMIT ?'}`;
    const args = limite === undefined ? params : [...params, limite];
    return this.db.prepare(sql).all(...args).map((r) => ({ ...this.#entidade(r), qtdPedidos: r.qtd, totalGastoCents: r.gasto }));
  }

  /** Todos, do mais recente ao mais antigo (a busca por nome sem acento filtra em JS). */
  todos() {
    return this.#listar('', []);
  }

  recentes(limite) {
    return this.#listar('', [], limite);
  }

  /** Dígitos contidos no número nacional (sem o prefixo +55; o armazenado é +55DDDNÚMERO). */
  porDigitos(digitos, limite) {
    const termo = digitos.length > 2 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
    return this.#listar('WHERE instr(substr(c.telefone, 4), ?) > 0', [termo], limite);
  }

  buscarPorId(id) {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM clientes WHERE id = ?`).get(Number(id));
    return row ? this.#entidade(row) : null;
  }

  /** Totais dos FINALIZADOS e instante em que o mais recente foi finalizado (null se não houver). */
  resumo(id) {
    const r = this.db.prepare(`SELECT COUNT(*) AS qtd, COALESCE(SUM(p.total_cents), 0) AS gasto,
        MAX((SELECT MAX(h.em) FROM pedido_status_historico h WHERE h.pedido_id = p.id AND h.status_novo = 'FINALIZADO')) AS ultima
      FROM pedidos p WHERE p.cliente_id = ? AND p.status = 'FINALIZADO'`).get(Number(id));
    return { qtdPedidos: r.qtd, totalGastoCents: r.gasto, ultimaCompra: r.ultima ?? null };
  }

  /** Pedidos confirmados (status diferente de ABERTO), os mais recentes primeiro. */
  ultimosPedidos(id, limite) {
    return this.db.prepare(`SELECT p.id, p.status, p.total_cents, p.confirmado_em,
        COALESCE((SELECT SUM(i.quantidade) FROM pedido_itens i WHERE i.pedido_id = p.id), 0) AS qtd
      FROM pedidos p WHERE p.cliente_id = ? AND p.status <> 'ABERTO'
      ORDER BY p.confirmado_em DESC, p.id DESC LIMIT ?`).all(Number(id), limite)
      .map((r) => ({ id: r.id, status: r.status, totalCents: r.total_cents, confirmadoEm: r.confirmado_em, quantidadeTotal: r.qtd }));
  }
}

module.exports = ClienteRepository;
