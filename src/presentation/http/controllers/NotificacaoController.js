'use strict';
const ValidationError = require('../../../domain/errors/ValidationError');
const { idPositivo } = require('../validacaoHttp');

const id = (ctx) => idPositivo(ctx.params.id, 'O pedido');

/** Notificações de WhatsApp: histórico/reenvio por pedido (A, B) e modelos/número da empresa (só A). */
class NotificacaoController {
  /**
   * @param {import('../../../application/NotificacaoService')} service
   * @param {import('../../../application/ConfigService')} config
   */
  constructor(service, config) {
    this.service = service;
    this.config = config;
  }

  #configuracao() {
    return {
      numeroEmpresa: this.config.get('whatsapp.numero_empresa'),
      modeloRetirada: this.config.get('whatsapp.modelo_retirada'),
      modeloEntrega: this.config.get('whatsapp.modelo_entrega'),
    };
  }

  register(router) {
    router.add('GET', '/api/pedidos/:id/notificacoes', (ctx) => this.service.historico(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/notificacoes/reenviar', (ctx) => this.service.reenviar(ctx.user, id(ctx)));
    router.add('GET', '/api/config/whatsapp', () => this.#configuracao(), { nivel: 'A' });
    router.add('PUT', '/api/config/whatsapp', (ctx) => {
      const body = ctx.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('O corpo deve ser um objeto');
      const campos = [['numeroEmpresa', 'whatsapp.numero_empresa'], ['modeloRetirada', 'whatsapp.modelo_retirada'], ['modeloEntrega', 'whatsapp.modelo_entrega']];
      for (const [campo] of campos) {
        if (body[campo] !== undefined && typeof body[campo] !== 'string') throw new ValidationError(`O campo ${campo} deve ser um texto`);
      }
      // valida tudo antes de gravar, para que um campo ruim não deixe a configuração pela metade
      const novos = campos.filter(([campo]) => body[campo] !== undefined).map(([campo, chave]) => [chave, this.config.normalizar(chave, body[campo])]);
      for (const [chave, valor] of novos) this.config.set(ctx.user, chave, valor);
      return this.#configuracao();
    }, { nivel: 'A' });
  }
}

module.exports = NotificacaoController;
