'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const ForbiddenError = require('../domain/errors/ForbiddenError');
const ExternalServiceError = require('../domain/errors/ExternalServiceError');
const MensageiroError = require('../domain/errors/MensageiroError');
const { formatarNome } = require('../domain/nomePessoa');

const TIPO_POR_STATUS = Object.freeze({ PRONTO_RETIRADA: 'RETIRADA', PRONTO_ENTREGA: 'ENTREGA' });
const CHAVE_MODELO = Object.freeze({ RETIRADA: 'whatsapp.modelo_retirada', ENTREGA: 'whatsapp.modelo_entrega' });
const NIVEIS = ['A', 'B'];

function exigirNivel(user) {
  if (!user || !NIVEIS.includes(user.nivel)) throw new ForbiddenError('Sem permissão para notificações');
}

/** Rejeita com TIMEOUT após `ms`; o timer é sempre cancelado e a promessa original nunca fica sem tratamento. */
function comLimite(promessa, ms) {
  let timer;
  const limite = new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new MensageiroError('TIMEOUT')), ms); });
  promessa.catch(() => {});
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/**
 * Mensagens de WhatsApp ao cliente quando o pedido fica pronto (retirada/entrega). O envio automático roda em segundo plano
 * e nunca lança nem altera o status do pedido; falhas viram linhas `FALHOU` no histórico.
 * Reentrar em PRONTO_* (PRONTO → EM_PREPARO → PRONTO) envia de novo: não há deduplicação, de propósito.
 */
class NotificacaoService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/NotificacaoRepository')} deps.repository
   * @param {import('./ports/Mensageiro').Mensageiro} deps.mensageiro
   * @param {(id:number) => object} deps.carregarPedido devolve o `Pedido` sem checagem de autorização
   * @param {import('./ConfigService')} deps.config
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} [deps.bus]
   * @param {() => number} deps.relogio
   * @param {Pick<Console,'error'>} [deps.logger]
   * @param {number} [deps.timeoutMs]
   */
  constructor({ repository, mensageiro, carregarPedido, config, audit, bus = null, relogio = Date.now, logger = console, timeoutMs = 30000 }) {
    Object.assign(this, { repository, mensageiro, carregarPedido, config, audit, bus, relogio, logger, timeoutMs });
    this.pendentes = new Set();
  }

  /** Chamado quando o WhatsApp conecta: avisa os clientes cujos pedidos ficaram prontos enquanto ele estava fora.
   * Reenvia (em segundo plano, nunca lança) os avisos que falharam por falta de conexão e ainda fazem sentido. */
  reenviarPendentes() {
    try {
      for (const id of this.repository.pedidosComAvisoPendente()) {
        const pedido = this.carregarPedido(id);
        const tipo = TIPO_POR_STATUS[pedido?.status];
        if (!tipo) continue;
        const envio = this.#enviar(pedido, tipo, { automatica: true, user: null }).catch((error) => this.logger?.error?.(error));
        this.pendentes.add(envio);
        envio.finally(() => this.pendentes.delete(envio));
      }
    } catch (error) {
      this.logger?.error?.(error);
    }
  }

  /** Porta `aposMudarStatus` do PedidoService. Não bloqueia e nunca lança. */
  aoMudarStatus(pedido, user) {
    try {
      const tipo = TIPO_POR_STATUS[pedido?.status];
      if (!tipo) return;
      const envio = this.#enviar(pedido, tipo, { automatica: true, user }).catch((error) => this.logger?.error?.(error));
      this.pendentes.add(envio);
      envio.finally(() => this.pendentes.delete(envio));
    } catch (error) {
      this.logger?.error?.(error);
    }
  }

  /** Aguarda os envios em andamento (testes e encerramento do app). */
  async aguardarPendentes() {
    while (this.pendentes.size) await Promise.all([...this.pendentes]);
  }

  async reenviar(user, pedidoId) {
    exigirNivel(user);
    const pedido = this.carregarPedido(Number(pedidoId));
    if (!pedido) throw new NotFoundError('Pedido não encontrado');
    const tipo = TIPO_POR_STATUS[pedido.status];
    if (!tipo) throw new ConflictError('Só é possível reenviar quando o pedido está pronto');
    if (!pedido.cliente?.telefone?.trim()) throw new ConflictError('Pedido sem telefone do cliente: não há para quem enviar');
    const linha = await this.#enviar(pedido, tipo, { automatica: false, user });
    if (!linha) throw new ExternalServiceError('Não foi possível registrar a notificação');
    this.audit.record({
      actor: user, acao: 'notificacao_reenviada', entidade: 'pedido', entidadeId: pedido.id,
      descricao: `Notificação do pedido ${pedido.id} reenviada (${linha.situacao})`, depois: { notificacaoId: linha.id, situacao: linha.situacao },
    });
    return linha;
  }

  historico(user, pedidoId) {
    exigirNivel(user);
    return this.repository.listarPorPedido(Number(pedidoId));
  }

  /**
   * Substitui `{nome}` (primeiro nome bem formatado, em negrito do WhatsApp; "cliente" sem negrito) e `{numero}`.
   * Marcadores desconhecidos ficam como estão.
   */
  renderizar(modelo, { nome, numero }) {
    const primeiro = typeof nome === 'string' ? formatarNome(nome).split(' ')[0].replace(/\*/g, '') : '';
    const valores = { nome: primeiro ? `*${primeiro}*` : 'cliente', numero: String(numero) };
    return modelo.replace(/\{(\w+)\}/g, (marcador, chave) => (Object.hasOwn(valores, chave) ? valores[chave] : marcador));
  }

  /** Envia, grava a linha e publica o evento. Devolve a linha gravada ou null se nem isso foi possível. Nunca lança. */
  async #enviar(pedido, tipo, { automatica, user }) {
    try {
      const telefone = typeof pedido.cliente?.telefone === 'string' ? pedido.cliente.telefone.trim() : '';
      if (!telefone) return null; // sem telefone não há aviso a enviar (nem falha a registrar)
      const texto = this.renderizar(this.config.get(CHAVE_MODELO[tipo]), { nome: pedido.cliente?.nome, numero: pedido.senha ?? pedido.id });
      let situacao = 'ENVIADA';
      let erro = null;
      try {
        await comLimite(Promise.resolve().then(() => this.mensageiro.enviar({ telefoneE164: telefone, texto })), this.timeoutMs);
      } catch (error) {
        situacao = 'FALHOU';
        erro = error instanceof MensageiroError ? error.message : new MensageiroError('ERRO_ENVIO').message;
        this.logger?.error?.(error);
      }
      const linha = this.repository.insert({
        pedidoId: pedido.id, tipo, telefone, texto, situacao, erro, automatica, enviadaPor: automatica ? null : user.id, em: new Date(this.relogio()).toISOString(),
      });
      try {
        this.bus?.publish('notificacao', { id: linha.id, pedidoId: pedido.id, situacao, erro, automatica });
      } catch (error) {
        this.logger?.error?.(error); // a linha já foi gravada: falha do evento não invalida o resultado
      }
      return linha;
    } catch (error) {
      this.logger?.error?.(error);
      return null;
    }
  }
}

module.exports = NotificacaoService;
