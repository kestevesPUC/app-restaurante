'use strict';
const ValidationError = require('../domain/errors/ValidationError');
const { normalizarTelefone } = require('../domain/phone');

const MODELO_MAX = 1000;

/** Valores padrão das configurações (docs/banco-de-dados.md). */
const DEFAULTS = Object.freeze({
  'restaurante.nome': 'Restaurante Bom Sabor',
  'whatsapp.numero_empresa': '',
  'whatsapp.navegador': '', // caminho do msedge.exe; vazio = detectar o Edge instalado
  'whatsapp.modelo_retirada': 'Olá, {nome}!\n\nSeu pedido nº {numero} está pronto para retirada.\n\nAgradecemos a preferência.',
  'whatsapp.modelo_entrega': 'Olá, {nome}!\n\nSeu pedido nº {numero} foi finalizado e está pronto para entrega.\n\nAgradecemos a preferência.',
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
    const depois = this.normalizar(chave, valor);
    this.repository.set(chave, depois);
    this.audit.record({
      actor, acao: 'configurar', entidade: 'configuracao', descricao: `Configuração ${chave} alterada`, antes: { chave, valor: antes }, depois: { chave, valor: depois },
    });
  }

  /** Valida e normaliza o valor de uma chave sem gravar. @returns {string} @throws {ValidationError} */
  normalizar(chave, valor) {
    this.#exigirChave(chave);
    let texto = String(valor ?? '');
    const permitidos = VALORES_PERMITIDOS[chave];
    if (permitidos && !permitidos.includes(texto)) throw new ValidationError(`Valor inválido para ${chave}: use ${permitidos.join(' ou ')}`);
    if (chave === 'whatsapp.modelo_retirada' || chave === 'whatsapp.modelo_entrega') {
      texto = texto.trim();
      if (!texto) throw new ValidationError('O modelo da mensagem não pode ficar vazio');
      if ([...texto].length > MODELO_MAX) throw new ValidationError(`O modelo da mensagem deve ter no máximo ${MODELO_MAX} caracteres`);
    } else if (chave === 'whatsapp.numero_empresa') {
      texto = texto.trim() ? normalizarTelefone(texto.trim()) : '';
    }
    return texto;
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
