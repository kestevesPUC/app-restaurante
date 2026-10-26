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
  { header: 'Nº', value: (p) => p.numeroDia, type: 'int' },
  { header: 'Data/hora', value: (p) => dataHora(p.criadoEm) },
  { header: 'Tipo', value: (p) => (p.tipo === 'MESA' ? 'Mesa' : 'Balcão') },
  { header: 'Mesa', value: (p) => p.mesa },
  { header: 'Cliente', value: (p) => p.clienteNome },
  { header: 'Itens', value: (p) => p.qtdItens, type: 'int' },
  { header: 'Total (R$)', value: (p) => p.totalCents / 100, type: 'money' },
  { header: 'Situação', value: (p) => p.situacao },
  { header: 'Forma de pagamento', value: (p) => p.forma },
  { header: 'Atendente', value: (p) => p.atendente },
];

/** Rotas de pedidos e da comanda da mesa. Níveis A/B (a cozinha, C, não acessa); desconto só A. */
class PedidoController {
  /** @param {import('../../../application/PedidoService')} service */
  constructor(service) {
    this.service = service;
    this.csv = new CsvWriter();
  }

  register(router) {
    const s = this.service;
    const id = (ctx) => idPositivo(ctx.params.id, 'O pedido');
    router.add('GET', '/api/pedidos', (ctx) => s.listarResumo(filtrosDePedidos(ctx.query)));
    router.add('GET', '/api/pedidos.csv', (ctx) => {
      const linhas = s.listarResumo(filtrosDePedidos(ctx.query));
      return FileResponse.csv('pedidos.csv', this.csv.build(COLUNAS_CSV, linhas));
    });
    router.add('GET', '/api/pedidos/:id', (ctx) => s.obter(id(ctx)));
    router.add('GET', '/api/mesas/:id/comanda', (ctx) => s.comandaDaMesa(idPositivo(ctx.params.id, 'A mesa')));
    router.add('POST', '/api/pedidos', (ctx) => s.criar(ctx.user, ctx.body));
    router.add('PUT', '/api/pedidos/:id', (ctx) => s.substituirPendentes(ctx.user, id(ctx), ctx.body));
    router.add('POST', '/api/pedidos/:id/itens', (ctx) => s.adicionarItens(ctx.user, id(ctx), ctx.body.itens));
    router.add('POST', '/api/pedidos/:id/enviar-cozinha', (ctx) => s.enviarCozinha(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/itens/:itemId/cancelar',
      (ctx) => s.cancelarItem(ctx.user, id(ctx), idPositivo(ctx.params.itemId, 'O item'), ctx.body.motivo));
    router.add('POST', '/api/pedidos/:id/mover', (ctx) => s.mover(ctx.user, id(ctx), ctx.body.mesaId));
    router.add('POST', '/api/pedidos/:id/finalizar', (ctx) => s.finalizar(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/reabrir', (ctx) => s.reabrir(ctx.user, id(ctx)));
    router.add('POST', '/api/pedidos/:id/desconto', (ctx) => s.aplicarDesconto(ctx.user, id(ctx), ctx.body.descontoCents), { nivel: 'A' });
    router.add('POST', '/api/pedidos/:id/cancelar', (ctx) => s.cancelar(ctx.user, id(ctx), ctx.body.motivo));
  }
}

module.exports = PedidoController;
