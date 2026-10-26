'use strict';

class ConfiguracaoRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    this.db = db;
  }

  /** @returns {Record<string,string>} somente as chaves gravadas */
  all() {
    return Object.fromEntries(this.db.prepare('SELECT chave, valor FROM configuracoes').all().map((r) => [r.chave, r.valor]));
  }

  get(chave) {
    return this.db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave)?.valor ?? null;
  }

  set(chave, valor) {
    this.db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
  }
}

module.exports = ConfiguracaoRepository;
