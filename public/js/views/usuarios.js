import { api } from '../api.js';
import { esc } from '../format.js';
import { icon } from '../icons.js';
import { view, notify, fail, openDialog, confirmDialog } from '../ui.js';
import { NIVEIS, nivelNome } from '../niveis.js';
import { state } from '../state.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';

// Pesquisa e filtros mantidos ao navegar entre telas.
const memory = { q: '', filters: {} };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const situacao = (u) => (u.ativo
  ? `<span class="tag ok">${icon('check')}Ativo</span>`
  : `<span class="tag bad">${icon('x')}Inativo</span>`);

/** Tela de usuários (nível A): grid padrão, cadastro em modal, senha provisória exibida uma única vez. */
export async function viewUsuarios() {
  const users = await api.get('/api/usuarios');
  const reload = () => viewUsuarios().catch(fail);

  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por usuário, nome ou nível…',
    columns: [
      { label: 'Usuário', sort: (u) => u.usuario, cell: (u) => esc(u.usuario) },
      { label: 'Nome', sort: (u) => u.nome, cell: (u) => esc(u.nome) },
      { label: 'Nível', sort: (u) => u.nivel, cell: (u) => `${u.nivel} — ${esc(nivelNome(u.nivel))}` },
      { label: 'Situação', sort: (u) => (u.ativo ? 0 : 1), cell: (u) => `${situacao(u)}${u.mustChange ? ' <small>troca de senha pendente</small>' : ''}` },
    ],
    rowActions: (u) => [{ a: 'edit', label: 'Editar' }, { a: 'pwd', label: 'Redefinir senha' },
      u.ativo ? { a: 'off', label: 'Desativar', danger: true } : { a: 'on', label: 'Reativar' }],
    newLabel: 'Novo',
    onNew: () => openForm(reload),
    onSearch: (q) => { memory.q = q; apply(); },
    onFilters: () => openFilterDialog({
      title: 'Filtros — usuários',
      fields: [
        { name: 'nivel', label: 'Nível', type: 'select', options: [{ value: '', label: 'Todos' }, ...NIVEIS.map((n) => ({ value: n.id, label: `${n.id} — ${n.nome}` }))] },
        { name: 'ativo', label: 'Situação', type: 'select', options: [{ value: '', label: 'Todas' }, { value: 'sim', label: 'Ativos' }, { value: 'nao', label: 'Inativos' }] },
      ],
      values: memory.filters,
      onApply: (values) => { memory.filters = values; apply(); },
    }),
    onAction: (action, user) => acao(action, user, reload),
    emptyText: 'Nenhum usuário encontrado.',
  });

  function apply() {
    const f = memory.filters;
    const rows = users.filter((u) => norm(`${u.usuario} ${u.nome} ${u.nivel} ${nivelNome(u.nivel)}`).includes(norm(memory.q))
      && (!f.nivel || u.nivel === f.nivel) && (!f.ativo || (f.ativo === 'sim') === u.ativo));
    const rotulos = [f.nivel && `Nível: ${f.nivel}`, f.ativo && (f.ativo === 'sim' ? 'Ativos' : 'Inativos')].filter(Boolean);
    grid.setRows(rows, rotulos.join(' · '));
    grid.setFilterCount(Object.keys(f).length);
  }
  apply();
}

async function acao(action, user, reload) {
  try {
    if (action === 'edit') return openForm(reload, user);
    if (action === 'pwd') {
      if (!await confirmDialog({ title: 'Redefinir senha', message: `Gerar nova senha provisória para ${user.usuario}? Ele será desconectado e deverá trocá-la no próximo acesso.`, confirmLabel: 'Redefinir' })) return undefined;
      const { senhaProvisoria } = await api.post(`/api/usuarios/${user.id}/resetar-senha`);
      return mostrarSenha(user.usuario, senhaProvisoria);
    }
    const ativar = action === 'on';
    if (!ativar && !await confirmDialog({ title: 'Desativar usuário', message: `Desativar ${user.usuario}? Ele perderá o acesso ao sistema.`, confirmLabel: 'Desativar', danger: true })) return undefined;
    await api.put(`/api/usuarios/${user.id}`, { ativo: ativar });
    await reload();
    return notify(ativar ? `${user.usuario} reativado` : `${user.usuario} desativado`);
  } catch (error) { return fail(error); }
}

/** Cadastro (user == null) ou edição de nome, nível e situação; o login é definido só na criação. */
function openForm(reload, user = null) {
  const opcoes = (atual) => NIVEIS.map((n) => `<option value="${n.id}" ${n.id === atual ? 'selected' : ''}>${n.id} — ${esc(n.nome)}</option>`).join('');
  const proprio = user && user.id === state.me?.id;
  openDialog(`<h2>${user ? `Editar usuário ${esc(user.usuario)}` : 'Novo usuário'}</h2><div class="form-grid">
    ${user ? '' : '<label>Usuário (login, sem espaços)<input name="usuario" maxlength="20" required autocomplete="off" autofocus></label>'}
    <label>Nome<input name="nome" maxlength="60" required autocomplete="off" value="${esc(user?.nome ?? '')}"></label>
    <label>Nível<select name="nivel">${opcoes(user?.nivel ?? 'B')}</select></label>
    ${user ? `<label>Situação<select name="ativo" ${proprio ? 'disabled' : ''}><option value="1" ${user.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${user.ativo ? '' : 'selected'}>Inativo</option></select></label>` : ''}
    </div>
    ${user ? '' : '<p><small>Uma senha provisória será gerada e exibida uma única vez; o usuário a troca no primeiro acesso.</small></p>'}
    <dl class="niveis">${NIVEIS.map((n) => `<dt>${n.id} — ${esc(n.nome)}</dt><dd>${esc(n.descricao)}</dd>`).join('')}</dl>`,
  async (data) => {
    if (user) {
      const corpo = { nome: data.nome, nivel: data.nivel };
      if (data.ativo !== undefined) corpo.ativo = data.ativo === '1';
      return api.put(`/api/usuarios/${user.id}`, corpo);
    }
    const criado = await api.post('/api/usuarios', data);
    return mostrarSenhaDepois(criado);
  },
  async () => { await reload(); notify(user ? 'Usuário atualizado' : 'Usuário cadastrado'); mostrarPendente(); });
}

// A senha provisória só pode aparecer depois que o diálogo do formulário fecha.
let pendente = null;
const mostrarSenhaDepois = ({ user, senhaProvisoria }) => { pendente = { usuario: user.usuario, senhaProvisoria }; };
function mostrarPendente() {
  if (!pendente) return;
  const { usuario, senhaProvisoria } = pendente;
  pendente = null;
  mostrarSenha(usuario, senhaProvisoria);
}

/** Exibe a senha provisória uma única vez, com botão de copiar. */
function mostrarSenha(usuario, senha) {
  openDialog(`<h2>Senha provisória de ${esc(usuario)}</h2>
    <div class="provisoria" role="status">${icon('alert')}<span>Anote agora: esta senha não será exibida novamente.</span><code>${esc(senha)}</code>
    <button type="button" class="btn alt sm" id="copiarSenha">Copiar</button></div>
    <p><small>${esc(usuario)} deverá definir uma nova senha no primeiro acesso.</small></p>`,
  async () => {}, () => {}, { confirmLabel: 'Fechar', hideCancel: true });
  document.getElementById('copiarSenha').onclick = async (event) => {
    try { await navigator.clipboard.writeText(senha); event.target.textContent = 'Copiado'; } catch { event.target.textContent = 'Selecione e copie'; }
  };
}
