'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const { validarBebida } = require('../domain/estoque/bebidaValidator');

const { ehViolacaoDeChave } = require('../infrastructure/database/violacoes');

const EM_USO = 'Em uso: há movimentações ou pedidos desta bebida; desative-a em vez de excluir';

/** Cadastro de bebidas. O saldo só muda por movimentação de estoque (exceto o estoque inicial, na criação). Tudo é auditado. */
class BebidaService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/database/SqliteDatabase')} deps.db
   * @param {import('../infrastructure/repositories/BebidaRepository')} deps.repository
   * @param {import('../infrastructure/repositories/MovimentacaoRepository')} deps.movimentacoes
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} deps.bus
   * @param {() => Date} deps.clock
   */
  constructor({ db, repository, movimentacoes, audit, bus, clock }) {
    this.db = db;
    this.repository = repository;
    this.movimentacoes = movimentacoes;
    this.audit = audit;
    this.bus = bus;
    this.clock = clock;
  }

  list() {
    return this.repository.findAll();
  }

  create(actor, body) {
    const dados = validarBebida(body);
    this.#garantirNomeLivre(dados.nome);
    const em = this.clock().toISOString();
    const criada = this.db.transaction(() => {
      const bebida = this.repository.create(dados, em);
      if (dados.estoqueInicial > 0) {
        this.movimentacoes.insert({ bebidaId: bebida.id, tipo: 'ENTRADA', quantidade: dados.estoqueInicial, saldoApos: dados.estoqueInicial, motivo: 'Estoque inicial', actor, em });
      }
      return bebida;
    });
    this.#log(actor, 'criar', criada, 'cadastrada', null, criada);
    if (criada.estoqueQtd > 0) this.bus.publish('estoque', { bebidaId: criada.id, estoqueQtd: criada.estoqueQtd, critico: criada.critico });
    return criada;
  }

  update(actor, id, body) {
    const antes = this.#exigir(id);
    const dados = validarBebida(body, antes);
    this.#garantirNomeLivre(dados.nome, antes.id);
    const depois = this.repository.update(antes.id, dados);
    this.#log(actor, 'alterar', depois, 'alterada', antes, depois);
    if (depois.critico !== antes.critico) this.bus.publish('estoque', { bebidaId: depois.id, estoqueQtd: depois.estoqueQtd, critico: depois.critico });
    return depois;
  }

  /** Só sem movimentos além do "Estoque inicial" e fora de pedidos; senão 409 sugerindo desativar. */
  remove(actor, id) {
    const antes = this.#exigir(id);
    try {
      this.db.transaction(() => {
        if (this.movimentacoes.contarAlemDoInicial(antes.id) > 0) throw new ConflictError(EM_USO);
        this.movimentacoes.excluirDaBebida(antes.id);
        this.repository.delete(antes.id);
      });
    } catch (error) {
      if (ehViolacaoDeChave(error)) throw new ConflictError(EM_USO);
      throw error;
    }
    this.#log(actor, 'excluir', antes, 'excluída', antes, null);
    return { ok: true };
  }

  #garantirNomeLivre(nome, idAtual = null) {
    const existente = this.repository.findByNome(nome);
    if (existente && existente.id !== idAtual) throw new ConflictError('Já existe bebida com este nome');
  }

  #log(actor, acao, bebida, verbo, antes, depois) {
    this.audit.record({ actor, acao, entidade: 'bebida', entidadeId: bebida.id, descricao: `Bebida "${bebida.nome}" ${verbo}`, antes, depois });
  }

  #exigir(id) {
    const bebida = this.repository.findById(id);
    if (!bebida) throw new NotFoundError();
    return bebida;
  }
}

module.exports = BebidaService;
