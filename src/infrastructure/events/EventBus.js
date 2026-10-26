'use strict';

/** Barramento de eventos em memória: serviços publicam, o canal SSE assina. Um assinante com defeito não afeta os outros. */
class EventBus {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.subscribers = new Set();
  }

  /** @returns {() => void} função que cancela a assinatura */
  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(tipo, dados = {}) {
    for (const fn of [...this.subscribers]) {
      try {
        fn({ tipo, dados });
      } catch (error) {
        this.logger.error(error);
      }
    }
  }

  get size() {
    return this.subscribers.size;
  }
}

module.exports = EventBus;
