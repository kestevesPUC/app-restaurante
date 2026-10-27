// Ícones (estilo Lucide, SVG inline); decorativos, sempre acompanhados de texto.
const ICONS = {
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6 6 0 0 0-4-5.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9z"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  pix: '<path d="M7 7.2L10.6 3.6a2 2 0 0 1 2.8 0L17 7.2"/><path d="M7 16.8l3.6 3.6a2 2 0 0 0 2.8 0l3.6-3.6"/><path d="M7 7.2l-3.4 3.4a2 2 0 0 0 0 2.8L7 16.8M17 7.2l3.4 3.4a2 2 0 0 1 0 2.8L17 16.8"/><path d="M7 7.2h.8c.6 0 1.1.2 1.5.6l2 2a1 1 0 0 0 1.4 0l2-2c.4-.4.9-.6 1.5-.6H17M7 16.8h.8c.6 0 1.1-.2 1.5-.6l2-2a1 1 0 0 1 1.4 0l2 2c.4.4.9.6 1.5.6H17"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  chef: '<path d="M7 14a4 4 0 1 1 1.5-7.7A4 4 0 0 1 16 6.3 4 4 0 1 1 17 14z"/><path d="M7 14v6h10v-6"/>',
  out: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.5v.01"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  dish: '<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5M16 21V3c-2.5 1.5-3 5-3 8h3"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l8-8"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A17.5 17.5 0 0 0 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

export const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
