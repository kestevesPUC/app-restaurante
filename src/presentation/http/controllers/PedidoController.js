'use strict';
const FileResponse = require('../FileResponse');
const CsvWriter = require('../../../infrastructure/csv/CsvWriter');
const ValidationError = require('../../../domain/errors/ValidationError');
const { STATUS } = require('../../../domain/pedido/status');
const { idPositivo, filtrosDePedidos } = require('../validacaoHttp');

const ITENS_MAX = 100;
const id = (ctx) => idPositivo(ctx.params.id, 'O pedido');

function limitarItens(body) {
  if (Array.isArray(body.itens) && body.itens.length > ITENS_MAX) throw new ValidationError(`O pedido aceita no máximo ${ITENS_MAX} itens`);
}

const pad = (n) => String(n).padStart(2, '0');
const data = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const hora = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const COLUNAS_CSV = [
  { header: 'Nº', value: (p) => p.id, type: 'int' },
  { header: 'Data', value: (p) => data(p.criadoEm) },
  { header: 'Hora', value: (p) => hora(p.criadoEm) },
  { header: 'Cliente', value: (p) => p.cliente?.nome ?? null },
  { header: 'Telefone', value: (p) => p.cliente?.telefone ?? null },
  { header: 'Itens', value: (p) => p.quantidadeTotal, type: 'int' },
  { header: 'Total (R$)', value: (p) => p.totalCents / 100, type: 'money' },
  { header: 'Tempo estimado (min)', value: (p) => p.tempoEstimadoMin, type: 'int' },
  { header: 'Status', value: (p) => p.status },
];

/**
 * API de pedidos. A autorização por nível fica no serviço; aqui só `cozinha: true` onde o nível C pode chegar
 * (status e fila da cozinha). Escritas respondem 200 com o `Pedido` completo.
 */
class PedidoController {
  /** @param {import('../../../application/PedidoService')} service */
  constructor(service) {
    this.service = service;
    this.csv = new CsvWriter();
  }

  register(router) {
    const s = this.service;
    router.add('GET', '/api/pedidos', (ctx) => s.listar(ctx.user, filtrosDePedidos(ctx.query)));
    router.add('GET', '/api/pedidos.csv',
      (ctx) => FileResponse.csv('pedidos.csv', this.csv.build(COLUNAS_CSV, s.listar(ctx.user, filtrosDePedidos(ctx.query)))));
    router.add('GET', '/api/pedidos/:id', (ctx) => s.obter(ctx.user, idPositivo(ctx.params.id, 'O pedido')));
    router.add('POST', '/api/pedidos', (ctx) => {
      if (!Array.isArray(ctx.body.itens)) throw new ValidationError('Os itens devem ser uma lista');
      limitarItens(ctx.body);
      return s.criarRascunho(ctx.user, ctx.body);
    });
    router.add('PUT', '/api/pedidos/:id', (ctx) => {
      const numero = id(ctx);
      limitarItens(ctx.body);
      return s.atualizarRascunho(ctx.user, numero, ctx.body);
    });
    router.add('POST', '/api/pedidos/:id/confirmar', (ctx) => s.confirmar(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/reabrir', (ctx) => s.reabrir(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/cancelar', (ctx) => s.cancelar(ctx.user, id(ctx), ctx.body.motivo));
    router.add('POST', '/api/pedidos/:id/status', (ctx) => {
      const numero = id(ctx);
      if (typeof ctx.body.status !== 'string' || !STATUS.includes(ctx.body.status)) throw new ValidationError('Status inválido');
      return s.mudarStatus(ctx.user, numero, ctx.body.status);
    }, { cozinha: true });
    router.add('GET', '/api/cozinha', (ctx) => s.listarCozinha(ctx.user), { cozinha: true });
  }
}

module.exports = PedidoController;
