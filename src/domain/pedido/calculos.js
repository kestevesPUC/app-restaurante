'use strict';
const ValidationError = require('../errors/ValidationError');

/** Dinheiro: centavos inteiros, seguros e não negativos. */
function centavos(valor, rotulo) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ValidationError(`${rotulo} deve ser um valor em centavos inteiro, maior ou igual a zero`);
  }
  return valor;
}

/** Quantidade: inteiro >= 1. */
function quantidadeInteira(valor, rotulo) {
  if (!Number.isSafeInteger(valor) || valor < 1) {
    throw new ValidationError(`${rotulo} deve ser um inteiro maior ou igual a 1`);
  }
  return valor;
}

function seguro(valor, rotulo) {
  if (!Number.isSafeInteger(valor)) throw new ValidationError(`${rotulo} excede o limite permitido`);
  return valor;
}

/**
 * Total de uma linha do pedido: (preço do prato + adicionais) × quantidade.
 * `adicionaisCents` é o valor dos adicionais por unidade do prato.
 * Remover ingrediente não reduz o preço.
 */
function calcularItem({ precoPratoCents, adicionais = [], quantidade } = {}) {
  centavos(precoPratoCents, 'O preço do prato');
  quantidadeInteira(quantidade, 'A quantidade');
  if (!Array.isArray(adicionais)) throw new ValidationError('Os adicionais devem ser uma lista');

  let adicionaisPorUnidade = 0;
  for (const a of adicionais) {
    centavos(a && a.precoUnitCents, 'O preço do adicional');
    quantidadeInteira(a.quantidade, 'A quantidade do adicional');
    adicionaisPorUnidade = seguro(adicionaisPorUnidade + seguro(a.precoUnitCents * a.quantidade, 'O valor do adicional'), 'O valor dos adicionais');
  }
  const adicionaisCents = adicionaisPorUnidade; // por unidade do prato
  const totalCents = seguro((precoPratoCents + adicionaisCents) * quantidade, 'O total do item');
  return { adicionaisCents, totalCents };
}

/** Totais do pedido: itens cancelados não entram; o desconto não pode passar do subtotal. */
function calcularPedido(itens, descontoCents = 0) {
  if (!Array.isArray(itens)) throw new ValidationError('Os itens devem ser uma lista');
  centavos(descontoCents, 'O desconto');

  let subtotalCents = 0;
  for (const item of itens) {
    const total = centavos(item && item.totalCents, 'O total do item');
    if (item.cancelado) continue;
    subtotalCents = seguro(subtotalCents + total, 'O subtotal');
  }
  if (descontoCents > subtotalCents) throw new ValidationError('O desconto não pode ser maior que o subtotal');
  return { subtotalCents, descontoCents, totalCents: subtotalCents - descontoCents };
}

module.exports = { calcularItem, calcularPedido, centavos, quantidadeInteira };
