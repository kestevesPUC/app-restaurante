'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');

const COLUNAS_PEDIDO = `p.id, p.data_local, p.numero_dia, p.tipo, p.mesa_id, m.numero AS mesa_numero, p.cliente_nome, p.situacao,
  p.subtotal_cents, p.desconto_cents, p.total_cents, p.observacao, p.criado_por, u.usuario AS atendente, p.criado_em,
  p.finalizado_em, p.pago_em, p.cancelado_em, p.cancelado_por, p.motivo_cancelamento,
  (SELECT COALESCE(SUM(i.quantidade), 0) FROM pedido_itens i WHERE i.pedido_id = p.id AND i.cancelado_em IS NULL) AS qtd_itens`;
const FROM_PEDIDO = 'FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN usuarios u ON u.id = p.criado_por';

/** Colunas de `pedidos` que o serviço pode alterar (camelCase → snake_case). */
const ATUALIZAVEIS = {
  mesaId: 'mesa_id', clienteNome: 'cliente_nome', observacao: 'observacao', situacao: 'situacao',
  subtotalCents: 'subtotal_cents', descontoCents: 'desconto_cents', totalCents: 'total_cents',
  finalizadoEm: 'finalizado_em', pagoEm: 'pago_em', canceladoEm: 'cancelado_em', canceladoPor: 'cancelado_por', motivoCancelamento: 'motivo_cancelamento',
};

