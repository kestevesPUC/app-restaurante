'use strict';
const FileResponse = require('../FileResponse');
const CsvWriter = require('../../../infrastructure/csv/CsvWriter');
const { idPositivo, filtrosDePedidos } = require('../validacaoHttp');

const pad = (n) => String(n).padStart(2, '0');
function dataHora(iso) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const COLUNAS_CSV = [
  { header: 'Nº', value: (p) => p.id, type: 'int' },
  { header: 'Data/hora', value: (p) => dataHora(p.criadoEm) },
  { header: 'Cliente', value: (p) => p.cliente?.nome ?? null },
  { header: 'Telefone', value: (p) => p.cliente?.telefone ?? null },
  { header: 'Itens', value: (p) => p.quantidadeTotal, type: 'int' },
  { header: 'Total (R$)', value: (p) => p.totalCents / 100, type: 'money' },
  { header: 'Status', value: (p) => p.status },
];

/** Consulta de pedidos (níveis A/B; a cozinha, C, é barrada pelo HttpServer). As rotas de escrita são reconstruídas na Tarefa 6. */
class PedidoController {
  /** @param {import('../../../application/PedidoService')} service */
  constructor(service) {
    this.service = service;
    this.csv = new CsvWriter();
  }

  register(router) {
    const s = this.service;
    router.add('GET', '/api/pedidos', (ctx) => s.listar(filtrosDePedidos(ctx.query)));
    router.add('GET', '/api/pedidos.csv',
      (ctx) => FileResponse.csv('pedidos.csv', this.csv.build(COLUNAS_CSV, s.listar(filtrosDePedidos(ctx.query)))));
    router.add('GET', '/api/pedidos/:id', (ctx) => s.obter(idPositivo(ctx.params.id, 'O pedido')));
  }
}

module.exports = PedidoController;
