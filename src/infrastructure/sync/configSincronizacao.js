'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Lê a configuração da cópia para a nuvem. Variáveis de ambiente têm prioridade; depois vêm os arquivos
 * `.env` das `pastas` (ex.: raiz do projeto em desenvolvimento; AppData\pdv-restaurante no app instalado).
 * Sem SUPABASE_URL e SUPABASE_SECRET_KEY a cópia fica desligada (devolve `null`).
 * @returns {{url: string, chave: string, intervaloMs: number}|null}
 */
function lerConfiguracaoSincronizacao({ pastas = [], env = process.env } = {}) {
  const lidos = {};
  for (const pasta of pastas) {
    try {
      const arquivo = path.join(pasta, '.env');
      if (!fs.existsSync(arquivo)) continue;
      for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
        if (m && !(m[1] in lidos)) lidos[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch { /* arquivo ilegível: ignora */ }
  }
  const pega = (nome) => env[nome] || lidos[nome] || '';
  const url = pega('SUPABASE_URL');
  const chave = pega('SUPABASE_SECRET_KEY');
  if (!url || !chave) return null;
  const segundos = Number(pega('SYNC_INTERVALO'));
  return { url, chave, intervaloMs: (Number.isFinite(segundos) && segundos >= 1 ? segundos : 5) * 1000, puxar: pega('SYNC_PUXAR') !== '0' };
}

/** Guarda em arquivo o que já foi enviado, para não reenviar tudo a cada abertura do app. */
function estadoEmArquivo(arquivo) {
  let estado = {};
  try { estado = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* primeira vez */ }
  return { estado, salvarEstado: (novo) => fs.writeFileSync(arquivo, JSON.stringify(novo)) };
}

module.exports = { lerConfiguracaoSincronizacao, estadoEmArquivo };
