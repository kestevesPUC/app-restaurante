'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');

const { ehViolacaoDeChave } = require('../infrastructure/database/violacoes');

/** Casos de uso dos cadastros simples do cardápio (categorias, ingredientes). Toda alteração é auditada. */
class CadastroService {
  /**
   * @param {object} deps
   * @param {string} deps.entity nome da entidade na auditoria e nas mensagens (ex.: 'ingrediente')
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.repository
   * @param {(body:object, atual?:object) => object} deps.validate valida e completa o corpo (atual = registro existente, no PUT)
   * @param {import('./AuditTrail')} deps.audit
   */
  constructor({ entity, repository, validate, audit }) {
    this.entity = entity;
    this.repository = repository;
    this.validate = validate;
    this.audit = audit;
  }

  list() {
    return this.repository.findAll();
  }

  create(actor, body) {
    const dados = this.validate(body);
    this.#garantirNomeLivre(dados.nome);
    const criado = this.repository.create(dados);
    this.#log(actor, 'criar', criado, 'cadastrado', null, criado);
    return criado;
  }

  update(actor, id, body) {
    const antes = this.#exigir(id);
    const dados = this.validate(body, antes);
    this.#garantirNomeLivre(dados.nome, antes.id);
    const depois = this.repository.update(antes.id, dados);
    this.#log(actor, 'alterar', depois, 'alterado', antes, depois);
    return depois;
  }

  remove(actor, id) {
    const antes = this.#exigir(id);
    try {
      this.repository.delete(antes.id);
    } catch (error) {
      if (ehViolacaoDeChave(error)) throw new ConflictError('Em uso');
      throw error;
    }
    this.#log(actor, 'excluir', antes, 'excluído', antes, null);
    return { ok: true };
  }

  #garantirNomeLivre(nome, idAtual = null) {
    const existente = this.repository.findByNome(nome);
    if (existente && existente.id !== idAtual) throw new ConflictError(`Já existe ${this.entity} com este nome`);
  }

  #log(actor, acao, registro, verbo, antes, depois) {
    const rotulo = `${this.entity.charAt(0).toUpperCase()}${this.entity.slice(1)}`;
    this.audit.record({
      actor, acao, entidade: this.entity, entidadeId: registro.id, descricao: `${rotulo} "${registro.nome}" ${verbo}`, antes, depois,
    });
  }

  #exigir(id) {
    const registro = this.repository.findById(id);
    if (!registro) throw new NotFoundError();
    return registro;
  }
}

module.exports = CadastroService;
