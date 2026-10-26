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
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE categorias (
          id INTEGER PRIMARY KEY,
          nome TEXT NOT NULL,
          nome_norm TEXT NOT NULL UNIQUE,
          ordem INTEGER NOT NULL DEFAULT 0 CHECK (ordem >= 0),
          vai_para_cozinha INTEGER NOT NULL DEFAULT 1 CHECK (vai_para_cozinha IN (0,1)),
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
        );

        CREATE TABLE ingredientes (
          id INTEGER PRIMARY KEY,
          nome TEXT NOT NULL,
          nome_norm TEXT NOT NULL UNIQUE,
          preco_adicional_cents INTEGER NOT NULL DEFAULT 0 CHECK (preco_adicional_cents >= 0),
          pode_ser_adicional INTEGER NOT NULL DEFAULT 0 CHECK (pode_ser_adicional IN (0,1)),
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
        );

        CREATE TABLE pratos (
          id INTEGER PRIMARY KEY,
          categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
          nome TEXT NOT NULL,
          nome_norm TEXT NOT NULL UNIQUE,
          codigo TEXT UNIQUE,
          descricao TEXT,
          preco_cents INTEGER NOT NULL CHECK (preco_cents > 0),
          foto BLOB,
          foto_tipo TEXT,
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
        );
        CREATE INDEX ix_pratos_categoria ON pratos(categoria_id);

        CREATE TABLE prato_ingredientes (
          prato_id INTEGER NOT NULL REFERENCES pratos(id) ON DELETE CASCADE,
          ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id) ON DELETE RESTRICT,
          removivel INTEGER NOT NULL DEFAULT 1 CHECK (removivel IN (0,1)),
          quantidade TEXT,
          ordem INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (prato_id, ingrediente_id)
        );
        CREATE INDEX ix_prato_ingredientes_ingrediente ON prato_ingredientes(ingrediente_id);
      `);
    },
  },
];
