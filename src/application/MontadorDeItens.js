'use strict';
const ValidationError = require('../domain/errors/ValidationError');
const ConflictError = require('../domain/errors/ConflictError');
const { validarItem, validarItemBebida } = require('../domain/pedido/ItemValidator');
const { calcularItem } = require('../domain/pedido/calculos');

const LIMITE_ITENS = 200;

/**
 * Transforma `ItemInput` ({ tipo: 'PRATO'|'BEBIDA', itemId, quantidade, observacao?, remover?, adicionar? }) em itens prontos
 * para gravar, lendo prato/bebida e adicionais do banco (preços do cliente são ignorados) e montando o retrato (RN-06).
 * Bebidas passam por uma verificação SUAVE de estoque (não reserva: a baixa real é na confirmação).
 */
class MontadorDeItens {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/PratoRepository')} deps.pratos
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.categorias
   * @param {import('../infrastructure/repositories/CrudRepository')} deps.ingredientes
   * @param {import('../infrastructure/repositories/BebidaRepository')} deps.bebidas
   */
  constructor({ pratos, categorias, ingredientes, bebidas }) {
    Object.assign(this, { pratos, categorias, ingredientes, bebidas });
  }

  /** @returns {Array<object>} { tipo, itemId, nome, precoUnitCents, adicionaisCents, quantidade, totalCents, observacao, tempoPreparoMin, modificacoes } */
  montar(entradas) {
    if (entradas === undefined || entradas === null) return [];
    if (!Array.isArray(entradas)) throw new ValidationError('Os itens devem ser uma lista');
    if (entradas.length > LIMITE_ITENS) throw new ValidationError(`O pedido aceita no máximo ${LIMITE_ITENS} itens`);
    if (entradas.length === 0) return [];
    const adicionais = this.ingredientes.findAll().filter((i) => i.ativo && i.podeSerAdicional)
      .map((i) => ({ ingredienteId: i.id, nome: i.nome, precoAdicionalCents: i.precoAdicionalCents }));
    const itens = entradas.map((entrada) => {
      if (!entrada || typeof entrada !== 'object') throw new ValidationError('Informe os dados do item');
      if (entrada.tipo === 'PRATO') return this.#prato(entrada, adicionais);
      if (entrada.tipo === 'BEBIDA') return this.#bebida(entrada);
      throw new ValidationError('O tipo do item deve ser PRATO ou BEBIDA');
    });
    this.#verificarEstoque(itens);
    return itens;
  }

  #prato(entrada, adicionais) {
    const prato = this.#pratoPedivel(entrada.itemId);
    const item = validarItem({ ...entrada, tipo: undefined }, prato, adicionais);
    const porId = new Map(adicionais.map((a) => [a.ingredienteId, a]));
    const adicionar = item.adicionar.map((a) => ({ ...a, nome: porId.get(a.ingredienteId).nome, precoUnitCents: porId.get(a.ingredienteId).precoAdicionalCents }));
    const { adicionaisCents, totalCents } = calcularItem({ precoPratoCents: prato.precoCents, adicionais: adicionar, quantidade: item.quantidade });
    const nomes = new Map(prato.ingredientes.map((i) => [i.ingredienteId, i.nome]));
    const modificacoes = [
      ...item.remover.map((id) => ({ ingredienteId: id, ingredienteNome: nomes.get(id), tipo: 'REMOVER', quantidade: 1, precoUnitCents: 0 })),
      ...adicionar.map((a) => ({ ingredienteId: a.ingredienteId, ingredienteNome: a.nome, tipo: 'ADICIONAR', quantidade: a.quantidade, precoUnitCents: a.precoUnitCents })),
    ];
    return {
      tipo: 'PRATO', itemId: prato.id, nome: prato.nome, precoUnitCents: prato.precoCents, adicionaisCents, quantidade: item.quantidade,
      totalCents, observacao: item.observacao, tempoPreparoMin: prato.tempoPreparoMin, modificacoes,
    };
  }

  #bebida(entrada) {
    const id = entrada.itemId;
    if (!Number.isSafeInteger(id) || id < 1) throw new ValidationError('A bebida é inválida');
    const bebida = this.bebidas.findById(id);
    if (!bebida) throw new ValidationError('Bebida inexistente');
    if (!bebida.ativo) throw new ConflictError(`A bebida "${bebida.nome}" está inativa e não pode ser pedida`);
    const item = validarItemBebida(entrada, bebida);
    const { totalCents } = calcularItem({ precoPratoCents: bebida.precoCents, adicionais: [], quantidade: item.quantidade });
    return {
      tipo: 'BEBIDA', itemId: bebida.id, nome: bebida.nome, precoUnitCents: bebida.precoCents, adicionaisCents: 0, quantidade: item.quantidade,
      totalCents, observacao: item.observacao, tempoPreparoMin: 0, modificacoes: [], saldo: bebida.estoqueQtd,
    };
  }

  /** Quantidade total de cada bebida no pedido > saldo atual → 409 (sem reservar). */
  #verificarEstoque(itens) {
    const total = new Map();
    for (const item of itens.filter((i) => i.tipo === 'BEBIDA')) {
      const atual = total.get(item.itemId) ?? { nome: item.nome, saldo: item.saldo, quantidade: 0 };
      atual.quantidade += item.quantidade;
      total.set(item.itemId, atual);
      delete item.saldo;
    }
    const faltam = [...total.entries()].filter(([, b]) => b.quantidade > b.saldo);
    if (!faltam.length) return;
    const erro = new ConflictError(`Estoque insuficiente: ${faltam.map(([, b]) => `${b.nome} (saldo ${b.saldo}, pedido ${b.quantidade})`).join('; ')}`);
    erro.detalhes = faltam.map(([bebidaId, b]) => ({ bebidaId, bebida: b.nome, saldo: b.saldo, pedido: b.quantidade, motivo: 'SALDO' }));
    throw erro;
  }

  #pratoPedivel(pratoId) {
    if (!Number.isSafeInteger(pratoId) || pratoId < 1) throw new ValidationError('O prato é inválido');
    const prato = this.pratos.findById(pratoId);
    if (!prato) throw new ValidationError('Prato inexistente');
    if (!prato.ativo) throw new ConflictError(`O prato "${prato.nome}" está inativo e não pode ser pedido`);
    const categoria = this.categorias.findById(prato.categoriaId);
    if (!categoria || !categoria.ativo) throw new ConflictError(`A categoria do prato "${prato.nome}" está inativa`);
    if (!Number.isSafeInteger(prato.tempoPreparoMin) || prato.tempoPreparoMin < 1) {
      throw new ConflictError(`O prato "${prato.nome}" está sem tempo de preparo válido; corrija o cadastro`);
    }
    return prato;
  }
}

module.exports = MontadorDeItens;
