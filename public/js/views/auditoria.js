import { api, queryString } from '../api.js';
import { esc, dataHora, dataBr } from '../format.js';
import { icon } from '../icons.js';
import { view, fail, openDialog } from '../ui.js';
import { createGrid } from '../components/grid.js';
import { openFilterDialog } from '../components/filterDialog.js';

const ACAO = {
  criar: 'Criou', alterar: 'Alterou', excluir: 'Excluiu', login: 'Entrou', logout: 'Saiu', login_falha: 'Falha de login',
  login_bloqueado: 'Login bloqueado', senha: 'Trocou senha',
};
const ACAO_TOM = { excluir: 'bad', login_falha: 'bad', login_bloqueado: 'bad', criar: 'ok' };
const ACAO_ICONE = { excluir: 'x', login_falha: 'alert', login_bloqueado: 'alert', criar: 'check' };
const ENTIDADE = { usuario: 'Usuário', sessao: 'Sessão', sistema: 'Sistema' };
const CAMPO = { nome: 'Nome', nivel: 'Nível', usuario: 'Usuário', ativo: 'Ativo' };

const rotulo = (mapa, chave) => mapa[chave] || chave;
const valor = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

// Pesquisa e filtros mantidos ao navegar entre telas.
const memory = { q: '', filters: {} };

/** Tabela "campo: antes → depois" apenas com o que mudou. */
function diffTable(antes, depois) {
  const chaves = [...new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})])].filter((k) => k !== 'id');
  const linhas = chaves.filter((k) => !antes || !depois || JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
  if (!linhas.length) return '<p><small>Sem alterações de campos.</small></p>';
  return `<div class="wrap"><table><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${linhas.map((k) => `<tr><td>${esc(rotulo(CAMPO, k))}</td><td>${esc(valor(antes?.[k]))}</td><td>${esc(valor(depois?.[k]))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function detalhes(entrada) {
  try {
    const r = await api.get(`/api/auditoria/${entrada.id}`);
    openDialog(`<h2>Registro #${r.id}</h2>
      <dl class="detail"><dt>Quando</dt><dd>${esc(dataHora(r.em))}</dd><dt>Quem</dt><dd>${esc(r.usuario)}</dd>
      <dt>Ação</dt><dd>${esc(rotulo(ACAO, r.acao))} · ${esc(rotulo(ENTIDADE, r.entidade))}${r.entidadeId ? ` #${r.entidadeId}` : ''}</dd>
      <dt>Descrição</dt><dd>${esc(r.descricao)}</dd></dl>
      ${r.antes || r.depois ? `<h3>O que mudou</h3>${diffTable(r.antes, r.depois)}` : ''}`, async () => {}, () => {}, { confirmLabel: 'Fechar', hideCancel: true });
  } catch (error) { fail(error); }
}

/** Auditoria (nível A): quem fez o quê e quando, com pesquisa, filtros e detalhes antes → depois. */
export async function viewAuditoria() {
  // As opções dos filtros vêm dos próprios registros (a API não expõe valores distintos).
  const todos = await api.get('/api/auditoria');
  const distintos = (campo) => [...new Set(todos.map((e) => e[campo]).filter(Boolean))].sort();
  const escolhas = (valores, vazio, texto = (v) => v) => [{ value: '', label: vazio }, ...valores.map((v) => ({ value: v, label: texto(v) }))];
  const consulta = () => queryString({ ...memory.filters, q: memory.q });

  const grid = createGrid(view(), {
    search: memory.q,
    searchPlaceholder: 'Pesquisar por usuário, ação, entidade ou descrição…',
    debounceMs: 300,
    columns: [
      { label: 'Data/hora', sort: (e) => e.em, cell: (e) => esc(dataHora(e.em)) },
      { label: 'Usuário', sort: (e) => e.usuario, cell: (e) => esc(e.usuario) },
      { label: 'Ação', sort: (e) => e.acao, cell: (e) => `<span class="tag ${ACAO_TOM[e.acao] || ''}">${ACAO_ICONE[e.acao] ? icon(ACAO_ICONE[e.acao]) : ''}${esc(rotulo(ACAO, e.acao))}</span>` },
      { label: 'Entidade', sort: (e) => e.entidade, cell: (e) => `${esc(rotulo(ENTIDADE, e.entidade))}${e.entidadeId ? ` <small>#${e.entidadeId}</small>` : ''}` },
      { label: 'Descrição', cell: (e) => esc(e.descricao) },
    ],
    rowActions: () => [{ a: 'detalhes', label: 'Detalhes' }],
    onSearch: (q) => { memory.q = q; atualizar(); },
    onFilters: () => openFilterDialog({
      title: 'Filtros da auditoria',
      fields: [
        { name: 'usuario', label: 'Usuário', type: 'select', options: escolhas(distintos('usuario'), 'Todos') },
        { name: 'acao', label: 'Ação', type: 'select', options: escolhas(distintos('acao'), 'Todas', (v) => rotulo(ACAO, v)) },
        { name: 'entidade', label: 'Entidade', type: 'select', options: escolhas(distintos('entidade'), 'Todas', (v) => rotulo(ENTIDADE, v)) },
        { name: 'de', label: 'De (data)', type: 'date' },
        { name: 'ate', label: 'Até (data)', type: 'date' },
      ],
      values: memory.filters,
      onApply: (values) => { memory.filters = values; atualizar(); },
    }),
    onAction: (_acao, entrada) => detalhes(entrada),
    emptyText: 'Nenhum registro de auditoria com esses critérios.',
  });

  async function atualizar() {
    try {
      const f = memory.filters;
      const rows = await api.get(`/api/auditoria?${consulta()}`);
      const partes = [f.usuario && `Usuário: ${f.usuario}`, f.acao && `Ação: ${rotulo(ACAO, f.acao)}`, f.entidade && `Entidade: ${rotulo(ENTIDADE, f.entidade)}`,
        f.de && `De ${dataBr(f.de)}`, f.ate && `Até ${dataBr(f.ate)}`].filter(Boolean);
      grid.setRows(rows, `${partes.join(' · ') || 'Mais recentes primeiro'}${rows.length >= 1000 ? ' · exibindo os 1000 mais recentes' : ''}`);
      grid.setFilterCount(Object.keys(f).length);
    } catch (error) { fail(error); }
  }
  grid.setLoading();
  await atualizar();
}
