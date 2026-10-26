'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Localiza o Microsoft Edge já instalado (o app não baixa o Chromium do Puppeteer).
 * Um caminho configurado (`whatsapp.navegador`) tem prioridade, se existir.
 * @returns {string|null} caminho do msedge.exe ou null
 */
function detectarNavegador({ existe = fs.existsSync, env = process.env, configurado = '' } = {}) {
  if (typeof configurado === 'string' && configurado.trim() && existe(configurado.trim())) return configurado.trim();
  for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles]) {
    if (!base) continue;
    const candidato = path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (existe(candidato)) return candidato;
  }
  return null;
}

module.exports = { detectarNavegador };
