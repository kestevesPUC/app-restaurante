'use strict';
const ValidationError = require('../domain/errors/ValidationError');

/** Valores padrão das configurações (docs/banco-de-dados.md). */
const DEFAULTS = Object.freeze({
  'restaurante.nome': 'Restaurante Bom Sabor',
  'whatsapp.modelo_chamada': 'Olá {nome}! Sua mesa {mesa} no {restaurante} está pronta. Aguardamos você em até {tolerancia} minutos.',
  'fila.tolerancia_min': '10',
  'maquininha.provedor': 'simulado',
  'maquininha.config': '{}',
  'maquininha.timeout_s': '120',
  'pix.validade_min': '15',
  'cozinha.enviar_em': 'PAGO',
  'cozinha.alerta_min': '10',
  'cozinha.critico_min': '20',
  'cozinha.som': '1',
  'cozinha.estimativa': 'MAXIMO',
  'rede.porta_local': '8420',
});

/** Chaves com lista fechada de valores. */
const VALORES_PERMITIDOS = Object.freeze({ 'cozinha.estimativa': ['MAXIMO', 'SOMA'] });

/** Configurações do sistema: o que não foi gravado cai nos DEFAULTS. Alterações são auditadas. */
class ConfigService {
  /** @param {{repository: import('../infrastructure/repositories/ConfiguracaoRepository'), audit: import('./AuditTrail')}} deps */
  constructor({ repository, audit }) {
    this.repository = repository;
    this.audit = audit;
  }

  /** @returns {string} */
  get(chave) {
    this.#exigirChave(chave);
    return this.repository.get(chave) ?? DEFAULTS[chave];
  }

  set(actor, chave, valor) {
    this.#exigirChave(chave);
    const antes = this.get(chave);
    const depois = String(valor ?? '');
    const permitidos = VALORES_PERMITIDOS[chave];
    if (permitidos && !permitidos.includes(depois)) throw new ValidationError(`Valor inválido para ${chave}: use ${permitidos.join(' ou ')}`);
    this.repository.set(chave, depois);
    this.audit.record({
      actor, acao: 'configurar', entidade: 'configuracao', descricao: `Configuração ${chave} alterada`, antes: { chave, valor: antes }, depois: { chave, valor: depois },
    });
  }

  /** @returns {Record<string,string>} todas as chaves conhecidas, com padrão aplicado */
  todas() {
    return { ...DEFAULTS, ...this.repository.all() };
  }

  #exigirChave(chave) {
    if (!Object.hasOwn(DEFAULTS, chave)) throw new ValidationError(`Configuração desconhecida: ${chave}`);
  }
}

module.exports = ConfigService;
module.exports.DEFAULTS = DEFAULTS;
