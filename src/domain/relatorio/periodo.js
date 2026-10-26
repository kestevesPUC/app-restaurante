'use strict';
const ValidationError = require('../errors/ValidationError');

const INTERVALO_MAXIMO_DIAS = 3660;
const DIA_MS = 24 * 60 * 60 * 1000;
const dois = (n) => String(n).padStart(2, '0');

/** Data local AAAA-MM-DD de um Date. */
function textoLocal(d) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** AAAA-MM-DD existente no calendário → [ano, mes, dia]; senão ValidationError. */
function partes(texto, rotulo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ''));
  const [a, mes, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [];
  const data = m && new Date(Date.UTC(a, mes - 1, d));
  if (!data || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== d) throw new ValidationError(`${rotulo} deve estar no formato AAAA-MM-DD`);
  return [a, mes, d];
}

/**
 * Período de relatório em datas LOCAIS. Padrão: dia 1 do mês local atual até hoje.
 * Devolve também os limites UTC `[inicioIso, fimIso)` (fim = início do dia local seguinte a `ate`).
 */
function resolverPeriodo({ de, ate } = {}, agoraMs) {
  const hoje = new Date(agoraMs);
  const deTexto = de ?? textoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const ateTexto = ate ?? textoLocal(hoje);
  const [a1, m1, d1] = partes(deTexto, 'A data inicial');
  const [a2, m2, d2] = partes(ateTexto, 'A data final');
  if (deTexto > ateTexto) throw new ValidationError('A data inicial não pode ser posterior à data final');
  if ((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS > INTERVALO_MAXIMO_DIAS) {
    throw new ValidationError(`O intervalo máximo é de ${INTERVALO_MAXIMO_DIAS} dias`);
  }
  return {
    de: deTexto,
    ate: ateTexto,
    inicioIso: new Date(a1, m1 - 1, d1).toISOString(),
    fimIso: new Date(a2, m2 - 1, d2 + 1).toISOString(),
  };
}

/** Chave local de agrupamento de um instante ISO: `dia` → AAAA-MM-DD, `mes` → AAAA-MM, `ano` → AAAA. */
function chaveLocal(iso, agrupar = 'dia') {
  const d = new Date(iso);
  if (agrupar === 'ano') return String(d.getFullYear());
  if (agrupar === 'mes') return `${d.getFullYear()}-${dois(d.getMonth() + 1)}`;
  return textoLocal(d);
}

/** Agrupa itens por chave; o Map resultante sai em ordem crescente de chave. */
function agruparPorChave(itens, chaveDe) {
  const grupos = new Map();
  for (const item of itens) {
    const k = chaveDe(item);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(item);
  }
  return new Map([...grupos.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = { resolverPeriodo, chaveLocal, agruparPorChave, INTERVALO_MAXIMO_DIAS };
