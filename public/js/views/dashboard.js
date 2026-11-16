import { api, queryString } from '../api.js';
import { brl, esc, dataBr } from '../format.js';
import { view, notify, fail } from '../ui.js';

const DIA_MS = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const data = (texto) => { const [a, m, d] = texto.split('-').map(Number); return new Date(a, m - 1, d); };
const somar = (texto, n) => { const d = data(texto); d.setDate(d.getDate() + n); return iso(d); };
const diasEntre = (de, ate) => Math.round((data(ate) - data(de)) / DIA_MS) + 1;
const inteiro = (n) => Number(n).toLocaleString('pt-BR');
const curto = (iso_) => iso_.slice(8) + '/' + iso_.slice(5, 7);

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONES = {
  pedidos: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  faturamento: svg('<path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3.2c0 5 10 2.600 10 7.600 0 2.100-2.200 3.200-5 3.200s-5-1.100-5-3"/>'),
  ticket: svg('<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2.500"/>'),
  itens: svg('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
};

const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['custom', 'Personalizado']];
const memoria = { periodo: 'mes', metrica: 'faturamentoCents', ordem: 'quantidade', todos: false };

/** Variação percentual contra o período anterior (null quando não há base de comparação). */
function variacao(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}
function selo(atual, anterior) {
  const v = variacao(atual, anterior);
  if (v === null) return '<small class="delta neutro">sem base de comparação</small>';
  const cls = v > 0.05 ? 'sobe' : v < -0.05 ? 'desce' : 'neutro';
  const seta = cls === 'sobe' ? '▲' : cls === 'desce' ? '▼' : '•';
  return `<small class="delta ${cls}">${seta} ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% <span>vs. período anterior</span></small>`;
}
const kpi = (icone, rotulo, valor, delta) => `<div class="kpi"><span class="kpi-ico">${ICONES[icone]}</span>
  <div><span class="kpi-rot">${rotulo}</span><b>${valor}</b>${delta}</div></div>`;

/** Teto "redondo" do eixo (1, 2, 2,5, 5 × 10ⁿ). */
function teto(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= max);
}

