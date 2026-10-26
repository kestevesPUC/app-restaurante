'use strict';
const crypto = require('node:crypto');

const DOZE_HORAS = 12 * 60 * 60 * 1000;

/**
 * Sessões em memória identificadas por token aleatório (sid).
 * `ttlPorNivel` define a inatividade tolerada por nível; `null` (ou nível ausente) = nunca expira por inatividade.
 * Cada uso válido renova o prazo.
 */
class SessionStore {
  constructor({ ttlPorNivel = { A: DOZE_HORAS, B: DOZE_HORAS, C: null }, now = Date.now } = {}) {
    this.ttlPorNivel = ttlPorNivel;
    this.now = now;
    this.sessions = new Map();
  }

  create(userId, nivel) {
    const sid = crypto.randomBytes(24).toString('hex');
    this.sessions.set(sid, { userId, nivel, lastUsedAt: this.now() });
    return sid;
  }

  /** @returns {number|null} id do dono da sessão válida (e renova o uso) */
  userIdFor(sid) {
    const session = this.sessions.get(sid);
    if (!session) return null;
    const ttl = this.ttlPorNivel[session.nivel] ?? null;
    if (ttl !== null && this.now() - session.lastUsedAt > ttl) {
      this.sessions.delete(sid);
      return null;
    }
    session.lastUsedAt = this.now();
    return session.userId;
  }

  /** Encerra todas as sessões de um usuário (senha redefinida, desativação). */
  destroyForUser(userId) {
    for (const [sid, session] of this.sessions) if (session.userId === Number(userId)) this.sessions.delete(sid);
  }

  destroy(sid) {
    this.sessions.delete(sid);
  }
}

module.exports = SessionStore;
