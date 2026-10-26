import { api } from '../api.js';
import { esc, brl } from '../format.js';
import { view, fail } from '../ui.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';
import { podeEditar, tagAtivo, norm, acoesDeLinha, executarAcao } from '../components/cadastroAcoes.js';
import { openPratoForm } from './pratoForm.js';

const memory = { q: '', filters: {} };

/** Pratos: grid padrão com pesquisa e filtros; modal com abas Dados e Ingredientes. Nível B só consulta ("Ver"). */
export async function viewPratos() {
  const [pratos, categorias, ingredientes] = await Promise.all([api.get('/api/pratos'), api.get('/api/categorias'), api.get('/api/ingredientes')]);
  const nomeCategoria = (id) => categorias.find((c) => c.id === id)?.nome ?? '—';
  const reload = () => viewPratos().catch(fail);
  const editor = podeEditar();

  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por nome, código ou categoria…',
    columns: [
      { label: 'Nome', sort: (p) => p.nome, cell: (p) => `${esc(p.nome)}${p.codigo ? ` <small>${esc(p.codigo)}</small>` : ''}` },
      { label: 'Categoria', sort: (p) => nomeCategoria(p.categoriaId), cell: (p) => esc(nomeCategoria(p.categoriaId)) },
      { label: 'Preço', align: 'right', sort: (p) => p.precoCents, cell: (p) => esc(brl(p.precoCents)) },
      { label: 'Ingredientes', align: 'right', sort: (p) => p.ingredientes.length, cell: (p) => String(p.ingredientes.length) },
      { label: 'Situação', sort: (p) => (p.ativo ? 0 : 1), cell: (p) => tagAtivo(p.ativo) },
    ],
    rowActions: editor ? acoesDeLinha : () => [{ a: 'view', label: 'Ver' }],
    newLabel: 'Novo prato',
    onNew: editor ? () => openPratoForm({ categorias, ingredientes, reload }) : undefined,
    onSearch: (q) => { memory.q = q; apply(); },
    onFilters: () => openFilterDialog({
      title: 'Filtros — pratos',
      fields: [
        { name: 'categoria', label: 'Categoria', type: 'select', options: [{ value: '', label: 'Todas' }, ...categorias.map((c) => ({ value: c.id, label: c.nome }))] },
        { name: 'ativo', label: 'Situação', type: 'select', options: [{ value: '', label: 'Todos' }, { value: 'sim', label: 'Ativos' }, { value: 'nao', label: 'Inativos' }] },
      ],
      values: memory.filters,
      onApply: (values) => { memory.filters = values; apply(); },
    }),
    onAction: (action, row) => ((action === 'edit' || action === 'view')
      ? openPratoForm({ prato: row, categorias, ingredientes, reload, somenteLeitura: action === 'view' })
      : executarAcao({ recurso: 'pratos', tipo: 'prato', action, row, reload })),
    emptyText: 'Nenhum prato encontrado.',
  });

  function apply() {
    const f = memory.filters;
    const rows = pratos.filter((p) => norm(`${p.nome} ${p.codigo ?? ''} ${nomeCategoria(p.categoriaId)}`).includes(norm(memory.q))
      && (!f.categoria || String(p.categoriaId) === String(f.categoria)) && (!f.ativo || (f.ativo === 'sim') === p.ativo));
    const rotulos = [f.categoria && `Categoria: ${nomeCategoria(Number(f.categoria))}`, f.ativo && (f.ativo === 'sim' ? 'Ativos' : 'Inativos')].filter(Boolean);
    grid.setRows(rows, rotulos.join(' · '));
    grid.setFilterCount(Object.keys(f).length);
  }
  apply();
}
