'use strict';
const ValidationError = require('../../../domain/errors/ValidationError');
const ExternalServiceError = require('../../../domain/errors/ExternalServiceError');
const { normalizarTelefone } = require('../../../domain/phone');

const TEXTO_TESTE = 'Mensagem de teste do PDV Restaurante.';
const TEXTO_MAX = 1000;

/** Estado e conexão do WhatsApp (somente nível A). */
class WhatsAppController {
  /**
   * @param {import('../../../application/ports/Mensageiro').Mensageiro & object} mensageiro
   * @param {import('../../../application/ConfigService')} config
   * @param {{erro?: () => string|null}} [opcoes] `erro` informa por que a conexão real não pode ser feita
   */
  constructor(mensageiro, config, { erro = () => null } = {}) {
    this.mensageiro = mensageiro;
    this.config = config;
    this.erro = erro;
  }

  #estado() {
    const m = this.mensageiro;
    const estado = {
      estado: m.estado(), qr: m.qrAtual?.() ?? null, numeroConectado: m.numeroConectado?.() ?? null, numeroEmpresa: this.config.get('whatsapp.numero_empresa'),
    };
    const erro = this.erro();
    return erro ? { ...estado, erro } : estado;
  }

  register(router) {
    const A = { nivel: 'A' };
    router.add('GET', '/api/whatsapp/estado', () => this.#estado(), A);
    router.add('POST', '/api/whatsapp/conectar', async () => {
      const erro = this.erro();
      if (erro) throw new ExternalServiceError(erro);
      if (this.mensageiro.estado() === 'DESCONECTADO') await this.mensageiro.iniciar?.();
      return this.#estado();
    }, A);
    router.add('POST', '/api/whatsapp/desconectar', async () => {
      await this.mensageiro.parar?.();
      return this.#estado();
    }, A);
    router.add('POST', '/api/whatsapp/teste', async (ctx) => {
      const body = ctx.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('O corpo deve ser um objeto');
      const telefoneE164 = normalizarTelefone(body.telefone);
      if (body.texto !== undefined && (typeof body.texto !== 'string' || !body.texto.trim() || body.texto.length > TEXTO_MAX)) {
        throw new ValidationError(`O texto deve ter de 1 a ${TEXTO_MAX} caracteres`);
      }
      await this.mensageiro.enviar({ telefoneE164, texto: body.texto?.trim() || TEXTO_TESTE });
      return { enviada: true };
    }, A);
  }
}

module.exports = WhatsAppController;
