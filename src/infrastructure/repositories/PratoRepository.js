'use strict';
const { normalizarNome } = require('../../domain/cardapio/validators');

const COLUNAS = 'id, nome, codigo, categoria_id, descricao, preco_cents, tempo_preparo_min, ativo, foto IS NOT NULL AS tem_foto';

/** Pratos e a lista de ingredientes de cada um (`prato_ingredientes`). Gravação sempre em transação. */
class PratoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  #entidade(row, ingredientes) {
    return {
      id: row.id,
      nome: row.nome,
      codigo: row.codigo,
      categoriaId: row.categoria_id,
      descricao: row.descricao,
      precoCents: row.preco_cents,
      tempoPreparoMin: row.tempo_preparo_min,
      ativo: !!row.ativo,
      temFoto: !!row.tem_foto,
      ingredientes,
    };
  }

  #ingredientesPorPrato(where = '', ...params) {
    const linhas = this.db.prepare(`
      SELECT pi.prato_id, pi.ingrediente_id, i.nome, pi.removivel, pi.quantidade, pi.ordem
      FROM prato_ingredientes pi JOIN ingredientes i ON i.id = pi.ingrediente_id ${where}
      ORDER BY pi.ordem, i.nome COLLATE NOCASE, pi.ingrediente_id`).all(...params);
    const porPrato = new Map();
    for (const l of linhas) {
      if (!porPrato.has(l.prato_id)) porPrato.set(l.prato_id, []);
      porPrato.get(l.prato_id).push({ ingredienteId: l.ingrediente_id, nome: l.nome, removivel: !!l.removivel, quantidade: l.quantidade, ordem: l.ordem });
    }
    return porPrato;
  }

  findAll({ somenteAtivos = false } = {}) {
    const rows = this.db.prepare(`SELECT ${COLUNAS} FROM pratos ${somenteAtivos ? 'WHERE ativo = 1' : ''} ORDER BY nome COLLATE NOCASE, id`).all();
    const porPrato = this.#ingredientesPorPrato();
    return rows.map((r) => this.#entidade(r, porPrato.get(r.id) || []));
  }

  findById(id) {
    const row = this.db.prepare(`SELECT ${COLUNAS} FROM pratos WHERE id = ?`).get(Number(id));
    if (!row) return null;
    return this.#entidade(row, this.#ingredientesPorPrato('WHERE pi.prato_id = ?', row.id).get(row.id) || []);
  }

  findByNome(nome) {
    const row = this.db.prepare('SELECT id FROM pratos WHERE nome_norm = ?').get(normalizarNome(nome));
    return row ? this.findById(row.id) : null;
  }

  findByCodigo(codigo) {
    const row = this.db.prepare('SELECT id FROM pratos WHERE codigo = ?').get(codigo);
    return row ? this.findById(row.id) : null;
  }

  /** Grava o prato e a lista de ingredientes numa única transação. */
  create(dados) {
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.db.prepare(
        'INSERT INTO pratos (nome, nome_norm, codigo, categoria_id, descricao, preco_cents, tempo_preparo_min, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(dados.nome, normalizarNome(dados.nome), dados.codigo, dados.categoriaId, dados.descricao, dados.precoCents, dados.tempoPreparoMin, dados.ativo ? 1 : 0);
      this.#gravarIngredientes(Number(lastInsertRowid), dados.ingredientes || []);
      return this.findById(Number(lastInsertRowid));
    });
  }

  /** Atualiza o prato; `dados.ingredientes` presente substitui a lista inteira, ausente a mantém. */
  update(id, dados) {
    return this.db.transaction(() => {
      this.db.prepare(
        'UPDATE pratos SET nome = ?, nome_norm = ?, codigo = ?, categoria_id = ?, descricao = ?, preco_cents = ?, tempo_preparo_min = ?, ativo = ? WHERE id = ?',
      ).run(dados.nome, normalizarNome(dados.nome), dados.codigo, dados.categoriaId, dados.descricao, dados.precoCents, dados.tempoPreparoMin, dados.ativo ? 1 : 0, Number(id));
      if (dados.ingredientes) this.#gravarIngredientes(Number(id), dados.ingredientes);
      return this.findById(id);
    });
  }

  #gravarIngredientes(pratoId, ingredientes) {
    this.db.prepare('DELETE FROM prato_ingredientes WHERE prato_id = ?').run(pratoId);
    const insere = this.db.prepare('INSERT INTO prato_ingredientes (prato_id, ingrediente_id, removivel, quantidade, ordem) VALUES (?, ?, ?, ?, ?)');
    for (const i of ingredientes) insere.run(pratoId, i.ingredienteId, i.removivel ? 1 : 0, i.quantidade, i.ordem);
  }

  setFoto(id, foto) {
    this.db.prepare('UPDATE pratos SET foto = ?, foto_tipo = ? WHERE id = ?').run(foto?.dados ?? null, foto?.tipo ?? null, Number(id));
  }

  /** @returns {{tipo:string, dados:Buffer}|null} */
  getFoto(id) {
    const row = this.db.prepare('SELECT foto, foto_tipo FROM pratos WHERE id = ?').get(Number(id));
    return row?.foto ? { tipo: row.foto_tipo, dados: Buffer.from(row.foto) } : null;
  }

  delete(id) {
    this.db.prepare('DELETE FROM pratos WHERE id = ?').run(Number(id));
  }
}

module.exports = PratoRepository;
