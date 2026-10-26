import { view } from '../ui.js';
import { NIVEIS } from '../niveis.js';
import { api } from '../api.js';
import { renderCreditos } from '../components/creditos.js';
import { esc } from '../format.js';

/** Tela "Sobre": identificação do sistema e dos níveis de acesso. */
export async function viewSobre() {
  const sistema = await api.get('/api/sistema').catch(() => ({ nome: 'PDV Restaurante', versao: '' }));
  view().innerHTML = `<div class="card"><h2>${esc(sistema.nome)}</h2>
    <dl class="detail"><dt>Versão</dt><dd>${esc(sistema.versao || '—')}</dd><dt>Sistema</dt><dd>Pedidos, cozinha (andon) e pagamentos para restaurante.</dd>
    <dt>Dados</dt><dd>Gravados neste computador (SQLite).</dd><dt>Desenvolvimento</dt><dd>${renderCreditos()}</dd></dl>
    <h3>Níveis de acesso</h3>
    <dl class="niveis">${NIVEIS.map((n) => `<dt>${n.id} — ${esc(n.nome)}</dt><dd>${esc(n.descricao)}</dd>`).join('')}</dl></div>`;
}
