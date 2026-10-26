'use strict';
const crypto = require('node:crypto');

/** Hash de senhas com scrypt + sal aleatório (formato "sal:hash" em hexadecimal). */
class PasswordHasher {
  hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
  }

  /** Senha provisória aleatória (12 caracteres hexadecimais) para novos usuários e redefinições. */
  generateTemporary() {
    return crypto.randomBytes(6).toString('hex');
  }

  verify(password, stored) {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }
}

module.exports = PasswordHasher;
