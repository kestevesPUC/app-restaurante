'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const { validarMesa } = require('../domain/mesaValidator');

const { ehViolacaoDeChave } = require('../infrastructure/database/violacoes');

/** Casos de uso das mesas (RN-10): cadastro, ocupar e liberar. Toda alteração é auditada. */
class MesaService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/MesaRepository')} deps.repository
   * @param {import('./AuditTrail')} deps.audit
   * @param {import('../infrastructure/events/EventBus')} [deps.bus] recebe o evento `mesa` a cada mudança de situação
   * @param {(mesaId:number) => boolean} [deps.comandaNaoPagaDaMesa] porta ligada ao repositório de pedidos (Tarefa 11)
   */
  constructor({ repository, audit, bus = null, comandaNaoPagaDaMesa = () => false }) {
    this.repository = repository;
    this.audit = audit;
    this.bus = bus;
    this.comandaNaoPagaDaMesa = comandaNaoPagaDaMesa;
  }

  list() {
    return this.repository.findAllComPedidoAberto();
  }

  create(user, body) {
    const dados = validarMesa(body);
    this.#garantirNumeroLivre(dados.numero);
    const criada = this.repository.create(dados);
    this.#log(user, 'criar', criada, 'cadastrada', null, criada);
    return criada;
  }

  update(user, id, body) {
    const antes = this.#exigir(id);
    const dados = validarMesa(body, antes);
    this.#garantirNumeroLivre(dados.numero, antes.id);
    const depois = this.repository.update(antes.id, dados);
    this.#log(user, 'alterar', depois, 'alterada', antes, depois);
    return depois;
  }

  remove(user, id) {
    const antes = this.#exigir(id);
    try {
      this.repository.delete(antes.id);
    } catch (error) {
      if (ehViolacaoDeChave(error)) throw new ConflictError('Em uso');
      throw error;
    }
    this.#log(user, 'excluir', antes, 'excluída', antes, null);
    return { ok: true };
  }

  /**
   * LIVRE ou RESERVADA → OCUPADA.
   * `eventos`: se informado, o evento `mesa` é acrescentado a esta lista em vez de publicado (quem chama publica após o commit).
   */
  ocupar(user, id, { eventos = null } = {}) {
    const antes = this.#exigir(id);
    if (!antes.ativo) throw new ConflictError('Mesa inativa não pode ser ocupada');
    if (antes.situacao === 'OCUPADA') throw new ConflictError('A mesa já está ocupada');
    return this.#mudarSituacao(user, antes, 'OCUPADA', 'ocupar', 'ocupada', eventos);
  }

  /** → LIVRE, desde que não haja comanda em aberto. `sugestaoFila` é preenchida na Parte 2. */
  liberar(user, id, { eventos = null } = {}) {
    const antes = this.#exigir(id);
    if (this.comandaNaoPagaDaMesa(antes.id)) throw new ConflictError('Mesa com conta em aberto');
    const mesa = this.#mudarSituacao(user, antes, 'LIVRE', 'liberar', 'liberada', eventos);
    return { mesa, sugestaoFila: null };
  }

  #mudarSituacao(user, antes, situacao, acao, verbo, eventos = null) {
    const depois = this.repository.setSituacao(antes.id, situacao);
    this.#log(user, acao, depois, verbo, antes, depois);
    const evento = { id: depois.id, situacao: depois.situacao };
    if (eventos) eventos.push(evento);
    else this.bus?.publish('mesa', evento);
    return depois;
  }

  #garantirNumeroLivre(numero, idAtual = null) {
    const existente = this.repository.findByNumero(numero);
    if (existente && existente.id !== idAtual) throw new ConflictError('Já existe mesa com este número');
  }

  #log(user, acao, mesa, verbo, antes, depois) {
    this.audit.record({
      actor: user, acao, entidade: 'mesa', entidadeId: mesa.id, descricao: `Mesa "${mesa.numero}" ${verbo}`, antes, depois,
    });
  }

  #exigir(id) {
    const mesa = this.repository.findById(id);
    if (!mesa) throw new NotFoundError();
    return mesa;
  }
}

module.exports = MesaService;
