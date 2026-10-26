import { api } from '../api.js';
import { icon } from '../icons.js';
import { notify, fail, confirmDialog } from '../ui.js';
import { state } from '../state.js';

/** Somente o nível A edita o cardápio; o nível B consulta (sem botões de edição). */
export const podeEditar = () => state.me?.nivel === 'A';

export const tagAtivo = (ativo) => (ativo
  ? `<span class="tag ok">${icon('check')}Ativo</span>`
  : `<span class="tag bad">${icon('x')}Inativo</span>`);

export const sim = (v) => (v ? 'Sim' : 'Não');
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Ações por linha: editar; no menu "⋯", desativar/reativar e excluir. Nível B: nenhuma. */
export const acoesDeLinha = (row) => (podeEditar()
  ? [{ a: 'edit', label: 'Editar' }, row.ativo ? { a: 'off', label: 'Desativar' } : { a: 'on', label: 'Reativar' }, { a: 'del', label: 'Excluir', danger: true }]
  : []);

/**
 * Trata desativar/reativar/excluir de um registro (`recurso` = 'categorias' | 'ingredientes' | 'pratos').
 * Em 409 ("Em uso") mostra a mensagem do servidor e oferece desativar.
 */
export async function executarAcao({ recurso, tipo, action, row, reload }) {
  try {
    if (action === 'off' || action === 'on') {
      const ativar = action === 'on';
      if (!ativar && !await confirmDialog({ title: `Desativar ${tipo}`, message: `Desativar "${row.nome}"? Deixa de aparecer nos novos pedidos, mas o histórico é mantido.`, confirmLabel: 'Desativar', danger: true })) return;
      await api.put(`/api/${recurso}/${row.id}`, { ativo: ativar });
      await reload();
      notify(ativar ? `"${row.nome}" reativado` : `"${row.nome}" desativado`);
      return;
    }
    if (action !== 'del') return;
    if (!await confirmDialog({ title: `Excluir ${tipo}`, message: `Excluir "${row.nome}" definitivamente? Esta ação não pode ser desfeita.`, confirmLabel: 'Excluir', danger: true })) return;
    try {
      await api.del(`/api/${recurso}/${row.id}`);
    } catch (error) {
      if (error.status !== 409) throw error;
      if (row.ativo && await confirmDialog({ title: 'Não foi possível excluir', message: `${error.message}: "${row.nome}" já foi usado. Deseja desativá-lo em vez de excluir?`, confirmLabel: 'Desativar' })) {
        await api.put(`/api/${recurso}/${row.id}`, { ativo: false });
        await reload();
        notify(`"${row.nome}" desativado`);
        return;
      }
      throw error;
    }
    await reload();
    notify(`"${row.nome}" excluído`);
  } catch (error) { fail(error); }
}
