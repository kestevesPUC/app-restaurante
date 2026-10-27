'use strict';
const NotFoundError = require('../domain/errors/NotFoundError');
const ValidationError = require('../domain/errors/ValidationError');
const ForbiddenError = require('../domain/errors/ForbiddenError');
const { STATUS } = require('../domain/pedido/status');
const { estimarPreparo } = require('../domain/pedido/estimativa');

const LIMITE_LISTA = 1000;
const DA_COZINHA = ['RECEBIDO', 'EM_PREPARO', 'PRONTO_RETIRADA', 'PRONTO_ENTREGA'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data local AAAA-MM-DD do instante `ms`. */
function dataLocalDe(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Dígitos do telefone NACIONAL procurados por `q` (o prefixo 55 do termo é ignorado quando há mais de 2 dígitos). */
function digitosDeTelefone(termo) {
  if (!/^[\d\s()+-]+$/.test(termo)) return null;
  let digitos = termo.replace(/\D/g, '');
  if (digitos.length > 2 && digitos.startsWith('55')) digitos = digitos.slice(2);
  return digitos || null;
}

function exigirNivel(user, niveis) {
  if (!user || !niveis.includes(user.nivel)) throw new ForbiddenError('Sem permissão para consultar pedidos');
}

/** Leitura de pedidos no formato `Pedido` (listagens, detalhe, fila da cozinha). */
class ConsultaDePedidos {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/PedidoRepository')} deps.repository
   * @param {import('./ConfigService')} deps.config
   * @param {() => number} deps.relogio
   */
  constructor({ repository, config, relogio }) {
    Object.assign(this, { repository, config, relogio });
  }

  /** Grade de pedidos: só A/B. */
  listar(user, { de, ate, status, q, limite } = {}) {
    exigirNivel(user, ['A', 'B']);
    const hoje = dataLocalDe(this.relogio());
    const inicio = de || hoje;
    const fim = ate || de || hoje;
    if (!DATA.test(inicio) || !DATA.test(fim)) throw new ValidationError('As datas devem estar no formato AAAA-MM-DD');
    if (status !== undefined && status !== null && status !== '' && !STATUS.includes(status)) throw new ValidationError('Status inválido');
    const max = limite ?? LIMITE_LISTA;
    if (!Number.isSafeInteger(max) || max < 1 || max > LIMITE_LISTA) throw new ValidationError(`O limite deve ser um inteiro entre 1 e ${LIMITE_LISTA}`);
    const termo = typeof q === 'string' ? q.trim() : '';
    const linhas = this.repository.listar({ de: inicio, ate: fim, status: status || null, q: termo, digitos: termo ? digitosDeTelefone(termo) : null, limite: max });
    return this.montar(linhas);
  }

  /** A/B: qualquer pedido; C: só pedidos ativos na cozinha. */
  obter(user, id) {
    exigirNivel(user, ['A', 'B', 'C']);
    const pedido = this.carregar(id);
    if (user.nivel === 'C' && !DA_COZINHA.includes(pedido.status)) throw new ForbiddenError('A cozinha só consulta pedidos em andamento');
    return pedido;
  }

  /** Fila da cozinha: A, B ou C. */
  listarCozinha(user) {
    exigirNivel(user, ['A', 'B', 'C']);
    return this.montar(this.repository.listarCozinha());
  }

  /** Uso interno do serviço (sem autorização): pedido completo ou 404. */
  carregar(id) {
    const linha = this.repository.findById(Number(id));
    if (!linha) throw new NotFoundError('Pedido não encontrado');
    return this.montar([linha])[0];
  }

  /** Converte linhas de `pedidos` em `Pedido` (itens e histórico em lote). */
  montar(linhas) {
    const ids = linhas.map((l) => l.id);
    const itens = this.repository.itensDe(ids);
    const historico = this.repository.historicoDe(ids);
    const modo = this.config.get('cozinha.estimativa');
    return linhas.map((l) => this.#pedido(l, itens.get(l.id), historico.get(l.id), modo));
  }

  #pedido(l, itens, historico, modo) {
    const temCliente = l.clienteNome !== null || l.clienteTelefone !== null;
    return {
      id: l.id,
      senha: l.senha,
      status: l.status,
      cliente: temCliente ? { id: l.clienteId, nome: l.clienteNome, telefone: l.clienteTelefone } : null,
      itens,
      subtotalCents: l.subtotalCents,
      totalCents: l.totalCents,
      quantidadeTotal: itens.reduce((soma, i) => soma + i.quantidade, 0),
      tempoEstimadoMin: l.status === 'ABERTO' ? estimarPreparo(itens, modo) : l.tempoEstimadoMin,
      observacao: l.observacao,
      dataLocal: l.dataLocal,
      criadoEm: l.criadoEm,
      confirmadoEm: l.confirmadoEm,
      criadoPor: l.criadoPor,
      canceladoEm: l.canceladoEm,
      canceladoPor: l.canceladoPor,
      motivoCancelamento: l.motivoCancelamento,
      historico,
    };
  }
}

module.exports = ConsultaDePedidos;
module.exports.dataLocalDe = dataLocalDe;
