import { api } from '../api.js';
import { esc, brl } from '../format.js';
import { icon } from '../icons.js';
import { view, fail } from '../ui.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';
import { norm } from '../components/cadastroAcoes.js';

const memory = { aba: 'pratos', q: '', filters: { pratos: {}, bebidas: {} } };

const disponivel = (item) => (item.ativo
  ? `<span class="tag ok">${icon('check')}Disponível</span>`
  : `<span class="tag bad">${icon('x')}Indisponível</span>`);
const OPCOES_DISP = [{ value: '', label: 'Todos' }, { value: 'sim', label: 'Disponíveis' }, { value: 'nao', label: 'Indisponíveis' }];

/** Cardápio (somente leitura): abas Pratos e Bebidas, busca por nome e filtros. Níveis A e B. */
export async function viewCardapio() {
  const { categorias, pratos, bebidas } = await api.get('/api/cardapio/completo');
  const nomeCategoria = (id) => categorias.find((c) => c.id === id)?.nome ?? '—';

  view().innerHTML = `<div class="seg-tabs" role="tablist" aria-label="Cardápio">
    <button type="button" role="tab" id="aba-pratos" data-aba="pratos">Pratos</button>
    <button type="button" role="tab" id="aba-bebidas" data-aba="bebidas">Bebidas</button></div><div id="cardapio-grid" role="tabpanel"></div>`;
  view().querySelectorAll('[data-aba]').forEach((b) => { b.onclick = () => { memory.aba = b.dataset.aba; memory.q = ''; mostrarAba(); }; });

  function mostrarAba() {
    const aba = memory.aba;
    view().querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
    document.getElementById('cardapio-grid').setAttribute('aria-labelledby', `aba-${aba}`);
    const filtros = () => memory.filters[aba];
    const ehPratos = aba === 'pratos';

    const colunas = ehPratos ? [
      { label: 'Nome', sort: (p) => p.nome, cell: (p) => `${esc(p.nome)}${p.descricao ? `<div class="cardapio-desc">${esc(p.descricao)}</div>` : ''}` },
      { label: 'Categoria', sort: (p) => nomeCategoria(p.categoriaId), cell: (p) => esc(nomeCategoria(p.categoriaId)) },
      { label: 'Valor', align: 'right', sort: (p) => p.precoCents, cell: (p) => esc(brl(p.precoCents)) },
      { label: 'Preparo', align: 'right', sort: (p) => p.tempoPreparoMin ?? 0, cell: (p) => (p.tempoPreparoMin ? `${p.tempoPreparoMin} min` : '—') },
      { label: 'Status', sort: (p) => (p.ativo ? 0 : 1), cell: disponivel },
    ] : [
      { label: 'Nome', sort: (b) => b.nome, cell: (b) => esc(b.nome) },
      { label: 'Valor', align: 'right', sort: (b) => b.precoCents, cell: (b) => esc(brl(b.precoCents)) },
      { label: 'Estoque', align: 'right', sort: (b) => b.estoqueQtd, cell: (b) => `${b.estoqueQtd}${b.critico ? ' <span class="tag bad">Estoque baixo</span>' : ''}` },
      { label: 'Status', sort: (b) => (b.ativo ? 0 : 1), cell: disponivel },
    ];

    const grid = createGrid(document.getElementById('cardapio-grid'), {
      search: memory.q,
      searchPlaceholder: 'Pesquisar por nome…',
      columns: colunas,
      onSearch: (q) => { memory.q = q; apply(); },
      onFilters: () => openFilterDialog({
        title: `Filtros — ${aba}`,
        fields: [
          { name: 'disp', label: 'Disponibilidade', type: 'select', options: OPCOES_DISP },
          ehPratos
            ? { name: 'categoria', label: 'Categoria', type: 'select', options: [{ value: '', label: 'Todas' }, ...categorias.map((c) => ({ value: c.id, label: c.nome }))] }
            : { name: 'baixo', label: 'Estoque', type: 'select', options: [{ value: '', label: 'Todos' }, { value: 'sim', label: 'Somente estoque baixo' }] },
        ],
        values: filtros(),
        onApply: (values) => { memory.filters[aba] = values; apply(); },
      }),
      emptyText: ehPratos ? 'Nenhum prato encontrado.' : 'Nenhuma bebida encontrada.',
    });

    function apply() {
      const f = filtros();
      const base = ehPratos ? pratos : bebidas;
      const rows = base.filter((i) => norm(i.nome).includes(norm(memory.q))
        && (!f.disp || (f.disp === 'sim') === i.ativo)
        && (!f.categoria || String(i.categoriaId) === String(f.categoria))
        && (!f.baixo || i.critico));
      const rotulos = [f.disp && (f.disp === 'sim' ? 'Disponíveis' : 'Indisponíveis'), f.categoria && `Categoria: ${nomeCategoria(Number(f.categoria))}`, f.baixo && 'Estoque baixo'].filter(Boolean);
      grid.setRows(rows, rotulos.join(' · '));
      grid.setFilterCount(Object.keys(f).length);
    }
    apply();
  }
  mostrarAba();
}
