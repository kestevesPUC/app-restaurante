import { api, queryString } from '../api.js';
import { brl, dataHora, esc } from '../format.js';
import { view, openDialog, fail } from '../ui.js';
import { createGrid } from '../components/grid.js';

const memory = { q: '' };
const ROTULOS = { RECEBIDO: 'Recebido', EM_PREPARO: 'Em preparo', PRONTO_RETIRADA: 'Pronto', PRONTO_ENTREGA: 'Pronto', FINALIZADO: 'Finalizado', CANCELADO: 'Cancelado' };
const telefone = (t) => (t || '').replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

/** Clientes cadastrados (nível A): busca por nome ou telefone e histórico de pedidos. */
export async function viewClientes() {
  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por nome ou telefone…',
    debounceMs: 250,
    columns: [
      { label: 'Nome', sort: (c) => c.nome, cell: (c) => esc(c.nome) },
      { label: 'Telefone', sort: (c) => c.telefone, cell: (c) => esc(telefone(c.telefone)) },
      { label: 'Pedidos', align: 'right', sort: (c) => c.qtdPedidos, cell: (c) => String(c.qtdPedidos) },
      { label: 'Total gasto', align: 'right', sort: (c) => c.totalGastoCents, cell: (c) => brl(c.totalGastoCents) },
    ],
    rowActions: () => [{ a: 'hist', label: 'Histórico' }],
    onSearch: (q) => { memory.q = q; carregar().catch(fail); },
    onAction: (_a, c) => historico(c).catch(fail),
    emptyText: 'Nenhum cliente encontrado.',
  });

  async function carregar() {
    const lista = await api.get(`/api/clientes?${queryString({ q: memory.q.trim(), limite: 200 })}`);
    grid.setRows(lista, memory.q.trim() ? '' : 'Mais recentes (pesquise para encontrar outros)');
  }
  await carregar();
}

async function historico(c) {
  const h = await api.get(`/api/clientes/${c.id}`);
  openDialog(`<h2>${esc(h.cliente.nome)}</h2>
    <dl class="detail"><dt>Telefone</dt><dd>${esc(telefone(h.cliente.telefone))}</dd><dt>Pedidos finalizados</dt><dd>${h.qtdPedidos}</dd>
    <dt>Total gasto</dt><dd>${brl(h.totalGastoCents)}</dd><dt>Última compra</dt><dd>${h.ultimaCompra ? dataHora(h.ultimaCompra) : '—'}</dd></dl>
    <h3>Últimos pedidos</h3>${h.ultimosPedidos.length ? `<table class="grid"><thead><tr><th>Quando</th><th>Itens</th><th>Total</th><th>Situação</th></tr></thead><tbody>
    ${h.ultimosPedidos.map((p) => `<tr><td>${dataHora(p.confirmadoEm)}</td><td>${p.quantidadeTotal}</td><td>${brl(p.totalCents)}</td><td>${ROTULOS[p.status] ?? esc(p.status)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="coming">Sem pedidos.</p>'}`,
  async () => {}, () => {}, { confirmLabel: 'Fechar', hideCancel: true });
}
