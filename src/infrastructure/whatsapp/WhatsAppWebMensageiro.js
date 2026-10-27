'use strict';
const MensageiroError = require('../../domain/errors/MensageiroError');

const ESPERAS_MS = [5000, 10000, 20000, 40000, 60000];

/** Mensageiro real: controla o WhatsApp Web por um cliente injetado (whatsapp-web.js). Cumpre a porta `Mensageiro`. */
class WhatsAppWebMensageiro {
  /**
   * @param {object} deps
   * @param {() => object} deps.criarCliente devolve { on, initialize, sendMessage, getNumberId, destroy, info? }
   * @param {() => number} [deps.relogio]
   * @param {import('../events/EventBus')} [deps.bus]
   * @param {number} [deps.timeoutMs] limite de cada envio
   * @param {Pick<Console,'error'>} [deps.logger]
   * @param {(fn: Function, ms: number) => any} [deps.agendar]
   * @param {(timer: any) => void} [deps.cancelar]
   */
  constructor({
    criarCliente, relogio = Date.now, bus = null, timeoutMs = 20000, logger = console,
    agendar = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, cancelar = clearTimeout,
  }) {
    Object.assign(this, { criarCliente, relogio, bus, timeoutMs, logger, agendar, cancelar });
    this._estado = 'DESCONECTADO';
    this._qr = null;
    this._numero = null;
    this._cliente = null;
    this._tentativa = 0;
    this._timer = null;
    this._parado = true;
  }

  estado() { return this._estado; }

  qrAtual() { return this._qr; }

  numeroConectado() { return this._numero; }

  /** Inicia a conexão (ou antecipa uma reconexão agendada). Nunca lança. */
  async iniciar() {
    if (this._cliente) return;
    this._parado = false;
    this.#cancelarReconexao();
    await this.#conectar();
  }

  /** Encerra o cliente e cancela a reconexão. Idempotente. */
  async parar() {
    this._parado = true;
    this.#cancelarReconexao();
    const descartado = this.#soltarCliente();
    this._tentativa = 0;
    this._qr = null;
    this._numero = null;
    this.#mudar('DESCONECTADO');
    await this.#destruir(descartado);
  }

  async enviar({ telefoneE164, texto }) {
    const cliente = this._cliente;
    if (this._estado !== 'CONECTADO' || !cliente) throw new MensageiroError('NAO_CONECTADO');
    const digitos = String(telefoneE164).replace(/\D/g, '');
    let timer;
    const limite = new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new MensageiroError('TIMEOUT')), this.timeoutMs); });
    const envio = (async () => {
      const id = await cliente.getNumberId(digitos);
      if (!id) throw new MensageiroError('NUMERO_SEM_WHATSAPP');
      const resposta = await cliente.sendMessage(id._serialized, texto);
      return { id: resposta?.id?._serialized ?? String(resposta?.id ?? '') };
    })();
    envio.catch(() => {}); // resposta tardia depois do TIMEOUT não vira rejeição não tratada
    try {
      return await Promise.race([envio, limite]);
    } catch (error) {
      if (error instanceof MensageiroError) throw error;
      this.logger?.error?.(error);
      throw new MensageiroError('ERRO_ENVIO');
    } finally {
      clearTimeout(timer);
    }
  }

  async #conectar() {
    let cliente;
    try {
      cliente = this.criarCliente();
      this._cliente = cliente;
      this.#registrar(cliente);
      this.#mudar('CONECTANDO');
      await cliente.initialize();
    } catch (error) {
      await this.#falhar(cliente, error);
    }
  }

  #registrar(cliente) {
    const ativo = (fn) => (...args) => { if (this._cliente === cliente) fn(...args); };
    cliente.on('qr', ativo((qr) => { this._qr = qr; this.#mudar('AGUARDANDO_QR'); }));
    cliente.on('authenticated', ativo(() => { this._qr = null; this.#mudar('CONECTANDO'); }));
    cliente.on('ready', ativo(() => {
      this._qr = null;
      this._tentativa = 0;
      this._numero = cliente.info?.wid?.user ?? null;
      this.#mudar('CONECTADO');
    }));
    cliente.on('auth_failure', ativo((mensagem) => { this.#falhar(cliente, new Error(`Falha de autenticação do WhatsApp: ${mensagem}`), { reconectar: false }).catch(() => {}); }));
    cliente.on('disconnected', ativo((motivo) => { this.#falhar(cliente, new Error(`WhatsApp desconectado: ${motivo}`)).catch(() => {}); }));
  }

  /** Registra a falha, descarta o cliente e agenda nova tentativa (a menos que `parar()` tenha sido chamado). */
  async #falhar(cliente, error, { reconectar = true } = {}) {
    this.logger?.error?.(error);
    if (cliente && this._cliente !== cliente) return;
    const descartado = this.#soltarCliente();
    this._qr = null;
    this._numero = null;
    this.#mudar('DESCONECTADO');
    if (!this._parado && reconectar) {
      const espera = ESPERAS_MS[Math.min(this._tentativa, ESPERAS_MS.length - 1)];
      this._tentativa += 1;
      this._timer = this.agendar(() => {
        this._timer = null;
        if (this._parado) return undefined;
        return this.#conectar();
      }, espera);
    }
    await this.#destruir(descartado);
  }

  #soltarCliente() {
    const cliente = this._cliente;
    this._cliente = null;
    return cliente;
  }

  async #destruir(cliente) {
    if (!cliente) return;
    try {
      await cliente.destroy();
    } catch (error) {
      this.logger?.error?.(error);
    }
  }

  #cancelarReconexao() {
    if (this._timer) this.cancelar(this._timer);
    this._timer = null;
  }

  #mudar(estado) {
    this._estado = estado;
    const dados = { estado };
    if (estado === 'AGUARDANDO_QR' && this._qr) dados.qr = this._qr;
    if (estado === 'CONECTADO' && this._numero) dados.numero = this._numero;
    try {
      this.bus?.publish('whatsapp', dados);
    } catch (error) {
      this.logger?.error?.(error);
    }
    if (estado === 'CONECTADO') {
      try {
        this.aoConectar?.();
      } catch (error) {
        this.logger?.error?.(error);
      }
    }
  }
}

module.exports = WhatsAppWebMensageiro;
