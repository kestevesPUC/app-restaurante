import { icon } from './icons.js';

// Tema claro por padrão (instalação nova); a escolha do usuário fica guardada neste navegador, junto com as cores personalizadas.
const STORAGE_KEY = 'pdv-theme';
const COLORS_KEY = 'pdv-cores';
const root = document.documentElement;

const current = () => root.dataset.theme || 'light';

export function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage indisponível: usa o claro */ }
  root.dataset.theme = saved === 'dark' ? 'dark' : 'light';
  applyColors(savedColors());
}

/** Cores personalizáveis: cada uma troca uma ou mais variáveis do design system. Sem escolha, valem as originais. */
export const CORES = [
  { id: 'primaria', rotulo: 'Cor primária', dica: 'Links, destaques e foco', vars: ['--brand'], ink: '--brand-ink' },
  { id: 'secundaria', rotulo: 'Cor secundária', dica: 'Fundos suaves e selos', vars: ['--brand-soft'] },
  { id: 'sidebar', rotulo: 'Menu lateral', dica: 'Fundo do menu e da tela de login', vars: ['--side'], derived: { '--side-on-bg': 'color-mix(in srgb, var(--side) 78%, white)' } },
  { id: 'botoes', rotulo: 'Botões', dica: 'Fundo dos botões principais', vars: ['--btn'], ink: '--btn-ink' },
];
const HEX = /^#[0-9a-f]{6}$/i;

export function savedColors() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLORS_KEY) || '{}');
    return Object.fromEntries(CORES.filter((c) => HEX.test(raw?.[c.id])).map((c) => [c.id, raw[c.id]]));
  } catch { return {}; }
}

const legible = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0f1b2d' : '#ffffff';
};

/** Aplica (ou, com {}, limpa) as cores personalizadas direto no :root. */
export function applyColors(cores) {
  CORES.forEach((c) => {
    const props = [...c.vars, ...(c.ink ? [c.ink] : []), ...Object.keys(c.derived || {})];
    props.forEach((p) => root.style.removeProperty(p));
    const hex = cores[c.id];
    if (!hex) return;
    c.vars.forEach((p) => root.style.setProperty(p, hex));
    if (c.ink) root.style.setProperty(c.ink, legible(hex));
    Object.entries(c.derived || {}).forEach(([p, v]) => root.style.setProperty(p, v));
  });
}

export function saveColors(cores) {
  applyColors(cores);
  try {
    if (Object.keys(cores).length) localStorage.setItem(COLORS_KEY, JSON.stringify(cores));
    else localStorage.removeItem(COLORS_KEY);
  } catch { /* ignora */ }
}

/** Valor atual (computado) de cada cor, para preencher os seletores. */
export const currentColor = (c) => getComputedStyle(root).getPropertyValue(c.vars[0]).trim();

function paint(button) {
  const dark = current() === 'dark';
  button.innerHTML = `${icon(dark ? 'sun' : 'moon')}<span>${dark ? 'Tema claro' : 'Tema escuro'}</span>`;
  button.setAttribute('aria-label', dark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
}

function toggle() {
  const next = current() === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignora */ }
  document.querySelectorAll('[data-theme-btn]').forEach(paint);
}

export const themeButton = (cls = '') => `<button type="button" class="${cls}" data-theme-btn></button>`;

export function wireThemeButtons() {
  document.querySelectorAll('[data-theme-btn]').forEach((button) => {
    paint(button);
    button.onclick = toggle;
  });
}
