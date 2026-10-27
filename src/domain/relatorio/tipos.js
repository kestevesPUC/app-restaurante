'use strict';
const ValidationError = require('../errors/ValidationError');

const AGRUPAMENTOS = ['dia', 'mes', 'ano'];
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 200;

const col = (chave, titulo, tipo) => ({ chave, titulo, tipo });
const PERIODO = ['de', 'ate'];
const RANKING = ['de', 'ate', 'limite'];

const COLS_PEDIDO = [col('numero', 'Nº', 'inteiro'), col('dataHora', 'Data/hora', 'data'), col('cliente', 'Cliente', 'texto'),
  col('telefone', 'Telefone', 'telefone'), col('itens', 'Itens', 'inteiro'), col('totalCents', 'Total', 'dinheiro'), col('status', 'Status', 'texto')];
const COLS_VENDAS = [col('quantidade', 'Pedidos', 'inteiro'), col('faturamentoCents', 'Faturamento', 'dinheiro'), col('ticketMedioCents', 'Ticket médio', 'dinheiro')];
const COLS_CLIENTE = [col('cliente', 'Cliente', 'texto'), col('telefone', 'Telefone', 'telefone'), col('quantidade', 'Pedidos', 'inteiro'), col('gastoCents', 'Gasto', 'dinheiro')];
const COLS_ESTOQUE = [col('bebida', 'Bebida', 'texto'), col('saldo', 'Saldo', 'inteiro'), col('minimo', 'Mínimo', 'inteiro'), col('situacao', 'Situação', 'texto')];

/** Catálogo dos relatórios: chave, título, filtros aceitos e colunas tipadas. */
const TIPOS = Object.freeze([
  { tipo: 'pedidos-periodo', titulo: 'Pedidos por período', filtros: PERIODO, colunas: COLS_PEDIDO },
  { tipo: 'pedidos-finalizados', titulo: 'Pedidos finalizados', filtros: PERIODO,
    colunas: [col('numero', 'Nº', 'inteiro'), col('finalizadoEm', 'Finalizado em', 'data'), col('cliente', 'Cliente', 'texto'),
      col('telefone', 'Telefone', 'telefone'), col('itens', 'Itens', 'inteiro'), col('totalCents', 'Total', 'dinheiro')] },
  { tipo: 'pedidos-cancelados', titulo: 'Pedidos cancelados', filtros: PERIODO,
    colunas: [col('numero', 'Nº', 'inteiro'), col('canceladoEm', 'Cancelado em', 'data'), col('cliente', 'Cliente', 'texto'),
      col('telefone', 'Telefone', 'telefone'), col('totalCents', 'Total', 'dinheiro'), col('motivo', 'Motivo', 'texto')] },
  { tipo: 'tempo-medio-preparo', titulo: 'Tempo médio de preparo', filtros: PERIODO,
    colunas: [col('numero', 'Nº', 'inteiro'), col('cliente', 'Cliente', 'texto'), col('inicioPreparo', 'Início do preparo', 'data'),
      col('prontoEm', 'Pronto em', 'data'), col('duracaoSegundos', 'Duração', 'duracao')] },
  { tipo: 'faturamento', titulo: 'Faturamento', filtros: [...PERIODO, 'agrupar'], colunas: [col('periodo', 'Período', 'data'), ...COLS_VENDAS] },
  { tipo: 'ticket-medio', titulo: 'Ticket médio', filtros: PERIODO, colunas: COLS_VENDAS },
  { tipo: 'bebidas-mais-vendidas', titulo: 'Bebidas mais vendidas', filtros: RANKING,
    colunas: [col('bebida', 'Bebida', 'texto'), col('quantidade', 'Quantidade', 'inteiro'), col('totalCents', 'Total', 'dinheiro')] },
  { tipo: 'estoque-atual', titulo: 'Estoque atual', filtros: [], colunas: COLS_ESTOQUE },
  { tipo: 'estoque-critico', titulo: 'Estoque crítico', filtros: [], colunas: COLS_ESTOQUE },
  { tipo: 'clientes-frequentes', titulo: 'Clientes mais frequentes', filtros: RANKING, colunas: COLS_CLIENTE },
  { tipo: 'clientes-maior-gasto', titulo: 'Clientes com maior gasto', filtros: RANKING, colunas: COLS_CLIENTE },
]);

function obterTipo(tipo) {
  return TIPOS.find((t) => t.tipo === tipo);
}

function validarAgrupar(valor) {
  if (valor === undefined || valor === null) return 'dia';
  if (!AGRUPAMENTOS.includes(valor)) throw new ValidationError('Agrupamento inválido: use dia, mes ou ano');
  return valor;
}

function validarLimite(valor) {
  if (valor === undefined || valor === null) return LIMITE_PADRAO;
  if (!Number.isSafeInteger(valor) || valor < 1 || valor > LIMITE_MAXIMO) throw new ValidationError(`O limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO}`);
  return valor;
}

/** Ticket médio em centavos inteiros (0 sem pedidos). */
function ticketMedio(faturamentoCents, quantidade) {
  return quantidade > 0 ? Math.round(faturamentoCents / quantidade) : 0;
}

module.exports = { TIPOS, AGRUPAMENTOS, LIMITE_MAXIMO, obterTipo, validarAgrupar, validarLimite, ticketMedio };
