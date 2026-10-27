import { api } from '../api.js';
import { esc } from '../format.js';
import { view, notify, fail } from '../ui.js';
import { reenviarAviso } from './reenviarAviso.js';
import { state } from '../state.js';

const COLUNAS = [
  { status: ['RECEBIDO'], titulo: 'Novos' },
  { status: ['EM_PREPARO'], titulo: 'Em preparo' },
  { status: ['PRONTO_RETIRADA', 'PRONTO_ENTREGA'], titulo: 'Prontos' },
];
const minutos = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

let ouvinte = null; // um único ouvinte de eventos, mesmo com recarregamentos da tela

/** Botões do cartão conforme o status e o nível (B acompanha, mas só A e C mexem na cozinha). */
function botoes(p, nivel) {
  const b = (status, rotulo, alt = false) => `<button type="button" class="btn${alt ? ' alt' : ''} sm" data-id="${p.id}" data-status="${status}">${rotulo}</button>`;
  const reenviar = nivel !== 'C' && p.status.startsWith('PRONTO')
    ? ` <button type="button" class="btn alt sm" data-id="${p.id}" data-reenviar="1">Reenviar WhatsApp</button>` : '';
  if (nivel === 'B') return p.status.startsWith('PRONTO') ? `${b('FINALIZADO', 'Finalizar')}${reenviar}` : '';
  if (p.status === 'RECEBIDO') return b('EM_PREPARO', 'Iniciar preparo');
  if (p.status === 'EM_PREPARO') return `${b('PRONTO_RETIRADA', 'Pronto — retirada')} ${b('PRONTO_ENTREGA', 'Pronto — entrega', true)}`;
  return `${b('FINALIZADO', 'Finalizar')} ${b('EM_PREPARO', 'Voltar ao preparo', true)}${reenviar}`;
}

function cartao(p, nivel) {
  const itens = p.itens.map((i) => `<li><b>${i.quantidade}× ${esc(i.nome)}</b>
    ${(i.modificacoes || []).map((m) => `<small>${m.tipo === 'REMOVER' ? 'SEM' : `+${m.quantidade}`} ${esc(m.ingredienteNome)}</small>`).join('')}
    ${i.observacao ? `<small>Obs.: ${esc(i.observacao)}</small>` : ''}</li>`).join('');
  return `<article class="andon-card"><header><b>Senha ${p.senha ?? p.id}</b><span>${esc(p.cliente?.nome ?? '')}</span><small>${minutos(p.confirmadoEm)} min</small></header>
    <ul>${itens}</ul>${p.observacao ? `<p><small>Obs.: ${esc(p.observacao)}</small></p>` : ''}<div class="cart-ctl">${botoes(p, nivel)}</div></article>`;
}

/** Andon da cozinha: pedidos confirmados por etapa; ao marcar "Pronto" o sistema avisa o cliente pelo WhatsApp. */
export async function viewAndon() {
  const pedidos = await api.get('/api/cozinha');
  const nivel = state.me.nivel;
  const recarregar = () => viewAndon().catch(fail);
  if (ouvinte) window.removeEventListener('pdv:evento', ouvinte);
  ouvinte = (e) => {
    if (!document.getElementById('andon-tela')) { window.removeEventListener('pdv:evento', ouvinte); ouvinte = null; return; }
    if (['pedido', 'cozinha'].includes(e.detail.tipo)) recarregar();
  };
  window.addEventListener('pdv:evento', ouvinte);

  view().innerHTML = `<div class="andon" id="andon-tela">${COLUNAS.map((c) => {
    const lista = pedidos.filter((p) => c.status.includes(p.status));
    return `<section class="card"><h2>${c.titulo} (${lista.length})</h2>${lista.map((p) => cartao(p, nivel)).join('') || '<p class="coming">Nenhum pedido.</p>'}</section>`;
  }).join('')}</div>`;

  view().onclick = async (e) => {
    const re = e.target.closest('[data-reenviar]');
    if (re) { await reenviarAviso(re); return; }
    const b = e.target.closest('[data-status]');
    if (!b) return;
    b.disabled = true;
    try {
      await api.post(`/api/pedidos/${b.dataset.id}/status`, { status: b.dataset.status });
      notify(b.dataset.status.startsWith('PRONTO') ? 'Pedido pronto — o cliente será avisado pelo WhatsApp' : 'Pedido atualizado');
      await recarregar();
    } catch (error) { b.disabled = false; fail(error); }
  };
}
