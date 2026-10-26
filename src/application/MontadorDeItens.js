'use strict';
const ValidationError = require('../domain/errors/ValidationError');
const ConflictError = require('../domain/errors/ConflictError');
const { validarItem } = require('../domain/pedido/ItemValidator');
const { calcularItem } = require('../domain/pedido/calculos');

/**
 * Transforma `ItemInput` do cliente em itens prontos para gravar, lendo prato e adicionais do banco no momento
 * da gravação (preços do cliente são ignorados) e montando o retrato (RN-06).
 */
class MontadorDeItens {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/PratoRepository')} deps.pratos
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.categorias
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.ingredientes
   */
  constructor({ pratos, categorias, ingredientes }) {
    this.pratos = pratos;
    this.categorias = categorias;
    this.ingredientes = ingredientes;
  }

  /** @returns {Array<object>} itens com retrato: pratoNome, precoUnitCents, adicionaisCents, totalCents, modificacoes */
  montar(entradas, { exigirAoMenosUm = false } = {}) {
    if (entradas === undefined || entradas === null) entradas = [];
    if (!Array.isArray(entradas)) throw new ValidationError('Os itens devem ser uma lista');
    if (exigirAoMenosUm && entradas.length === 0) throw new ValidationError('Informe ao menos um item');
    if (entradas.length === 0) return [];
    const adicionais = this.ingredientes.findAll().filter((i) => i.ativo && i.podeSerAdicional)
      .map((i) => ({ ingredienteId: i.id, nome: i.nome, precoAdicionalCents: i.precoAdicionalCents }));
    return entradas.map((entrada) => this.#montarUm(entrada, adicionais));
  }

  #montarUm(entrada, adicionais) {
    if (!entrada || typeof entrada !== 'object') throw new ValidationError('Informe os dados do item');
    const prato = this.#pratoPedivel(entrada.pratoId);
    const item = validarItem(entrada, prato, adicionais);
    const porId = new Map(adicionais.map((a) => [a.ingredienteId, a]));
    const adicionar = item.adicionar.map((a) => ({ ...a, nome: porId.get(a.ingredienteId).nome, precoUnitCents: porId.get(a.ingredienteId).precoAdicionalCents }));
    const { adicionaisCents, totalCents } = calcularItem({ precoPratoCents: prato.precoCents, adicionais: adicionar, quantidade: item.quantidade });
    const nomes = new Map(prato.ingredientes.map((i) => [i.ingredienteId, i.nome]));
    const modificacoes = [
      ...item.remover.map((id) => ({ ingredienteId: id, ingredienteNome: nomes.get(id), tipo: 'REMOVER', quantidade: 1, precoUnitCents: 0 })),
      ...adicionar.map((a) => ({ ingredienteId: a.ingredienteId, ingredienteNome: a.nome, tipo: 'ADICIONAR', quantidade: a.quantidade, precoUnitCents: a.precoUnitCents })),
    ];
    return {
      pratoId: prato.id, pratoNome: prato.nome, precoUnitCents: prato.precoCents, adicionaisCents, quantidade: item.quantidade,
      totalCents, observacao: item.observacao, modificacoes,
    };
  }

  #pratoPedivel(pratoId) {
    if (!Number.isSafeInteger(pratoId) || pratoId < 1) throw new ValidationError('O prato é inválido');
    const prato = this.pratos.findById(pratoId);
    if (!prato) throw new ValidationError('Prato inexistente');
    if (!prato.ativo) throw new ConflictError(`O prato "${prato.nome}" está inativo e não pode ser pedido`);
    const categoria = this.categorias.findById(prato.categoriaId);
    if (!categoria || !categoria.ativo) throw new ConflictError(`A categoria do prato "${prato.nome}" está inativa`);
    return prato;
  }
}

module.exports = MontadorDeItens;
