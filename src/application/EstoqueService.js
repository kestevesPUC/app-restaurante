'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const ValidationError = require('../domain/errors/ValidationError');
const { validarMovimentacao, validarLimite } = require('../domain/estoque/movimentos');

const VERBOS = { ENTRADA: 'entrada', SAIDA: 'saida', AJUSTE: 'ajuste' };

/**
 * Movimentações de estoque. As operações avulsas (API) abrem a própria transação e publicam o evento `estoque` depois do commit.
 * `baixarParaPedido` e `estornarPedido` NÃO abrem transação: rodam dentro da do chamador (confirmação do pedido) e devolvem
 * os eventos `estoque` para o chamador publicar depois do commit.
 */
class EstoqueService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/database/SqliteDatabase')} deps.db
   * @param {import('../infrastructure/repositories/BebidaRepository')} deps.bebidas
   * @param {import('../infrastructure/repositories/MovimentacaoRepository')} deps.movimentacoes
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} deps.bus
   * @param {() => Date} deps.clock
   */
  constructor({ db, bebidas, movimentacoes, audit, bus, clock }) {
    this.db = db;
    this.bebidas = bebidas;
    this.movimentacoes = movimentacoes;
    this.audit = audit;
    this.bus = bus;
    this.clock = clock;
  }

  criticas() {
    return this.bebidas.findCriticas();
  }

  listarMovimentacoes(bebidaId, limite) {
    const bebida = this.#exigir(bebidaId);
    return this.movimentacoes.listar(bebida.id, validarLimite(limite));
  }

  /** ENTRADA, SAIDA ou AJUSTE avulsos. Devolve a bebida com o novo saldo. */
  movimentar(actor, bebidaId, body) {
    const pedido = validarMovimentacao(body);
    const em = this.clock().toISOString();
    const { antes, depois, delta } = this.db.transaction(() => {
      const atual = this.#exigir(bebidaId);
      const quantidade = this.#delta(atual, pedido);
      const novoSaldo = atual.estoqueQtd + quantidade;
      this.bebidas.definirSaldo(atual.id, novoSaldo);
      this.movimentacoes.insert({ bebidaId: atual.id, tipo: pedido.tipo, quantidade, saldoApos: novoSaldo, motivo: pedido.motivo, actor, em });
      return { antes: atual, depois: this.bebidas.findById(atual.id), delta: quantidade };
    });
    this.audit.record({
      actor,
      acao: VERBOS[pedido.tipo],
      entidade: 'estoque',
      entidadeId: depois.id,
      descricao: `Estoque de "${depois.nome}": ${pedido.tipo} de ${delta > 0 ? '+' : ''}${delta} (saldo ${antes.estoqueQtd} para ${depois.estoqueQtd})${pedido.motivo ? ` - ${pedido.motivo}` : ''}`,
      antes: { estoqueQtd: antes.estoqueQtd },
      depois: { estoqueQtd: depois.estoqueQtd },
    });
    this.bus.publish('estoque', this.#evento(depois));
    return depois;
  }

  /**
   * Baixa o estoque dos itens do pedido, dentro da transação do chamador.
   * Se alguma bebida não tiver saldo (ou estiver inativa), lança ConflictError com `detalhes`; o chamador reverte.
   * @param {{id:number|null, usuario:string}} actor
   * @param {number} pedidoId
   * @param {{bebidaId:number, quantidade:number}[]} itens
   * @returns {{bebidaId:number, estoqueQtd:number, critico:boolean}[]} eventos `estoque` a publicar depois do commit
   */
  baixarParaPedido(actor, pedidoId, itens) {
    const em = this.clock().toISOString();
    const insuficientes = [];
    const baixadas = [];
    for (const [bebidaId, quantidade] of this.#somar(itens)) {
      const bebida = this.bebidas.findById(bebidaId);
      if (!bebida) throw new ValidationError('Bebida inexistente');
      if (!this.bebidas.baixar(bebidaId, quantidade)) {
        insuficientes.push({ bebidaId, bebida: bebida.nome, saldo: bebida.estoqueQtd, pedido: quantidade });
        continue;
      }
      const depois = this.bebidas.findById(bebidaId);
      this.movimentacoes.insert({ bebidaId, tipo: 'VENDA', quantidade: -quantidade, saldoApos: depois.estoqueQtd, pedidoId, actor, em });
      baixadas.push(this.#evento(depois));
    }
    if (insuficientes.length) {
      const erro = new ConflictError(`Estoque insuficiente: ${insuficientes.map((i) => `${i.bebida} (saldo ${i.saldo}, pedido ${i.pedido})`).join('; ')}`);
      erro.detalhes = insuficientes;
      throw erro;
    }
    return baixadas;
  }

  /**
   * Devolve ao estoque o líquido baixado pelo pedido (VENDA − ESTORNO anteriores): estornar duas vezes devolve uma só.
   * Dentro da transação do chamador; devolve os eventos `estoque` para publicar depois do commit.
   */
  estornarPedido(actor, pedidoId) {
    const em = this.clock().toISOString();
    const eventos = [];
    for (const { bebidaId, liquido } of this.movimentacoes.liquidoBaixadoPorBebida(pedidoId)) {
      if (liquido <= 0) continue;
      this.bebidas.somarSaldo(bebidaId, liquido);
      const depois = this.bebidas.findById(bebidaId);
      this.movimentacoes.insert({ bebidaId, tipo: 'ESTORNO', quantidade: liquido, saldoApos: depois.estoqueQtd, pedidoId, actor, em });
      eventos.push(this.#evento(depois));
    }
    return eventos;
  }

  /** Soma as quantidades por bebida, validando cada item. */
  #somar(itens) {
    const total = new Map();
    for (const item of itens || []) {
      if (!Number.isInteger(item?.bebidaId) || !Number.isInteger(item?.quantidade) || item.quantidade < 1) {
        throw new ValidationError('Item de bebida inválido');
      }
      total.set(item.bebidaId, (total.get(item.bebidaId) || 0) + item.quantidade);
    }
    return total;
  }

  /** Variação de saldo que a movimentação provoca; SAIDA acima do saldo é 409. */
  #delta(bebida, pedido) {
    if (pedido.tipo === 'ENTRADA') return pedido.quantidade;
    if (pedido.tipo === 'AJUSTE') return pedido.novaQuantidade - bebida.estoqueQtd;
    if (pedido.quantidade > bebida.estoqueQtd) {
      throw new ConflictError(`Saldo insuficiente de "${bebida.nome}" (saldo ${bebida.estoqueQtd}, saída ${pedido.quantidade})`);
    }
    return -pedido.quantidade;
  }

  #evento(bebida) {
    return { bebidaId: bebida.id, estoqueQtd: bebida.estoqueQtd, critico: bebida.critico };
  }

  #exigir(id) {
    const bebida = this.bebidas.findById(id);
    if (!bebida) throw new NotFoundError();
    return bebida;
  }
}

module.exports = EstoqueService;
