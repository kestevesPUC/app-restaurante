export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
export const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
