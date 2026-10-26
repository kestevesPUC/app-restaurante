'use strict';

/** Lista ordenada de migrações. Nunca editar uma publicada: acrescentar outra no final. */
module.exports = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE usuarios (
          id INTEGER PRIMARY KEY,
          usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
          nome TEXT NOT NULL,
          nivel TEXT NOT NULL CHECK (nivel IN ('A','B','C')),
          senha_hash TEXT NOT NULL,
          must_change INTEGER NOT NULL DEFAULT 0 CHECK (must_change IN (0,1)),
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
          criado_em TEXT NOT NULL
        );

        CREATE TABLE configuracoes (
          chave TEXT PRIMARY KEY,
          valor TEXT
        );

        CREATE TABLE auditoria (
          id INTEGER PRIMARY KEY,
          em TEXT NOT NULL,
          usuario_id INTEGER,
          usuario TEXT,
          acao TEXT NOT NULL,
          entidade TEXT,
          entidade_id INTEGER,
          descricao TEXT,
          antes TEXT,
          depois TEXT
        );
        CREATE INDEX ix_auditoria_em ON auditoria(em);
        CREATE INDEX ix_auditoria_entidade ON auditoria(entidade, entidade_id);

        CREATE TRIGGER auditoria_sem_update BEFORE UPDATE ON auditoria
        BEGIN SELECT RAISE(ABORT, 'auditoria é imutável'); END;
        CREATE TRIGGER auditoria_sem_delete BEFORE DELETE ON auditoria
        BEGIN SELECT RAISE(ABORT, 'auditoria é imutável'); END;
      `);
    },
  },
];
