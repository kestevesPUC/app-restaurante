export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
export const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/**
 * Converte um valor digitado em reais ("12,50", "1.234,56", "R$ 7") em centavos inteiros.
 * Devolve null se vazio, negativo, não numérico ou com mais de 2 casas decimais.
 */
export function reaisParaCents(texto) {
  if (typeof texto !== 'string') return null;
  let t = texto.replace(/^\s*R\$\s*/i, '').trim();
  if (!t || !/^[\d.,]+$/.test(t)) return null;
  const virgulas = (t.match(/,/g) || []).length;
  if (virgulas > 1) return null;
  if (virgulas === 1) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    // ponto como decimal ("12.50")
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  } else if (t.includes('.')) {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  const cents = Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos -> texto editável em reais ("1250" -> "12,50"). */
export const centsParaReais = (cents) => (Number.isInteger(cents) && cents >= 0
  ? `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}` : '');
