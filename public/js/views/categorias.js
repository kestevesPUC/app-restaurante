import { api } from '../api.js';
import { esc } from '../format.js';
import { view, notify, fail, openDialog } from '../ui.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';
import { podeEditar, tagAtivo, sim, norm, acoesDeLinha, executarAcao } from '../components/cadastroAcoes.js';

const memory = { q: '', filters: {} };

/** Categorias do cardápio: grid padrão + modal (nome, ordem, vai para a cozinha, ativo). Nível B só consulta. */
export async function viewCategorias() {
  const categorias = await api.get('/api/categorias');
  const reload = () => viewCategorias().catch(fail);

  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por nome…',
    columns: [
      { label: 'Nome', sort: (c) => c.nome, cell: (c) => esc(c.nome) },
      { label: 'Ordem', align: 'right', sort: (c) => c.ordem, cell: (c) => String(c.ordem) },
      { label: 'Vai para a cozinha', sort: (c) => (c.vaiParaCozinha ? 0 : 1), cell: (c) => sim(c.vaiParaCozinha) },
      { label: 'Situação', sort: (c) => (c.ativo ? 0 : 1), cell: (c) => tagAtivo(c.ativo) },
    ],
    rowActions: podeEditar() ? acoesDeLinha : undefined,
    newLabel: 'Nova categoria',
    onNew: podeEditar() ? () => openForm(reload) : undefined,
    onSearch: (q) => { memory.q = q; apply(); },
    onFilters: () => openFilterDialog({
      title: 'Filtros — categorias',
      fields: [{ name: 'ativo', label: 'Situação', type: 'select', options: [{ value: '', label: 'Todas' }, { value: 'sim', label: 'Ativas' }, { value: 'nao', label: 'Inativas' }] }],
      values: memory.filters,
      onApply: (values) => { memory.filters = values; apply(); },
    }),
    onAction: (action, row) => (action === 'edit' ? openForm(reload, row) : executarAcao({ recurso: 'categorias', tipo: 'categoria', action, row, reload })),
    emptyText: 'Nenhuma categoria encontrada.',
  });

  function apply() {
    const f = memory.filters;
    const rows = categorias.filter((c) => norm(c.nome).includes(norm(memory.q)) && (!f.ativo || (f.ativo === 'sim') === c.ativo));
    grid.setRows(rows, f.ativo ? (f.ativo === 'sim' ? 'Ativas' : 'Inativas') : '');
    grid.setFilterCount(Object.keys(f).length);
  }
  apply();
}

function openForm(reload, cat = null) {
  openDialog(`<h2>${cat ? `Editar categoria ${esc(cat.nome)}` : 'Nova categoria'}</h2><div class="form-grid">
    <label>Nome<input name="nome" maxlength="60" required autocomplete="off" autofocus value="${esc(cat?.nome ?? '')}"></label>
    <label>Ordem no cardápio<input name="ordem" type="number" min="0" step="1" required value="${esc(cat?.ordem ?? 0)}"></label>
    <label class="check"><input type="checkbox" name="vaiParaCozinha" ${cat?.vaiParaCozinha ?? true ? 'checked' : ''}>Vai para a cozinha</label>
    <label class="check"><input type="checkbox" name="ativo" ${cat?.ativo ?? true ? 'checked' : ''}>Ativa</label>
    </div>`,
  async (data) => {
    const ordem = Number(data.ordem);
    if (!Number.isInteger(ordem) || ordem < 0) throw new Error('A ordem deve ser um inteiro maior ou igual a zero');
    const corpo = { nome: data.nome, ordem, vaiParaCozinha: data.vaiParaCozinha === 'on', ativo: data.ativo === 'on' };
    return cat ? api.put(`/api/categorias/${cat.id}`, corpo) : api.post('/api/categorias', corpo);
  },
  async () => { await reload(); notify(cat ? 'Categoria atualizada' : 'Categoria cadastrada'); },
  { confirmLabel: 'Salvar' });
}
