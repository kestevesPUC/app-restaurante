import { view, notify } from '../ui.js';
import { esc } from '../format.js';
import { CORES, savedColors, saveColors, currentColor } from '../theme.js';

/** Aparência: o usuário troca só a cor primária, a secundária, o menu lateral e os botões; o resto do tema não muda. */
export async function viewAparencia() {
  const valor = (c) => {
    const hex = currentColor(c) || currentColor(CORES[0]);
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#000000';
  };
  const desenhar = () => {
    view().innerHTML = `<div class="card"><h2>Cores do sistema</h2>
      <p class="coming" style="padding:0 0 8px;font-size:14px;text-align:left">Escolha as cores; a mudança vale na hora e fica gravada neste computador.</p>
      <div class="cores">${CORES.map((c) => `<label>
        <input type="color" name="${c.id}" value="${valor(c)}" aria-label="${esc(c.rotulo)}">
        <span>${esc(c.rotulo)}<small>${esc(c.dica)}</small></span></label>`).join('')}</div>
      <div class="row"><button type="button" class="btn alt" data-a="restaurar">Restaurar cores originais</button></div></div>`;
  };
  desenhar();

  view().oninput = (e) => {
    if (e.target.type !== 'color') return;
    saveColors({ ...savedColors(), [e.target.name]: e.target.value });
  };
  view().onclick = (e) => {
    if (!e.target.closest('[data-a="restaurar"]')) return;
    saveColors({});
    desenhar();
    notify('Cores originais restauradas');
  };
}
