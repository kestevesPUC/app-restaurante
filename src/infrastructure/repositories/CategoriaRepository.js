'use strict';
const CrudRepository = require('./CrudRepository');

class CategoriaRepository extends CrudRepository {
  /** @param {import('../database/SqliteDatabase')} db */
  constructor(db) {
    super(db, 'categorias', [
      { prop: 'nome', col: 'nome' },
      { prop: 'ordem', col: 'ordem' },
      { prop: 'vaiParaCozinha', col: 'vai_para_cozinha', bool: true },
      { prop: 'ativo', col: 'ativo', bool: true },
    ], 'ordem, nome COLLATE NOCASE, id');
  }
}

module.exports = CategoriaRepository;
