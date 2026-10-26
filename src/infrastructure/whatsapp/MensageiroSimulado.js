'use strict';
const MensageiroError = require('../../domain/errors/MensageiroError');

/** Mensageiro em memória (padrão e testes): guarda o que "enviou" e permite simular falhas e estados. */
class MensageiroSimulado {
  constructor() {
    /** @type {{telefoneE164: string, texto: string, id: string}[]} */
    this.enviadas = [];
    this._estado = 'CONECTADO';
    this._falha = null;
  }

  estado() {
    return this._estado;
  }

  definirEstado(estado) {
    this._estado = estado;
  }

  /** A próxima chamada a `enviar` rejeita com `MensageiroError(code)`. */
  falharProxima(code) {
    this._falha = code;
  }

  async enviar({ telefoneE164, texto }) {
    if (this._falha) {
      const code = this._falha;
      this._falha = null;
      throw new MensageiroError(code);
    }
    if (this._estado !== 'CONECTADO') throw new MensageiroError('NAO_CONECTADO');
    const id = `sim-${this.enviadas.length + 1}`;
    this.enviadas.push({ telefoneE164, texto, id });
    return { id };
  }
}

module.exports = MensageiroSimulado;