/** Dashboard de vendas (nível A): o que mais vendeu, nº de pedidos e faturamento, com filtros. */
export async function viewDashboard() {
  const hoje = iso(new Date());
  const inicioMes = hoje.slice(0, 8) + '01';
  const intervalo = (p) => (p === 'hoje' ? [hoje, hoje] : p === 'mes' ? [inicioMes, hoje] : [somar(hoje, 1 - Number(p)), hoje]);
  if (memoria.periodo === 'custom') memoria.periodo = 'mes';
  const [de0, ate0] = intervalo(memoria.periodo);

  view().innerHTML = `<div class="dash">
    <form id="dash-form" class="card dash-filtros">
      <div class="seg" role="group" aria-label="Período">${PERIODOS.map(([id, r]) => `<button type="button" data-periodo="${id}">${r}</button>`).join('')}</div>
      <div class="dash-campos">
        <label>De<input type="date" name="de" value="${de0}"></label>
        <label>Até<input type="date" name="ate" value="${ate0}"></label>
        <label>Tipo<select name="tipo"><option value="">Pratos e bebidas</option><option value="PRATO">Só pratos</option><option value="BEBIDA">Só bebidas</option></select></label>
        <label>Categoria<select name="categoriaId"><option value="">Todas</option></select></label>
        <div class="dash-pick-wrap"><span class="dash-pick-rot">Itens</span>
          <details class="dash-pick"><summary id="pick-resumo">Todos os itens</summary>
            <div class="dash-pick-pop"><input type="search" id="pick-busca" placeholder="Buscar prato ou bebida…" aria-label="Buscar item">
              <div id="pick-lista" class="dash-pick-lista"></div></div></details></div>
        <button type="button" class="btn alt" id="dash-limpar">Limpar filtros</button>
      </div>
    </form>
    <div id="dash-out" aria-live="polite"><p class="coming">Carregando…</p></div></div>`;

  const form = document.getElementById('dash-form');
  const out = document.getElementById('dash-out');
  const pick = form.querySelector('.dash-pick');
  const lista = document.getElementById('pick-lista');
  let catalogoPronto = false;
  let ultimo = null;
  let pedido = 0;

  const marcarPeriodo = () => form.querySelectorAll('[data-periodo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodo === memoria.periodo)));
  const itensMarcados = () => [...lista.querySelectorAll('input:checked')].map((i) => i.value);
  const resumirItens = () => {
    const n = itensMarcados().length;
    document.getElementById('pick-resumo').textContent = n === 0 ? 'Todos os itens' : n === 1 ? '1 item selecionado' : `${n} itens selecionados`;
  };

  const preencherCatalogo = (c) => {
    form.categoriaId.insertAdjacentHTML('beforeend', c.categorias.map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join(''));
    const grupo = (titulo, tipo, itens) => (itens.length
      ? `<div class="dash-pick-grupo">${titulo}</div>${itens.map((x) => `<label><input type="checkbox" value="${tipo}:${x.id}"><span>${esc(x.nome)}</span></label>`).join('')}` : '');
    lista.innerHTML = grupo('Pratos', 'PRATO', c.pratos) + grupo('Bebidas', 'BEBIDA', c.bebidas) || '<p class="grid-info">Nenhum item cadastrado.</p>';
    catalogoPronto = true;
  };

  const buscar = (de, ate) => api.get(`/api/dashboard-vendas?${queryString({
    de, ate, tipo: form.tipo.value, categoriaId: form.categoriaId.value, itens: catalogoPronto ? itensMarcados().join(',') : '',
  })}`);

  const carregar = async () => {
    const meu = ++pedido;
    notify('');
    const de = form.de.value; const ate = form.ate.value;
    if (!de || !ate) return;
    if (de > ate) { notify('A data inicial não pode ser posterior à data final.', 'bad'); return; }
    try {
      const n = diasEntre(de, ate);
      const [atual, anterior] = await Promise.all([buscar(de, ate), buscar(somar(de, -n), somar(de, -1))]);
      if (meu !== pedido) return; // chegou uma resposta de um filtro antigo
      if (!catalogoPronto) preencherCatalogo(atual.catalogo);
      ultimo = { atual, anterior };
      desenhar();
    } catch (error) { if (meu === pedido) fail(error); }
  };

  function grafico(r) {
    const porDia = new Map(r.porDia.map((d) => [d.dia, d]));
    const dias = [];
    for (let d = r.periodo.de; d <= r.periodo.ate; d = somar(d, 1)) dias.push(porDia.get(d) ?? { dia: d, pedidos: 0, faturamentoCents: 0 });
    const dinheiro = memoria.metrica === 'faturamentoCents';
    const max = teto(Math.max(...dias.map((d) => d[memoria.metrica])) / (dinheiro ? 100 : 1)) * (dinheiro ? 100 : 1);
    const fmt = (v) => (dinheiro ? brl(v).replace(/,00$/, '') : inteiro(v));
    const passo = Math.ceil(dias.length / 10);
    const colunas = dias.map((d, i) => {
      const v = d[memoria.metrica];
      const dica = `${dataBr(d.dia)} · ${brl(d.faturamentoCents)} · ${d.pedidos} pedido${d.pedidos === 1 ? '' : 's'}`;
      return `<div class="col" data-dica="${dica}" title="${dica}"><i style="height:${(v / max) * 100}%"${v ? '' : ' class="zero"'}></i>
        <span>${i % passo === 0 ? curto(d.dia) : ''}</span></div>`;
    }).join('');
    const eixo = [1, 0.75, 0.5, 0.25, 0].map((f) => `<span>${fmt(max * f)}</span>`).join('');
    return `<div class="chart${dias.length > 45 ? ' denso' : ''}"><div class="chart-eixo">${eixo}</div><div class="chart-area">${colunas}</div></div>`;
  }

  function desenhar() {
    const { atual: r, anterior: a } = ultimo;
    const s = r.resumo; const p = a.resumo;
    const vazio = r.ranking.length === 0;
    const total = Math.max(1, r.ranking.reduce((t, l) => t + l.totalCents, 0));
    const ordenado = [...r.ranking].sort((x, y) => y[memoria.ordem] - x[memoria.ordem] || y.quantidade - x.quantidade);
    const maxOrdem = Math.max(1, ...ordenado.map((l) => l[memoria.ordem]));
    const visiveis = memoria.todos ? ordenado : ordenado.slice(0, 8);
    const seg = (grupo, valor, atualSel, rotulo) => `<button type="button" data-${grupo}="${valor}" aria-pressed="${valor === atualSel}">${rotulo}</button>`;

    const ranking = vazio ? '' : `<ol class="rank">${visiveis.map((l, i) => `<li>
        <span class="rank-pos${i < 3 ? ' top' : ''}">${i + 1}</span>
        <div class="rank-info"><div class="rank-nome"><b>${esc(l.nome)}</b><span class="chip">${esc(l.tipo === 'BEBIDA' ? 'Bebida' : l.categoria || 'Sem categoria')}</span></div>
          <span class="bar"><i style="width:${Math.max((l[memoria.ordem] / maxOrdem) * 100, 1.5)}%"></i></span></div>
        <div class="rank-num"><b>${inteiro(l.quantidade)} un.</b><small>${l.pedidos} pedido${l.pedidos === 1 ? '' : 's'}</small></div>
        <div class="rank-num"><b>${brl(l.totalCents)}</b><small>${((l.totalCents / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do total</small></div></li>`).join('')}</ol>
      ${ordenado.length > 8 ? `<button type="button" class="btn alt sm" id="dash-todos">${memoria.todos ? 'Mostrar só os 8 primeiros' : `Ver todos os ${ordenado.length} itens`}</button>` : ''}`;

    const totalCat = Math.max(1, r.porCategoria.reduce((t, c) => t + c.totalCents, 0));
    const categorias = r.porCategoria.map((c) => {
      const pct = (c.totalCents / totalCat) * 100;
      return `<li><div class="cat-top"><b>${esc(c.categoria)}</b><span>${brl(c.totalCents)}</span></div>
        <span class="bar"><i style="width:${Math.max(pct, 1.5)}%"></i></span>
        <small>${inteiro(c.quantidade)} un. · ${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small></li>`;
    }).join('');

    const n = diasEntre(r.periodo.de, r.periodo.ate);
    out.innerHTML = `
      <p class="dash-legenda">${r.periodo.de === r.periodo.ate ? dataBr(r.periodo.de) : `${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}`} · ${n} dia${n === 1 ? '' : 's'} · somente pedidos finalizados</p>
      <div class="kpis">
        ${kpi('pedidos', 'Pedidos', inteiro(s.pedidos), selo(s.pedidos, p.pedidos))}
        ${kpi('faturamento', 'Faturamento', brl(s.faturamentoCents), selo(s.faturamentoCents, p.faturamentoCents))}
        ${kpi('ticket', 'Ticket médio', brl(s.ticketMedioCents), selo(s.ticketMedioCents, p.ticketMedioCents))}
        ${kpi('itens', 'Itens vendidos', inteiro(s.itensVendidos), selo(s.itensVendidos, p.itensVendidos))}
      </div>
      ${vazio ? '<div class="card dash-vazio"><b>Nenhuma venda encontrada</b><p>Não há pedidos finalizados neste período com os filtros escolhidos. Tente ampliar o período ou limpar os filtros.</p></div>' : `
      <div class="dash-grid">
        <section class="card"><header class="dash-head"><h2>Evolução por dia</h2>
          <div class="seg sm">${seg('metrica', 'faturamentoCents', memoria.metrica, 'Faturamento')}${seg('metrica', 'pedidos', memoria.metrica, 'Pedidos')}</div></header>
          <p class="chart-dica" id="chart-dica">Passe o mouse sobre uma barra para ver o dia.</p>${grafico(r)}</section>
        <section class="card"><header class="dash-head"><h2>Por categoria</h2></header><ul class="cats">${categorias}</ul></section>
      </div>
      <section class="card"><header class="dash-head"><h2>Mais vendidos</h2>
        <div class="seg sm">${seg('ordem', 'quantidade', memoria.ordem, 'Por quantidade')}${seg('ordem', 'totalCents', memoria.ordem, 'Por faturamento')}</div></header>
        ${ranking}</section>`}`;
  }

  // Interações dentro do resultado (alternar métrica/ordem, expandir ranking, dica do gráfico).
  out.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.metrica) memoria.metrica = b.dataset.metrica;
    else if (b.dataset.ordem) memoria.ordem = b.dataset.ordem;
    else if (b.id === 'dash-todos') memoria.todos = !memoria.todos;
    else return;
    desenhar();
  });
  out.addEventListener('mouseover', (e) => {
    const col = e.target.closest('.col');
    const dica = document.getElementById('chart-dica');
    if (col && dica) dica.textContent = col.dataset.dica;
  });

  form.onsubmit = (e) => e.preventDefault();
  form.querySelectorAll('[data-periodo]').forEach((b) => {
    b.onclick = () => {
      memoria.periodo = b.dataset.periodo;
      marcarPeriodo();
      if (memoria.periodo === 'custom') { form.de.focus(); return; }
      [form.de.value, form.ate.value] = intervalo(memoria.periodo);
      carregar();
    };
  });
  for (const campo of [form.de, form.ate]) campo.onchange = () => { memoria.periodo = 'custom'; marcarPeriodo(); carregar(); };
  form.tipo.onchange = carregar;
  form.categoriaId.onchange = carregar;
  lista.onchange = () => { resumirItens(); carregar(); };
  document.getElementById('pick-busca').oninput = (e) => {
    const termo = e.target.value.trim().toLowerCase();
    lista.querySelectorAll('label').forEach((l) => { l.hidden = Boolean(termo) && !l.textContent.toLowerCase().includes(termo); });
  };
  const fecharPick = (e) => {
    if (!document.body.contains(pick)) { document.removeEventListener('click', fecharPick); return; }
    if (!pick.contains(e.target)) pick.open = false;
  };
  document.addEventListener('click', fecharPick);
  document.getElementById('dash-limpar').onclick = () => {
    form.tipo.value = ''; form.categoriaId.value = '';
    lista.querySelectorAll('input:checked').forEach((i) => { i.checked = false; });
    resumirItens();
    memoria.periodo = 'mes'; marcarPeriodo();
    [form.de.value, form.ate.value] = intervalo('mes');
    carregar();
  };

  marcarPeriodo();
  await carregar();
}
