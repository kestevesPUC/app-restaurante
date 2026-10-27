'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');

const COLUNAS_PEDIDO = `p.id, p.data_local, p.tipo, p.status, p.cliente_id, p.cliente_nome, p.cliente_telefone, p.tempo_estimado_min,
  p.confirmado_em, p.subtotal_cents, p.desconto_cents, p.total_cents, p.observacao, p.criado_por, p.criado_em,
  p.cancelado_em, p.cancelado_por, p.motivo_cancelamento, p.senha`;

/** Colunas de `pedidos` que o serviço pode alterar (camelCase → snake_case). */
const ATUALIZAVEIS = {
  status: 'status', clienteId: 'cliente_id', clienteNome: 'cliente_nome', clienteTelefone: 'cliente_telefone',
  tempoEstimadoMin: 'tempo_estimado_min', confirmadoEm: 'confirmado_em', observacao: 'observacao',
  subtotalCents: 'subtotal_cents', descontoCents: 'desconto_cents', totalCents: 'total_cents',
  canceladoEm: 'cancelado_em', canceladoPor: 'cancelado_por', motivoCancelamento: 'motivo_cancelamento', senha: 'senha',
};

const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);
const marcas = (lista) => lista.map(() => '?').join(',');

/** Persistência dos pedidos, itens (retrato de prato/bebida), modificações e histórico de status. */
class PedidoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
    // Busca sem acento/maiúsculas no nome do cliente (função determinística registrada na conexão).
    db.connection.function('sem_acento', { deterministic: true }, (v) => (v == null ? null : normalizarNome(String(v))));
  }

  #pedido(row) {
    return row && {
      id: row.id, dataLocal: row.data_local, tipo: row.tipo, status: row.status, clienteId: row.cliente_id, clienteNome: row.cliente_nome,
      clienteTelefone: row.cliente_telefone, tempoEstimadoMin: row.tempo_estimado_min, confirmadoEm: row.confirmado_em,
      subtotalCents: row.subtotal_cents, descontoCents: row.desconto_cents, totalCents: row.total_cents, observacao: row.observacao,
      criadoPor: row.criado_por, criadoEm: row.criado_em, canceladoEm: row.cancelado_em, canceladoPor: row.cancelado_por,
      motivoCancelamento: row.motivo_cancelamento, senha: row.senha,
    };
  }

  /** Próxima senha do dia (1, 2, 3…). */
  proximaSenha(dataLocal) {
    return this.db.prepare('SELECT COALESCE(MAX(senha), 0) + 1 AS n FROM pedidos WHERE data_local = ?').get(dataLocal).n;
  }

  findById(id) {
    return this.#pedido(this.db.prepare(`SELECT ${COLUNAS_PEDIDO} FROM pedidos p WHERE p.id = ?`).get(Number(id)));
  }

  insert({ dataLocal, clienteNome, clienteTelefone, observacao, criadoPor, criadoEm }) {
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO pedidos (data_local, tipo, status, cliente_nome, cliente_telefone, observacao, criado_por, criado_em)
      VALUES (?, 'BALCAO', 'ABERTO', ?, ?, ?, ?, ?)`).run(dataLocal, clienteNome ?? null, clienteTelefone ?? null, observacao ?? null, criadoPor, criadoEm);
    return Number(lastInsertRowid);
  }

  update(id, campos) {
    const chaves = Object.keys(campos).filter((k) => Object.hasOwn(ATUALIZAVEIS, k));
    if (!chaves.length) return;
    const sets = chaves.map((k) => `${ATUALIZAVEIS[k]} = ?`).join(', ');
    this.db.prepare(`UPDATE pedidos SET ${sets} WHERE id = ?`).run(...chaves.map((k) => campos[k] ?? null), Number(id));
  }

  /** Grava um item com o retrato do prato/bebida e das modificações. */
  insertItem(pedidoId, item, ordem) {
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO pedido_itens
      (pedido_id, item_tipo, prato_id, bebida_id, item_nome, tempo_preparo_min, preco_unit_cents, adicionais_cents, quantidade, total_cents, observacao, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(pedidoId), item.tipo, item.tipo === 'PRATO' ? item.itemId : null,
      item.tipo === 'BEBIDA' ? item.itemId : null, item.nome, item.tempoPreparoMin, item.precoUnitCents, item.adicionaisCents,
      item.quantidade, item.totalCents, item.observacao ?? null, ordem);
    const itemId = Number(lastInsertRowid);
    const insere = this.db.prepare(`INSERT INTO item_modificacoes (item_id, ingrediente_id, ingrediente_nome, tipo, quantidade, preco_unit_cents)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const mod of item.modificacoes) insere.run(itemId, mod.ingredienteId, mod.ingredienteNome, mod.tipo, mod.quantidade, mod.precoUnitCents);
    return itemId;
  }

  removerItens(pedidoId) {
    this.db.prepare('DELETE FROM pedido_itens WHERE pedido_id = ?').run(Number(pedidoId));
  }

  /** Itens de vários pedidos de uma vez: Map(pedidoId → itens). */
  itensDe(pedidoIds) {
    const porPedido = new Map(pedidoIds.map((id) => [id, []]));
    if (!pedidoIds.length) return porPedido;
    const rows = this.db.prepare(`SELECT * FROM pedido_itens WHERE pedido_id IN (${marcas(pedidoIds)}) ORDER BY pedido_id, ordem, id`).all(...pedidoIds);
    const mods = this.db.prepare(`SELECT im.* FROM item_modificacoes im JOIN pedido_itens i ON i.id = im.item_id
      WHERE i.pedido_id IN (${marcas(pedidoIds)}) ORDER BY im.id`).all(...pedidoIds);
    const modsPorItem = new Map();
    for (const m of mods) {
      if (!modsPorItem.has(m.item_id)) modsPorItem.set(m.item_id, []);
      modsPorItem.get(m.item_id).push({
        id: m.id, ingredienteId: m.ingrediente_id, ingredienteNome: m.ingrediente_nome, tipo: m.tipo, quantidade: m.quantidade, precoUnitCents: m.preco_unit_cents,
      });
    }
    for (const r of rows) {
      porPedido.get(r.pedido_id).push({
        id: r.id, tipo: r.item_tipo, itemId: r.item_tipo === 'PRATO' ? r.prato_id : r.bebida_id, nome: r.item_nome,
        precoUnitCents: r.preco_unit_cents, adicionaisCents: r.adicionais_cents, quantidade: r.quantidade, totalCents: r.total_cents,
        observacao: r.observacao, tempoPreparoMin: r.tempo_preparo_min, modificacoes: modsPorItem.get(r.id) ?? [],
      });
    }
    return porPedido;
  }

  itens(pedidoId) {
    return this.itensDe([Number(pedidoId)]).get(Number(pedidoId));
  }

  /** Registra uma mudança de status (dentro da transação do chamador). */
  registrarHistorico(pedidoId, { de, para, actor, em }) {
    this.db.prepare(`INSERT INTO pedido_status_historico (pedido_id, status_anterior, status_novo, usuario_id, usuario, em)
      VALUES (?, ?, ?, ?, ?, ?)`).run(Number(pedidoId), de, para, actor?.id ?? null, actor?.usuario ?? null, em);
  }

  /** Histórico de vários pedidos: Map(pedidoId → [{ de, para, usuario, em }]) em ordem cronológica. */
  historicoDe(pedidoIds) {
    const porPedido = new Map(pedidoIds.map((id) => [id, []]));
    if (!pedidoIds.length) return porPedido;
    const rows = this.db.prepare(`SELECT * FROM pedido_status_historico WHERE pedido_id IN (${marcas(pedidoIds)}) ORDER BY em, id`).all(...pedidoIds);
    for (const r of rows) porPedido.get(r.pedido_id).push({ de: r.status_anterior, para: r.status_novo, usuario: r.usuario, em: r.em });
    return porPedido;
  }

  pratoJaPedido(pratoId) {
    return !!this.db.prepare('SELECT 1 FROM pedido_itens WHERE prato_id = ? LIMIT 1').get(Number(pratoId));
  }

  /**
   * Lista por id crescente; `de`/`ate` sobre `data_local`. `q`: número exato do pedido, parte do nome (sem acento/maiúsculas)
   * ou dígitos do telefone nacional (`digitos`, já sem o +55).
   */
  listar({ de, ate, status, q, digitos, limite }) {
    const where = ['p.data_local BETWEEN ? AND ?'];
    const params = [de, ate];
    if (status) { where.push('p.status = ?'); params.push(status); }
    const termo = typeof q === 'string' ? q.trim() : '';
    if (termo) {
      const ou = ["sem_acento(p.cliente_nome) LIKE ? ESCAPE '\\'"];
      params.push(`%${escaparLike(normalizarNome(termo))}%`);
      if (/^\d+$/.test(termo)) { ou.push('p.id = ?'); params.push(Number(termo)); }
      if (digitos) { ou.push("substr(p.cliente_telefone, 4) LIKE ? ESCAPE '\\'"); params.push(`%${escaparLike(digitos)}%`); }
      where.push(`(${ou.join(' OR ')})`);
    }
    params.push(limite);
    return this.db.prepare(`SELECT ${COLUNAS_PEDIDO} FROM pedidos p WHERE ${where.join(' AND ')} ORDER BY p.id ASC LIMIT ?`).all(...params)
      .map((r) => this.#pedido(r));
  }

  /** Pedidos ativos na cozinha (RECEBIDO, EM_PREPARO, PRONTO_*), por confirmação e id. */
  listarCozinha() {
    return this.db.prepare(`SELECT ${COLUNAS_PEDIDO} FROM pedidos p
      WHERE p.status IN ('RECEBIDO','EM_PREPARO','PRONTO_RETIRADA','PRONTO_ENTREGA') ORDER BY p.confirmado_em ASC, p.id ASC`).all()
      .map((r) => this.#pedido(r));
  }
}

module.exports = PedidoRepository;
