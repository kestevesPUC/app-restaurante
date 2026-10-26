'use strict';

const MAX_KEY_LENGTH = 64;
const FIVE_MINUTES = 5 * 60 * 1000;

/** Bloqueia o login após 3 falhas seguidas (como o original), por 5 minutos. */
class LoginThrottle {
  constructor({ maxFailures = 3, windowMs = FIVE_MINUTES, now = Date.now } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.now = now;
    this.failures = new Map();
  }

  isBlocked(key) {
    key = LoginThrottle.#normalize(key);
    const entry = this.failures.get(key);
    return !!entry && entry.count >= this.maxFailures && this.now() - entry.lastAt < this.windowMs;
  }

  registerFailure(key) {
    key = LoginThrottle.#normalize(key);
    this.#prune();
    const entry = this.failures.get(key);
    const stillCounting = entry && this.now() - entry.lastAt < this.windowMs;
    this.failures.set(key, { count: stillCounting ? entry.count + 1 : 1, lastAt: this.now() });
  }

  reset(key) {
    this.failures.delete(LoginThrottle.#normalize(key));
  }

  /** A chave vem do usuário: limita o tamanho para a memória não crescer sem limite. */
  static #normalize(key) {
    return String(key).slice(0, MAX_KEY_LENGTH);
  }

  /** Remove entradas cujo bloqueio/contagem já expirou. */
  #prune() {
    const limit = this.now() - this.windowMs;
    for (const [key, entry] of this.failures) if (entry.lastAt <= limit) this.failures.delete(key);
  }
}

module.exports = LoginThrottle;
