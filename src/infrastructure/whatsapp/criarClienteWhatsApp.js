'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * Ambiente do Edge sem `__COMPAT_LAYER`. O instalador (NSIS) e atalhos com modo de compatibilidade passam essa
 * variável adiante; com ela o msedge.exe se relança, o Puppeteer vê o processo original sair ("Code: 0") e o
 * Edge relançado fica órfão segurando o perfil da sessão — daí em diante toda tentativa falha com
 * "The browser is already running".
 */
function ambienteDoNavegador(env = process.env) {
  const limpo = { ...env };
  for (const chave of Object.keys(limpo)) if (chave.toUpperCase() === '__COMPAT_LAYER') delete limpo[chave];
  return limpo;
}

/**
 * Encerra Edge/Chrome que ainda estejam usando o perfil da sessão (sobra de uma execução anterior que caiu).
 * Só no Windows; qualquer falha é ignorada (no pior caso o Puppeteer informa o erro como antes).
 * @param {string} perfil pasta `--user-data-dir` usada pelo LocalAuth
 */
function encerrarNavegadorOrfao(perfil, { executar = execFile, plataforma = process.platform } = {}) {
  if (plataforma !== 'win32' || !perfil) return Promise.resolve();
  const alvo = path.resolve(perfil).replace(/'/g, "''");
  const script = "$alvo = '" + alvo + "'; Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | "
    + 'Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($alvo, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | '
    + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  return new Promise((resolve) => {
    executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, () => resolve());
  });
}

/**
 * Cria o cliente real do whatsapp-web.js. O pacote só é carregado aqui (preguiçoso), para que testes e o
 * modo sem Electron nunca exijam o pacote nem um navegador.
 * Interface devolvida: { on, initialize, sendMessage, getNumberId, destroy, info }.
 * @param {{dataPath: string, navegador: string}} opcoes `dataPath` fica fora do banco e do backup.
 */
function criarClienteWhatsApp({ dataPath, navegador }) {
  const { Client, LocalAuth } = require('whatsapp-web.js'); // eslint-disable-line global-require
  const cliente = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: { executablePath: navegador, headless: true, args: ['--no-sandbox'], env: ambienteDoNavegador() },
  });
  const inicializar = cliente.initialize.bind(cliente);
  cliente.initialize = async () => {
    await encerrarNavegadorOrfao(path.join(dataPath, 'session')); // pasta de perfil do LocalAuth sem clientId
    return inicializar();
  };
  return cliente;
}

module.exports = criarClienteWhatsApp;
module.exports.criarClienteWhatsApp = criarClienteWhatsApp;
module.exports.ambienteDoNavegador = ambienteDoNavegador;
module.exports.encerrarNavegadorOrfao = encerrarNavegadorOrfao;
