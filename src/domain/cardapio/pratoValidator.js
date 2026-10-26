'use strict';
const ValidationError = require('../errors/ValidationError');
const { validarNome, mesclar, booleano } = require('./validators');

const CODIGO_MAX = 20;
const QUANTIDADE_MAX = 40;
const DESCRICAO_MAX = 300;
const PRATO_PADRAO = { nome: undefined, codigo: null, categoriaId: undefined, descricao: null, precoCents: undefined, tempoPreparoMin: undefined, ativo: true };

function textoOpcional(valor, max, rotulo) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string') throw new ValidationError(`${rotulo} deve ser um texto`);
  const texto = valor.trim();
  if ([...texto].length > max) throw new ValidationError(`${rotulo} deve ter no máximo ${max} caracteres`);
  return texto || null;
}

function validarIngredientes(lista) {
  if (!Array.isArray(lista)) throw new ValidationError('ingredientes deve ser uma lista');
  const vistos = new Set();
  return lista.map((item, i) => {
    const ingredienteId = item?.ingredienteId;
    if (!Number.isInteger(ingredienteId) || ingredienteId <= 0) throw new ValidationError('Ingrediente inválido na lista');
    if (vistos.has(ingredienteId)) throw new ValidationError('O mesmo ingrediente não pode aparecer duas vezes no prato');
    vistos.add(ingredienteId);
    const ordem = item.ordem ?? i;
    if (!Number.isInteger(ordem) || ordem < 0) throw new ValidationError('A ordem do ingrediente deve ser um inteiro maior ou igual a zero');
    return {
      ingredienteId,
      removivel: booleano(item.removivel ?? true, 'removivel'),
      quantidade: textoOpcional(item.quantidade, QUANTIDADE_MAX, 'A quantidade'),
      ordem,
    };
  });
}

/**
 * Valida o corpo de um prato. `atual` é o prato existente (PUT mescla). `ingredientes` só vem no
 * resultado quando informado no corpo (ou na criação); ausente significa "manter a lista".
 */
function validarPrato(body, atual = PRATO_PADRAO) {
  const d = mesclar(atual, body);
  if (!Number.isInteger(d.categoriaId) || d.categoriaId <= 0) throw new ValidationError('Informe a categoria');
  if (!Number.isInteger(d.precoCents) || d.precoCents <= 0) throw new ValidationError('O preço deve ser um inteiro de centavos maior que zero');
  if (!Number.isInteger(d.tempoPreparoMin) || d.tempoPreparoMin < 1) throw new ValidationError('O tempo de preparo deve ser um inteiro de minutos maior que zero');
  const resultado = {
    nome: validarNome(d.nome),
    codigo: textoOpcional(d.codigo, CODIGO_MAX, 'O código'),
    categoriaId: d.categoriaId,
    descricao: textoOpcional(d.descricao, DESCRICAO_MAX, 'A descrição'),
    precoCents: d.precoCents,
    tempoPreparoMin: d.tempoPreparoMin,
    ativo: booleano(d.ativo, 'ativo'),
  };
  if (body?.ingredientes !== undefined) resultado.ingredientes = validarIngredientes(body.ingredientes);
  else if (atual === PRATO_PADRAO) resultado.ingredientes = [];
  if (resultado.ingredientes && resultado.ingredientes.length === 0) throw new ValidationError('O prato precisa de pelo menos um ingrediente');
  return resultado;
}

module.exports = { validarPrato };
