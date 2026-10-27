import { api } from '../api.js';
import { brl, esc } from '../format.js';
import { view, notify, fail, confirmDialog } from '../ui.js';
import { reenviarAviso } from './reenviarAviso.js';

const ROTULOS = {
  ABERTO: 'Rascunho', RECEBIDO: 'Recebido', EM_PREPARO: 'Em preparo', PRONTO_RETIRADA: 'Pronto (retirada)',
  PRONTO_ENTREGA: 'Pronto (entrega)', FINALIZADO: 'Finalizado', CANCELADO: 'Cancelado',
};
const CLASSE = { FINALIZADO: 'ok', CANCELADO: 'bad', ABERTO: '' };
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

let ouvinte = null; // um único ouvinte de eventos, mesmo com recarregamentos da tela

/** Pedidos de hoje (A e B): acompanhar, finalizar o que está pronto, confirmar rascunhos e cancelar. */
export async function viewPedidos() {
  const lista = await api.get('/api/pedidos');
  const recarregar = () => viewPedidos().catch(fail);
  if (ouvinte) window.removeEventListener('pdv:evento', ouvinte);
  ouvinte = (e) => {
    if (!document.getElementById('pedidos-tela')) { window.removeEventListener('pdv:evento', ouvinte); ouvinte = null; return; }
    if (e.detail.tipo === 'pedido' || e.detail.tipo === 'cozinha') recarregar();
  };
  window.addEventListener('pdv:evento', ouvinte);

  const acoes = (p) => {
    const b = [];
    if (p.status === 'ABERTO') b.push(['confirmar', 'Confirmar']);
    if (p.status === 'PRONTO_RETIRADA' || p.status === 'PRONTO_ENTREGA') b.push(['finalizar', 'Finalizar']);
    if (p.status.startsWith('PRONTO')) b.push(['reenviar', 'Reenviar WhatsApp']);
    if (!['FINALIZADO', 'CANCELADO'].includes(p.status)) b.push(['cancelar', 'Cancelar', true]);
    return b.map(([a, rotulo, perigo]) => `<button type="button" class="btn alt sm${perigo ? ' danger-text' : ''}" data-a="${a}" data-id="${p.id}">${rotulo}</button>`).join(' ');
  };

  view().innerHTML = `<div class="card" id="pedidos-tela"><h2>Pedidos de hoje</h2>
    ${lista.length ? `<table class="grid"><thead><tr><th>Senha</th><th>Hora</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Situação</th><th></th></tr></thead><tbody>
    ${[...lista].reverse().map((p) => `<tr><td><b>${p.senha ?? '—'}</b></td><td>${hora(p.criadoEm)}</td><td>${esc(p.cliente?.nome ?? '—')}</td>
      <td>${esc(p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', '))}</td><td>${brl(p.totalCents)}</td>
      <td><span class="tag ${CLASSE[p.status] ?? 'info'}">${ROTULOS[p.status] ?? p.status}</span></td><td>${acoes(p)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="coming">Nenhum pedido hoje.</p>'}</div>`;

  view().onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = Number(b.dataset.id);
    try {
      if (b.dataset.a === 'confirmar') await api.post(`/api/pedidos/${id}/confirmar`);
      if (b.dataset.a === 'finalizar') await api.post(`/api/pedidos/${id}/status`, { status: 'FINALIZADO' });
      if (b.dataset.a === 'reenviar') { await reenviarAviso(b); return; }
      if (b.dataset.a === 'cancelar') {
        if (!await confirmDialog({ title: 'Cancelar pedido', message: `Cancelar o pedido nº ${id}?`, confirmLabel: 'Cancelar pedido', danger: true })) return;
        await api.post(`/api/pedidos/${id}/cancelar`, { motivo: 'Cancelado pelo atendente' });
      }
      notify('Pedido atualizado');
      await recarregar();
    } catch (error) { fail(error); }
  };
}
