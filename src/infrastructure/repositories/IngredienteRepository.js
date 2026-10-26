'use strict';
const CrudRepository = require('./CrudRepository');

class IngredienteRepository extends CrudRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    super(db, 'ingredientes', [
      { prop: 'nome', col: 'nome' },
      { prop: 'precoAdicionalCents', col: 'preco_adicional_cents' },
      { prop: 'podeSerAdicional', col: 'pode_ser_adicional', bool: true },
      { prop: 'ativo', col: 'ativo', bool: true },
    ]);
  }
}

module.exports = IngredienteRepository;
