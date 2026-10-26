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
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE mesas (
          id INTEGER PRIMARY KEY,
          numero TEXT NOT NULL,
          numero_norm TEXT NOT NULL UNIQUE,
          capacidade INTEGER NOT NULL CHECK (capacidade >= 1),
          situacao TEXT NOT NULL DEFAULT 'LIVRE' CHECK (situacao IN ('LIVRE','OCUPADA','RESERVADA')),
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
        );

        CREATE TABLE fila_espera (
          id INTEGER PRIMARY KEY,
          cliente_nome TEXT NOT NULL,
          telefone TEXT,
          pessoas INTEGER NOT NULL CHECK (pessoas >= 1),
          observacao TEXT,
          situacao TEXT NOT NULL DEFAULT 'AGUARDANDO' CHECK (situacao IN ('AGUARDANDO','CHAMADO','SENTADO','DESISTIU','NAO_COMPARECEU')),
          mesa_id INTEGER REFERENCES mesas(id) ON DELETE RESTRICT,
          entrou_em TEXT NOT NULL,
          chamado_em TEXT,
          encerrado_em TEXT
        );
        CREATE INDEX ix_fila_situacao ON fila_espera(situacao, entrou_em);
        CREATE INDEX ix_fila_mesa ON fila_espera(mesa_id);

        CREATE TABLE mensagens_whatsapp (
          id INTEGER PRIMARY KEY,
          fila_id INTEGER NOT NULL REFERENCES fila_espera(id) ON DELETE CASCADE,
          telefone TEXT NOT NULL,
          texto TEXT NOT NULL,
          situacao TEXT NOT NULL CHECK (situacao IN ('ENVIADA','FALHOU')),
          erro TEXT,
          enviada_em TEXT NOT NULL,
          enviada_por INTEGER REFERENCES usuarios(id)
        );
        CREATE INDEX ix_mensagens_fila ON mensagens_whatsapp(fila_id);
      `);
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE pedidos (
          id INTEGER PRIMARY KEY,
          data_local TEXT NOT NULL,
          numero_dia INTEGER NOT NULL CHECK (numero_dia >= 1),
          tipo TEXT NOT NULL CHECK (tipo IN ('BALCAO','MESA')),
          mesa_id INTEGER REFERENCES mesas(id) ON DELETE RESTRICT,
          cliente_nome TEXT,
          situacao TEXT NOT NULL DEFAULT 'ABERTO' CHECK (situacao IN ('ABERTO','AGUARDANDO_PAGAMENTO','PAGO','CANCELADO')),
          subtotal_cents INTEGER NOT NULL DEFAULT 0,
          desconto_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL DEFAULT 0,
          observacao TEXT,
          criado_por INTEGER NOT NULL REFERENCES usuarios(id),
          criado_em TEXT NOT NULL,
          finalizado_em TEXT,
          pago_em TEXT,
          cancelado_em TEXT,
          cancelado_por INTEGER REFERENCES usuarios(id),
          motivo_cancelamento TEXT,
          UNIQUE (data_local, numero_dia),
          CHECK ((tipo = 'MESA' AND mesa_id IS NOT NULL) OR (tipo = 'BALCAO' AND cliente_nome IS NOT NULL)),
          CHECK (total_cents = subtotal_cents - desconto_cents AND desconto_cents BETWEEN 0 AND subtotal_cents)
        );
        CREATE UNIQUE INDEX ux_comanda_aberta ON pedidos(mesa_id) WHERE tipo = 'MESA' AND situacao IN ('ABERTO','AGUARDANDO_PAGAMENTO');
        CREATE INDEX ix_pedidos_data ON pedidos(data_local, id);
        CREATE INDEX ix_pedidos_situacao ON pedidos(situacao);

        CREATE TABLE pedido_envios (
          id INTEGER PRIMARY KEY,
          pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
          rodada INTEGER NOT NULL CHECK (rodada >= 1),
          cozinha_situacao TEXT NOT NULL DEFAULT 'NA_FILA' CHECK (cozinha_situacao IN ('NA_FILA','EM_PREPARO','PRONTO','ENTREGUE')),
          vai_para_cozinha INTEGER NOT NULL DEFAULT 1 CHECK (vai_para_cozinha IN (0,1)),
          enviado_em TEXT NOT NULL,
          enviado_por INTEGER REFERENCES usuarios(id),
          preparo_iniciado_em TEXT,
          pronto_em TEXT,
          entregue_em TEXT,
          UNIQUE (pedido_id, rodada)
        );
        CREATE INDEX ix_envios_andon ON pedido_envios(cozinha_situacao, enviado_em) WHERE vai_para_cozinha = 1 AND cozinha_situacao <> 'ENTREGUE';
        CREATE INDEX ix_envios_pedido ON pedido_envios(pedido_id);

        CREATE TABLE pedido_itens (
          id INTEGER PRIMARY KEY,
          pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
          envio_id INTEGER REFERENCES pedido_envios(id) ON DELETE RESTRICT,
          prato_id INTEGER NOT NULL REFERENCES pratos(id) ON DELETE RESTRICT,
          prato_nome TEXT NOT NULL,
          preco_unit_cents INTEGER NOT NULL CHECK (preco_unit_cents >= 0),
          adicionais_cents INTEGER NOT NULL DEFAULT 0 CHECK (adicionais_cents >= 0),
          quantidade INTEGER NOT NULL CHECK (quantidade >= 1),
          total_cents INTEGER NOT NULL CHECK (total_cents = (preco_unit_cents + adicionais_cents) * quantidade),
          observacao TEXT,
          ordem INTEGER NOT NULL DEFAULT 0,
          cancelado_em TEXT,
          cancelado_por INTEGER REFERENCES usuarios(id),
          motivo_cancelamento TEXT
        );
        CREATE INDEX ix_itens_pedido ON pedido_itens(pedido_id);
        CREATE INDEX ix_itens_prato ON pedido_itens(prato_id);
        CREATE INDEX ix_itens_envio ON pedido_itens(envio_id);

        CREATE TABLE item_modificacoes (
          id INTEGER PRIMARY KEY,
          item_id INTEGER NOT NULL REFERENCES pedido_itens(id) ON DELETE CASCADE,
          ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id) ON DELETE RESTRICT,
          ingrediente_nome TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('REMOVER','ADICIONAR')),
          quantidade INTEGER NOT NULL CHECK (quantidade >= 1),
          preco_unit_cents INTEGER NOT NULL CHECK (preco_unit_cents >= 0),
          UNIQUE (item_id, ingrediente_id),
          CHECK (tipo = 'ADICIONAR' OR (quantidade = 1 AND preco_unit_cents = 0))
        );
        CREATE INDEX ix_modificacoes_ingrediente ON item_modificacoes(ingrediente_id);
      `);
    },
  },
];
