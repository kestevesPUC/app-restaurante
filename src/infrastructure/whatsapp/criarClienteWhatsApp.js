'use strict';

/**
 * Cria o cliente real do whatsapp-web.js. O pacote só é carregado aqui (preguiçoso), para que testes e o
 * modo sem Electron nunca exijam o pacote nem um navegador.
 * Interface devolvida: { on, initialize, sendMessage, getNumberId, destroy, info }.
 * @param {{dataPath: string, navegador: string}} opcoes `dataPath` fica fora do banco e do backup.
 */
function criarClienteWhatsApp({ dataPath, navegador }) {
  const { Client, LocalAuth } = require('whatsapp-web.js'); // eslint-disable-line global-require
  return new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: { executablePath: navegador, headless: true, args: ['--no-sandbox'] },
  });
}

module.exports = criarClienteWhatsApp;
module.exports.criarClienteWhatsApp = criarClienteWhatsApp;
