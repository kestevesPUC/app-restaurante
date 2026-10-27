import { api } from '../api.js';
import { esc, brl, reaisParaCents, centsParaReais } from '../format.js';
import { view, notify, fail, openDialog } from '../ui.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';
import { podeEditar, tagAtivo, sim, norm, acoesDeLinha, executarAcao } from '../components/cadastroAcoes.js';

const memory = { q: '', filters: {} };

/** Ingredientes: grid padrão + modal (nome, preço de adicional em R$, pode ser adicional, ativo). Nível B só consulta. */
export async function viewIngredientes() {
  const ingredientes = await api.get('/api/ingredientes');
  const reload = () => viewIngredientes().catch(fail);

  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por nome…',
    columns: [
      { label: 'Nome', sort: (i) => i.nome, cell: (i) => esc(i.nome) },
      { label: 'Preço de adicional', align: 'right', sort: (i) => i.precoAdicionalCents, cell: (i) => esc(brl(i.precoAdicionalCents)) },
      { label: 'Pode ser adicional', sort: (i) => (i.podeSerAdicional ? 0 : 1), cell: (i) => sim(i.podeSerAdicional) },
      { label: 'Situação', sort: (i) => (i.ativo ? 0 : 1), cell: (i) => tagAtivo(i.ativo) },
    ],
    rowActions: podeEditar() ? acoesDeLinha : undefined,
    newLabel: 'Novo ingrediente',
    onNew: podeEditar() ? () => openForm(reload) : undefined,
    onSearch: (q) => { memory.q = q; apply(); },
    onFilters: () => openFilterDialog({
      title: 'Filtros — ingredientes',
      fields: [
        { name: 'adicional', label: 'Pode ser adicional', type: 'select', options: [{ value: '', label: 'Todos' }, { value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }] },
        { name: 'ativo', label: 'Situação', type: 'select', options: [{ value: '', label: 'Todas' }, { value: 'sim', label: 'Ativos' }, { value: 'nao', label: 'Inativos' }] },
      ],
      values: memory.filters,
      onApply: (values) => { memory.filters = values; apply(); },
    }),
    onAction: (action, row) => (action === 'edit' ? openForm(reload, row) : executarAcao({ recurso: 'ingredientes', tipo: 'ingrediente', action, row, reload })),
    emptyText: 'Nenhum ingrediente encontrado.',
  });

  function apply() {
    const f = memory.filters;
    const rows = ingredientes.filter((i) => norm(i.nome).includes(norm(memory.q))
      && (!f.ativo || (f.ativo === 'sim') === i.ativo) && (!f.adicional || (f.adicional === 'sim') === i.podeSerAdicional));
    const rotulos = [f.adicional && `Adicional: ${f.adicional === 'sim' ? 'sim' : 'não'}`, f.ativo && (f.ativo === 'sim' ? 'Ativos' : 'Inativos')].filter(Boolean);
    grid.setRows(rows, rotulos.join(' · '));
    grid.setFilterCount(Object.keys(f).length);
  }
  apply();
}

function openForm(reload, ing = null) {
  openDialog(`<h2>${ing ? `Editar ingrediente ${esc(ing.nome)}` : 'Novo ingrediente'}</h2><div class="form-grid">
    <label>Nome<input name="nome" maxlength="60" required autocomplete="off" autofocus value="${esc(ing?.nome ?? '')}"></label>
    <label>Preço de adicional (R$)<input name="preco" data-mask="dinheiro" inputmode="decimal" autocomplete="off" placeholder="0,00" required value="${esc(centsParaReais(ing?.precoAdicionalCents ?? 0))}"></label>
    <label class="check"><input type="checkbox" name="podeSerAdicional" ${ing?.podeSerAdicional ? 'checked' : ''}>Pode ser adicional</label>
    <label class="check"><input type="checkbox" name="ativo" ${ing?.ativo ?? true ? 'checked' : ''}>Ativo</label>
    </div><p><small>Cobrado quando o cliente pede este ingrediente a mais. Use vírgula para os centavos (ex.: 3,50).</small></p>`,
  async (data) => {
    const precoAdicionalCents = reaisParaCents(data.preco);
    if (precoAdicionalCents === null) throw new Error('Preço inválido. Informe um valor em reais, sem negativos (ex.: 3,50)');
    const corpo = { nome: data.nome, precoAdicionalCents, podeSerAdicional: data.podeSerAdicional === 'on', ativo: data.ativo === 'on' };
    return ing ? api.put(`/api/ingredientes/${ing.id}`, corpo) : api.post('/api/ingredientes', corpo);
  },
  async () => { await reload(); notify(ing ? 'Ingrediente atualizado' : 'Ingrediente cadastrado'); },
  { confirmLabel: 'Salvar' });
}
