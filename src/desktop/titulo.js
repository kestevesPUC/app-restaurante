'use strict';

/** Título da janela: "PDV Restaurante — v0.1.0" (só o nome quando a versão falta). */
function tituloDaJanela(nome, versao) {
  const n = String(nome ?? '').trim();
  const v = String(versao ?? '').trim();
  return v ? `${n} — v${v}` : n;
}

module.exports = { tituloDaJanela };
