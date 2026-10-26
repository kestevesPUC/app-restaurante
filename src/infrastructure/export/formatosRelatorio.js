'use strict';

const dois = (n) => String(n).padStart(2, '0');

/** Segundos → "mm:ss" ou "h:mm:ss". */
function duracao(segundos) {
  if (segundos === null || segundos === undefined) return '';
  const total = Math.max(0, Math.round(Number(segundos)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

/** "2026-10-23" → "23/10/2026"; "2026-10" → "10/2026"; instante ISO → "23/10/2026 12:00" (hora local). */
function data(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const texto = String(valor);
  if (texto.includes('T')) {
    const d = new Date(texto);
    if (Number.isNaN(d.getTime())) return texto;
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }
  return texto.split('-').reverse().join('/');
}

/** Centavos → "R$ 1.234,56". */
function reais(centavos) {
  const v = Number(centavos) / 100;
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ROTULOS = {
  quantidade: 'Quantidade', totalCents: 'Total', faturamentoCents: 'Faturamento', ticketMedioCents: 'Ticket médio', gastoCents: 'Gasto',
  mediaSegundos: 'Tempo médio', minimoSegundos: 'Mínimo', maximoSegundos: 'Máximo',
};

/** Totais exibíveis: [{ rotulo, valor, tipo }] só com valores escalares (ignora objetos e nulos). */
function totaisExibiveis(totais) {
  return Object.entries(totais || {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([chave, valor]) => ({
      rotulo: ROTULOS[chave] || chave,
      valor,
      tipo: chave.endsWith('Cents') ? 'dinheiro' : chave.endsWith('Segundos') ? 'duracao' : 'inteiro',
    }));
}

/** Texto do período ("dd/mm/aaaa a dd/mm/aaaa") ou null. */
function periodoTexto(periodo) {
  return periodo ? `${data(periodo.de)} a ${data(periodo.ate)}` : null;
}

const geradoEm = (agora = new Date()) => data(agora.toISOString());

module.exports = { duracao, data, reais, totaisExibiveis, periodoTexto, geradoEm };