const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Persistência dos pedidos, rodadas (`pedido_envios`), itens e modificações (retrato do cardápio, RN-06). */
class PedidoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
    // Busca sem acento/maiúsculas no nome do cliente (função determinística registrada na conexão).
    db.connection.function('sem_acento', { deterministic: true }, (v) => (v == null ? null : normalizarNome(String(v))));
  }

  #pedido(row) {
    return row && {
      id: row.id, dataLocal: row.data_local, numeroDia: row.numero_dia, tipo: row.tipo, mesaId: row.mesa_id, mesaNumero: row.mesa_numero ?? null,
      clienteNome: row.cliente_nome, situacao: row.situacao, subtotalCents: row.subtotal_cents, descontoCents: row.desconto_cents,
      totalCents: row.total_cents, observacao: row.observacao, criadoPor: row.criado_por, atendente: row.atendente ?? null, criadoEm: row.criado_em,
      finalizadoEm: row.finalizado_em, pagoEm: row.pago_em, canceladoEm: row.cancelado_em, canceladoPor: row.cancelado_por,
      motivoCancelamento: row.motivo_cancelamento, qtdItens: row.qtd_itens, forma: null,
    };
  }

  #envio(row) {
    return row && {
      id: row.id, pedidoId: row.pedido_id, rodada: row.rodada, cozinhaSituacao: row.cozinha_situacao, vaiParaCozinha: !!row.vai_para_cozinha,
      enviadoEm: row.enviado_em, enviadoPor: row.enviado_por, preparoIniciadoEm: row.preparo_iniciado_em, prontoEm: row.pronto_em, entregueEm: row.entregue_em,
    };
  }

  findById(id) {
    return this.#pedido(this.db.prepare(`SELECT ${COLUNAS_PEDIDO} ${FROM_PEDIDO} WHERE p.id = ?`).get(Number(id)));
  }

  /** Próximo número do dia; chamar dentro da mesma transação da inserção. */
  proximoNumero(dataLocal) {
    return this.db.prepare('SELECT COALESCE(MAX(numero_dia), 0) + 1 AS n FROM pedidos WHERE data_local = ?').get(dataLocal).n;
  }

  insert({ dataLocal, numeroDia, tipo, mesaId, clienteNome, observacao, criadoPor, criadoEm }) {
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO pedidos (data_local, numero_dia, tipo, mesa_id, cliente_nome, observacao, criado_por, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(dataLocal, numeroDia, tipo, mesaId ?? null, clienteNome ?? null, observacao ?? null, criadoPor, criadoEm);
    return Number(lastInsertRowid);
  }

  update(id, campos) {
    const chaves = Object.keys(campos).filter((k) => Object.hasOwn(ATUALIZAVEIS, k));
    if (!chaves.length) return;
    const sets = chaves.map((k) => `${ATUALIZAVEIS[k]} = ?`).join(', ');
    this.db.prepare(`UPDATE pedidos SET ${sets} WHERE id = ?`).run(...chaves.map((k) => campos[k] ?? null), Number(id));
  }

  /** Grava um item com o retrato do prato e das modificações. */
  insertItem(pedidoId, item, ordem) {
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO pedido_itens
      (pedido_id, prato_id, prato_nome, preco_unit_cents, adicionais_cents, quantidade, total_cents, observacao, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(pedidoId), item.pratoId, item.pratoNome, item.precoUnitCents, item.adicionaisCents,
      item.quantidade, item.totalCents, item.observacao ?? null, ordem);
    const itemId = Number(lastInsertRowid);
    const insere = this.db.prepare(`INSERT INTO item_modificacoes (item_id, ingrediente_id, ingrediente_nome, tipo, quantidade, preco_unit_cents)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const mod of item.modificacoes) insere.run(itemId, mod.ingredienteId, mod.ingredienteNome, mod.tipo, mod.quantidade, mod.precoUnitCents);
    return itemId;
  }

  proximaOrdem(pedidoId) {
    return this.db.prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS o FROM pedido_itens WHERE pedido_id = ?').get(Number(pedidoId)).o;
  }

  removerPendentes(pedidoId) {
    this.db.prepare('DELETE FROM pedido_itens WHERE pedido_id = ? AND envio_id IS NULL').run(Number(pedidoId));
  }

  itens(pedidoId) {
    const rows = this.db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY ordem, id').all(Number(pedidoId));
    const mods = this.db.prepare(`SELECT im.* FROM item_modificacoes im JOIN pedido_itens i ON i.id = im.item_id
      WHERE i.pedido_id = ? ORDER BY im.id`).all(Number(pedidoId));
    return rows.map((r) => ({
      id: r.id, pedidoId: r.pedido_id, envioId: r.envio_id, pratoId: r.prato_id, pratoNome: r.prato_nome, precoUnitCents: r.preco_unit_cents,
      adicionaisCents: r.adicionais_cents, quantidade: r.quantidade, totalCents: r.total_cents, observacao: r.observacao, ordem: r.ordem,
      canceladoEm: r.cancelado_em, canceladoPor: r.cancelado_por, motivoCancelamento: r.motivo_cancelamento, cancelado: r.cancelado_em !== null,
      modificacoes: mods.filter((m) => m.item_id === r.id).map((m) => ({
        id: m.id, ingredienteId: m.ingrediente_id, ingredienteNome: m.ingrediente_nome, tipo: m.tipo, quantidade: m.quantidade, precoUnitCents: m.preco_unit_cents,
      })),
    }));
  }

  cancelarItem(itemId, { canceladoEm, canceladoPor, motivo }) {
    this.db.prepare('UPDATE pedido_itens SET cancelado_em = ?, cancelado_por = ?, motivo_cancelamento = ? WHERE id = ?')
      .run(canceladoEm, canceladoPor, motivo, Number(itemId));
  }

  envios(pedidoId) {
    return this.db.prepare('SELECT * FROM pedido_envios WHERE pedido_id = ? ORDER BY rodada').all(Number(pedidoId)).map((r) => this.#envio(r));
  }

  /** Itens pendentes (sem rodada, não cancelados) com o `vai_para_cozinha` da categoria atual do prato. */
  pendentesParaEnvio(pedidoId) {
    return this.db.prepare(`SELECT i.id, c.vai_para_cozinha FROM pedido_itens i JOIN pratos pr ON pr.id = i.prato_id
      JOIN categorias c ON c.id = pr.categoria_id WHERE i.pedido_id = ? AND i.envio_id IS NULL AND i.cancelado_em IS NULL`).all(Number(pedidoId));
  }

  /** Cria a rodada N+1 e liga a ela os itens pendentes. */
  criarEnvio(pedidoId, { vaiParaCozinha, enviadoEm, enviadoPor }) {
    const rodada = this.db.prepare('SELECT COALESCE(MAX(rodada), 0) + 1 AS r FROM pedido_envios WHERE pedido_id = ?').get(Number(pedidoId)).r;
    const { lastInsertRowid } = this.db.prepare(`INSERT INTO pedido_envios (pedido_id, rodada, cozinha_situacao, vai_para_cozinha, enviado_em, enviado_por)
      VALUES (?, ?, 'NA_FILA', ?, ?, ?)`).run(Number(pedidoId), rodada, vaiParaCozinha ? 1 : 0, enviadoEm, enviadoPor ?? null);
    const envioId = Number(lastInsertRowid);
    this.db.prepare('UPDATE pedido_itens SET envio_id = ? WHERE pedido_id = ? AND envio_id IS NULL AND cancelado_em IS NULL').run(envioId, Number(pedidoId));
    return this.#envio(this.db.prepare('SELECT * FROM pedido_envios WHERE id = ?').get(envioId));
  }

  /** Comanda de mesa ainda não paga (ABERTO ou AGUARDANDO_PAGAMENTO), ou null. */
  comandaNaoPagaDaMesa(mesaId) {
    const row = this.db.prepare(`SELECT id FROM pedidos WHERE mesa_id = ? AND tipo = 'MESA'
      AND situacao IN ('ABERTO','AGUARDANDO_PAGAMENTO')`).get(Number(mesaId));
    return row ? row.id : null;
  }

  pratoJaPedido(pratoId) {
    return !!this.db.prepare('SELECT 1 FROM pedido_itens WHERE prato_id = ? LIMIT 1').get(Number(pratoId));
  }

  /** Lista por id crescente; `de`/`ate` sobre `data_local`; `q` = número do dia ou parte do nome do cliente. */
  listar({ de, ate, situacao, mesaId, atendenteId, q }) {
    const where = ['p.data_local BETWEEN ? AND ?'];
    const params = [de, ate];
    if (situacao) { where.push('p.situacao = ?'); params.push(situacao); }
    if (mesaId) { where.push('p.mesa_id = ?'); params.push(Number(mesaId)); }
    if (atendenteId) { where.push('p.criado_por = ?'); params.push(Number(atendenteId)); }
    const termo = typeof q === 'string' ? q.trim() : '';
    if (termo) {
      const numero = /^\d+$/.test(termo) ? Number(termo) : -1;
      where.push("(p.numero_dia = ? OR sem_acento(p.cliente_nome) LIKE ? ESCAPE '\\')");
      params.push(numero, `%${escaparLike(normalizarNome(termo))}%`);
    }
    return this.db.prepare(`SELECT ${COLUNAS_PEDIDO} ${FROM_PEDIDO} WHERE ${where.join(' AND ')} ORDER BY p.id ASC`).all(...params)
      .map((r) => this.#pedido(r));
  }
}

module.exports = PedidoRepository;
