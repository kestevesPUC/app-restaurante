'use strict';
const ValidationError = require('../errors/ValidationError');
const { quantidadeInteira } = require('./calculos');

const OBSERVACAO_MAX = 140;
const CLIENTE_NOME_MAX = 60;

function lista(valor, rotulo) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) throw new ValidationError(`${rotulo} deve ser uma lista`);
  return valor;
}

function idInteiro(valor, rotulo) {
  if (!Number.isSafeInteger(valor) || valor < 1) throw new ValidationError(`${rotulo} é inválido`);
  return valor;
}

function observacaoDe(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ValidationError('A observação deve ser um texto');
  const texto = valor.trim();
  if ([...texto].length > OBSERVACAO_MAX) throw new ValidationError(`A observação deve ter no máximo ${OBSERVACAO_MAX} caracteres`);
  return texto || null;
}

/**
 * Valida e normaliza um item de pedido (RN-05). Preços vindos do cliente são ignorados.
 *
 * prato:                { id, nome, precoCents, ingredientes: [{ ingredienteId, removivel }] }
 * adicionaisDisponiveis: [{ ingredienteId, nome, precoAdicionalCents }]  (ingredientes com podeSerAdicional)
 * retorno (ItemNormalizado): { pratoId, quantidade, observacao, remover: number[],
 *                              adicionar: [{ ingredienteId, quantidade }] }
 */
function validarItem(entrada, prato, adicionaisDisponiveis) {
  if (!entrada || typeof entrada !== 'object') throw new ValidationError('Informe os dados do item');
  const quantidade = quantidadeInteira(entrada.quantidade, 'A quantidade');
  const observacao = observacaoDe(entrada.observacao);

  const removiveis = new Set((prato.ingredientes || []).filter((i) => i.removivel).map((i) => i.ingredienteId));
  const remover = [];
  for (const id of lista(entrada.remover, 'remover')) {
    idInteiro(id, 'O ingrediente a remover');
    if (remover.includes(id)) throw new ValidationError('Ingrediente repetido em remover');
    if (!removiveis.has(id)) throw new ValidationError('Só é possível remover ingredientes removíveis do prato');
    remover.push(id);
  }

  const permitidos = new Set((adicionaisDisponiveis || []).map((a) => a.ingredienteId));
  const adicionar = [];
  for (const a of lista(entrada.adicionar, 'adicionar')) {
    if (!a || typeof a !== 'object') throw new ValidationError('Adicional inválido');
    const ingredienteId = idInteiro(a.ingredienteId, 'O ingrediente adicional');
    if (adicionar.some((x) => x.ingredienteId === ingredienteId)) throw new ValidationError('Ingrediente repetido em adicionar');
    if (!permitidos.has(ingredienteId)) throw new ValidationError('Este ingrediente não pode ser adicionado');
    if (remover.includes(ingredienteId)) throw new ValidationError('Um ingrediente não pode ser removido e adicionado ao mesmo tempo');
    adicionar.push({ ingredienteId, quantidade: quantidadeInteira(a.quantidade, 'A quantidade do adicional') });
  }

  return { pratoId: prato.id, quantidade, observacao, remover, adicionar };
}

/** Identificação do pedido: MESA exige mesaId; BALCAO exige nome do cliente. */
function validarIdentificacao({ tipo, mesaId, clienteNome } = {}) {
  if (tipo !== 'BALCAO' && tipo !== 'MESA') throw new ValidationError('O tipo do pedido deve ser BALCAO ou MESA');
  if (clienteNome !== undefined && clienteNome !== null && typeof clienteNome !== 'string') {
    throw new ValidationError('O nome do cliente deve ser um texto');
  }
  const nome = typeof clienteNome === 'string' ? clienteNome.trim() : '';
  if ([...nome].length > CLIENTE_NOME_MAX) throw new ValidationError(`O nome do cliente deve ter no máximo ${CLIENTE_NOME_MAX} caracteres`);

  if (tipo === 'MESA') {
    return { tipo, mesaId: idInteiro(mesaId, 'A mesa'), clienteNome: nome || null };
  }
  if (!nome) throw new ValidationError('Informe o nome do cliente');
  return { tipo, mesaId: null, clienteNome: nome };
}

module.exports = { validarItem, validarIdentificacao, OBSERVACAO_MAX, CLIENTE_NOME_MAX };
