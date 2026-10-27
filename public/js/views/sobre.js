import { view } from '../ui.js';
import { NIVEIS } from '../niveis.js';
import { esc } from '../format.js';

/** Tela "Sobre": identificação do sistema e dos níveis de acesso. */
export async function viewSobre() {
  view().innerHTML = `<div class="card"><h2>PDV Restaurante</h2>
    <dl class="detail"><dt>Sistema</dt><dd>Pedidos, cozinha (andon) e pagamentos para restaurante.</dd>
    <dt>Dados</dt><dd>Gravados neste computador (SQLite).</dd>
    <dt>Desenvolvedor</dt><dd><a class="credito" href="https://kaio-gomes-site.vercel.app" target="_blank" rel="noopener noreferrer">Desenvolvido por Kaio Gomes</a></dd></dl>
    <h3>Níveis de acesso</h3>
    <dl class="niveis">${NIVEIS.map((n) => `<dt>${n.id} — ${esc(n.nome)}</dt><dd>${esc(n.descricao)}</dd>`).join('')}</dl></div>`;
}
