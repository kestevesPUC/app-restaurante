'use strict';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutraliza "injeção de fórmula" em planilhas: texto iniciado por = + - @ tab ou CR ganha apóstrofo. */
function textoSeguro(texto) {
  const s = String(texto);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

module.exports = textoSeguro;
