import { esc } from '../format.js';
import { icon } from '../icons.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Seletor de ingredientes com busca: lista os ingredientes ativos que ainda não estão no prato.
 * `onPick(ingrediente)` é chamado ao clicar (ou Enter, que escolhe o primeiro resultado).
 * Devolve `{ refresh(idsUsados) }` para atualizar após mudanças na lista.
 */
export function createIngredientePicker(host, { ingredientes, usados = [], onPick }) {
  let ids = new Set(usados);
  host.innerHTML = `<label>Adicionar ingrediente
    <input type="search" autocomplete="off" placeholder="Buscar ingrediente…" data-pick="q"></label>
    <ul class="picker-list" data-pick="list" aria-label="Ingredientes disponíveis"></ul>`;
  const input = host.querySelector('[data-pick="q"]');
  const list = host.querySelector('[data-pick="list"]');

  const matches = () => ingredientes
    .filter((i) => i.ativo && !ids.has(i.id) && norm(i.nome).includes(norm(input.value.trim())))
    .slice(0, 8);

  const paint = () => {
    const found = matches();
    list.innerHTML = found.length
      ? found.map((i) => `<li><button type="button" class="btn alt sm" data-id="${i.id}">${icon('plus')}${esc(i.nome)}</button></li>`).join('')
      : `<li class="empty-note">${esc(input.value.trim() ? 'Nenhum ingrediente encontrado.' : 'Todos os ingredientes ativos já estão no prato.')}</li>`;
  };

  const pick = (id) => {
    const ingrediente = ingredientes.find((i) => i.id === Number(id));
    if (ingrediente) onPick(ingrediente);
  };

  input.addEventListener('input', paint);
  // Enter escolhe o primeiro resultado e não envia o formulário do modal.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const [primeiro] = matches();
    if (primeiro) pick(primeiro.id);
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (button) pick(button.dataset.id);
  });
  paint();

  return {
    refresh(usadosAgora) {
      ids = new Set(usadosAgora);
      paint();
    },
  };
}
