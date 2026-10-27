'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const { validarChavePix } = require('../domain/pix/chavePixValidator');
const { gerarBrCode } = require('../domain/pix/brcode');

/** Chaves PIX (cadastro auditado, uma padrão) e a cobrança PIX de um pedido com a chave padrão. */
class PixService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/ChavePixRepository')} deps.repository
   * @param {import('../infrastructure/database/SqliteDatabase')} deps.db
   * @param {import('./AuditTrail')} deps.audit
   * @param {(user: object, id: number) => object} deps.obterPedido
   * @param {() => Date} deps.clock
   */
  constructor({ repository, db, audit, obterPedido, clock }) {
    this.repository = repository;
    this.db = db;
    this.audit = audit;
    this.obterPedido = obterPedido;
    this.clock = clock;
  }

  list() {
    return this.repository.findAll();
  }

  /** A primeira chave cadastrada já vira a padrão. */
  create(user, body) {
    const dados = validarChavePix(body);
    this.#garantirChaveLivre(dados.chave);
    const criada = this.db.transaction(() => {
      const nova = this.repository.create(dados, this.clock().toISOString());
      return this.repository.count() === 1 ? this.repository.definirPadrao(nova.id) : nova;
    });
    this.#log(user, 'criar', criada, 'cadastrada', null, criada);
    return criada;
  }

  update(user, id, body) {
    const antes = this.#exigir(id);
    const dados = validarChavePix(body, antes);
    this.#garantirChaveLivre(dados.chave, antes.id);
    const depois = this.repository.update(antes.id, dados);
    this.#log(user, 'alterar', depois, 'alterada', antes, depois);
    return depois;
  }

  remove(user, id) {
    const antes = this.#exigir(id);
    if (antes.padrao && this.repository.count() > 1) throw new ConflictError('Defina outra chave como padrão antes de excluir esta');
    this.repository.delete(antes.id);
    this.#log(user, 'excluir', antes, 'excluída', antes, null);
    return { ok: true };
  }

  definirPadrao(user, id) {
    const antes = this.#exigir(id);
    const depois = this.db.transaction(() => this.repository.definirPadrao(antes.id));
    this.#log(user, 'definir_padrao', depois, 'definida como padrão', antes, depois);
    return depois;
  }

  /** BR Code ("copia e cola") do valor total do pedido, com a chave padrão. */
  cobrancaDoPedido(user, pedidoId) {
    const pedido = this.obterPedido(user, pedidoId);
    if (pedido.status === 'CANCELADO') throw new ConflictError('Pedido cancelado');
    const chave = this.repository.findPadrao();
    if (!chave) throw new ConflictError('Nenhuma chave PIX padrão cadastrada');
    const payload = gerarBrCode({
      chave: chave.chave, nome: chave.nomeRecebedor, cidade: chave.cidade, valorCents: pedido.totalCents, txid: `PEDIDO${pedido.id}`,
    });
    return {
      pedidoId: pedido.id, valorCents: pedido.totalCents, payload,
      chave: { descricao: chave.descricao, tipo: chave.tipo, chave: chave.chave, nomeRecebedor: chave.nomeRecebedor },
    };
  }

  #garantirChaveLivre(chave, idAtual = null) {
    const existente = this.repository.findByChave(chave);
    if (existente && existente.id !== idAtual) throw new ConflictError('Esta chave PIX já está cadastrada');
  }

  #log(user, acao, chave, verbo, antes, depois) {
    this.audit.record({
      actor: user, acao, entidade: 'chave_pix', entidadeId: chave.id, descricao: `Chave PIX "${chave.descricao}" ${verbo}`, antes, depois,
    });
  }

  #exigir(id) {
    const chave = this.repository.findById(id);
    if (!chave) throw new NotFoundError();
    return chave;
  }
}

module.exports = PixService;
