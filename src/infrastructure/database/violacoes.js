'use strict';

const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

/**
 * Indica violação de chave estrangeira. Usa o código estendido do SQLite (`errcode` 787) e, quando ele não basta
 * (ex.: ON DELETE RESTRICT chega como 1811, ainda com a mensagem "FOREIGN KEY constraint failed"), o texto da mensagem.
 */
function ehViolacaoDeChave(error) {
  if (error?.errcode === SQLITE_CONSTRAINT_FOREIGNKEY) return true;
  return /FOREIGN KEY/i.test(error?.message || '');
}

module.exports = { ehViolacaoDeChave, SQLITE_CONSTRAINT_FOREIGNKEY };
