import { api, queryString } from '../api.js';
import { brl, dataHora, esc } from '../format.js';
import { view, notify, fail } from '../ui.js';
import { maskTelefone } from '../mask.js';

/** Data local de hoje (AAAA-MM-DD), a mesma usada pelo servidor. */
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const duracao = (s) => `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`;
const valor = (tipo, v) => {
  if (v === null || v === undefined) return '—';
  if (tipo === 'dinheiro') return brl(v);
  if (tipo === 'duracao') return duracao(v);
  if (tipo === 'telefone') return esc(maskTelefone(v));
  if (tipo === 'data') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : dataHora(v);
  return esc(String(v));
};
const alinha = (tipo) => (['inteiro', 'dinheiro', 'duracao'].includes(tipo) ? ' class="n"' : '');
const dataBr = (iso) => iso.split('-').reverse().join('/');

// Mantém o tipo escolhido ao navegar; o período volta a ser o dia de hoje a cada abertura.
const memory = { tipo: 'pedidos-finalizados' };

/** Relatórios (nível A): escolhe o tipo e o período (padrão: hoje), mostra na tela e exporta em Excel ou PDF. */
export async function viewRelatorios() {
  const tipos = await api.get('/api/relatorios');
  if (!tipos.some((t) => t.tipo === memory.tipo)) memory.tipo = tipos[0].tipo;
  const dia = hoje();

  view().innerHTML = `<div class="card"><form id="rel-form" class="row">
    <label>Relatório<select name="tipo">${tipos.map((t) => `<option value="${t.tipo}" ${t.tipo === memory.tipo ? 'selected' : ''}>${esc(t.titulo)}</option>`).join('')}</select></label>
    <label data-f="de">De<input type="date" name="de" value="${dia}"></label>
    <label data-f="ate">Até<input type="date" name="ate" value="${dia}"></label>
    <label data-f="agrupar">Agrupar por<select name="agrupar"><option value="dia">Dia</option><option value="mes">Mês</option><option value="ano">Ano</option></select></label>
    <label data-f="limite">Quantidade<input type="number" name="limite" min="1" max="200" value="20"></label>
    <button class="btn">Gerar</button></form>
    <div class="row" id="rel-export" hidden><a class="btn alt sm" id="rel-xlsx">Baixar Excel</a><a class="btn alt sm" id="rel-pdf">Baixar PDF</a></div>
    <div id="rel-out"></div></div>`;

  const form = document.getElementById('rel-form');
  const filtrosDe = () => tipos.find((t) => t.tipo === form.tipo.value).filtros;
  const mostrarCampos = () => {
    const f = filtrosDe();
    form.querySelectorAll('[data-f]').forEach((el) => { el.hidden = !f.includes(el.dataset.f); });
  };
  const params = () => {
    const f = filtrosDe();
    return Object.fromEntries(['de', 'ate', 'agrupar', 'limite'].filter((k) => f.includes(k)).map((k) => [k, form[k].value]));
  };
  form.tipo.onchange = () => { memory.tipo = form.tipo.value; mostrarCampos(); };
  mostrarCampos();

  form.onsubmit = async (event) => {
    event.preventDefault();
    notify('');
    try {
      const q = queryString(params());
      const r = await api.get(`/api/relatorios/${form.tipo.value}?${q}`);
      const base = `/api/relatorios/${form.tipo.value}?${q}${q ? '&' : ''}formato=`;
      document.getElementById('rel-xlsx').href = `${base}xlsx`;
      document.getElementById('rel-pdf').href = `${base}pdf`;
      document.getElementById('rel-export').hidden = false;
      const periodo = r.periodo ? ` — ${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}` : '';
      const totais = r.totais && Object.keys(r.totais).length
        ? `<p><b>Totais:</b> ${r.colunas.filter((c) => r.totais[c.chave] !== undefined).map((c) => `${esc(c.titulo)}: ${valor(c.tipo, r.totais[c.chave])}`).join(' · ')}</p>` : '';
      const tabela = r.linhas.length
        ? `<table class="grid"><thead><tr>${r.colunas.map((c) => `<th${alinha(c.tipo)}>${esc(c.titulo)}</th>`).join('')}</tr></thead><tbody>
          ${r.linhas.map((l) => `<tr>${r.colunas.map((c) => `<td${alinha(c.tipo)}>${valor(c.tipo, l[c.chave])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : '<p class="coming">Nenhum registro no período.</p>';
      document.getElementById('rel-out').innerHTML = `<h3>${esc(r.titulo)}${periodo}</h3>${totais}${tabela}`;
    } catch (error) { fail(error); }
  };
  form.requestSubmit();
}
