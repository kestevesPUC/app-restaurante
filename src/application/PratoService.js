'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ConflictError = require('../domain/errors/ConflictError');
const ValidationError = require('../domain/errors/ValidationError');
const { validarPrato } = require('../domain/cardapio/pratoValidator');

const ehViolacaoDeChave = (error) => /FOREIGN KEY/i.test(error?.message || '');

/** Casos de uso de pratos (com a lista de ingredientes), foto e cardápio. Toda alteração é auditada. */
class PratoService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/PratoRepository')} deps.repository
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.categorias
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.ingredientes
   * @param {import('../domain/validation/FotoValidator')} deps.fotoValidator
   * @param {import('./AuditTrail')} deps.audit
   * @param {(pratoId:number) => boolean} [deps.pratoJaPedido] porta ligada ao repositório de pedidos
   */
  constructor({ repository, categorias, ingredientes, fotoValidator, audit, pratoJaPedido = () => false }) {
    this.repository = repository;
    this.categorias = categorias;
    this.ingredientes = ingredientes;
    this.fotoValidator = fotoValidator;
    this.audit = audit;
    this.pratoJaPedido = pratoJaPedido;
  }

  list() {
    return this.repository.findAll();
  }

  /** Tudo que a tela de pedido precisa, só com itens ativos. */
  cardapio() {
    const categorias = this.categorias.findAll().filter((c) => c.ativo);
    const idsAtivos = new Set(categorias.map((c) => c.id));
    const pratos = this.repository.findAll({ somenteAtivos: true }).filter((p) => idsAtivos.has(p.categoriaId));
    const adicionais = this.ingredientes.findAll().filter((i) => i.ativo && i.podeSerAdicional);
    return { categorias, pratos, adicionais };
  }

  create(actor, body) {
    const dados = validarPrato(body);
    this.#validarReferencias(dados, []);
    this.#garantirUnicos(dados);
    const criado = this.repository.create(dados);
    this.#log(actor, 'criar', criado, 'cadastrado', null, criado);
    return criado;
  }

  update(actor, id, body) {
    const antes = this.#exigir(id);
    const dados = validarPrato(body, antes);
    this.#validarReferencias(dados, antes.ingredientes.map((i) => i.ingredienteId));
    this.#garantirUnicos(dados, antes.id);
    const depois = this.repository.update(antes.id, dados);
    this.#log(actor, 'alterar', depois, 'alterado', antes, depois);
    return depois;
  }

  desativar(actor, id) {
    return this.update(actor, id, { ativo: false });
  }

  remove(actor, id) {
    const antes = this.#exigir(id);
    if (this.pratoJaPedido(antes.id)) throw new ConflictError('Em uso');
    try {
      this.repository.delete(antes.id);
    } catch (error) {
      if (ehViolacaoDeChave(error)) throw new ConflictError('Em uso');
      throw error;
    }
    this.#log(actor, 'excluir', antes, 'excluído', antes, null);
    return { ok: true };
  }

  definirFoto(actor, id, dataUri) {
    const antes = this.#exigir(id);
    this.repository.setFoto(antes.id, this.fotoValidator.parse(dataUri));
    const depois = this.repository.findById(antes.id);
    this.#log(actor, 'alterar', depois, 'recebeu foto', antes, depois);
    return depois;
  }

  removerFoto(actor, id) {
    const antes = this.#exigir(id);
    this.repository.setFoto(antes.id, null);
    const depois = this.repository.findById(antes.id);
    this.#log(actor, 'alterar', depois, 'teve a foto removida', antes, depois);
    return depois;
  }

  foto(id) {
    const foto = this.repository.getFoto(Number(id));
    if (!foto) throw new NotFoundError();
    return foto;
  }

  /** Categoria existente; ingredientes existentes e ativos (os que já estavam no prato podem ter sido desativados depois). */
  #validarReferencias(dados, jaNoPrato) {
    if (!this.categorias.findById(dados.categoriaId)) throw new ValidationError('Categoria inexistente');
    for (const item of dados.ingredientes || []) {
      const ingrediente = this.ingredientes.findById(item.ingredienteId);
      if (!ingrediente) throw new ValidationError('Ingrediente inexistente');
      if (!ingrediente.ativo && !jaNoPrato.includes(item.ingredienteId)) {
        throw new ValidationError(`O ingrediente "${ingrediente.nome}" está inativo`);
      }
    }
  }

  #garantirUnicos(dados, idAtual = null) {
    const mesmoNome = this.repository.findByNome(dados.nome);
    if (mesmoNome && mesmoNome.id !== idAtual) throw new ConflictError('Já existe prato com este nome');
    const mesmoCodigo = dados.codigo && this.repository.findByCodigo(dados.codigo);
    if (mesmoCodigo && mesmoCodigo.id !== idAtual) throw new ConflictError('Já existe prato com este código');
  }

  #log(actor, acao, prato, verbo, antes, depois) {
    this.audit.record({ actor, acao, entidade: 'prato', entidadeId: prato.id, descricao: `Prato "${prato.nome}" ${verbo}`, antes, depois });
  }

  #exigir(id) {
    const prato = this.repository.findById(id);
    if (!prato) throw new NotFoundError();
    return prato;
  }
}

module.exports = PratoService;
