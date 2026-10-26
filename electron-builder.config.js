'use strict';
// Configuração de empacotamento (electron-builder).
//
// Canal de atualização: crie release.config.json (um bloco `publish` do electron-builder). Sem esse arquivo o
// instalador é gerado normalmente, porém sem atualização automática.
const fs = require('node:fs');
const path = require('node:path');

const arquivoRelease = path.join(__dirname, 'release.config.json');
const publish = fs.existsSync(arquivoRelease) ? [JSON.parse(fs.readFileSync(arquivoRelease, 'utf8'))] : undefined;

module.exports = {
  appId: 'br.com.pdvrestaurante.app',
  productName: 'PDV Restaurante',
  // Lista PERMITIDA (nada além disto entra no instalador): evita empacotar .env, dados, docs e testes.
  // As dependências de produção (node_modules) são incluídas automaticamente pelo electron-builder.
  files: ['electron-main.js', 'package.json', 'public/**/*', 'src/**/*'],
  directories: { output: 'dist' },
  ...(publish && { publish }),
  win: {
    target: ['nsis'],
    icon: 'build/icon.png',
  },
  nsis: {
    // Instalação por usuário (sem pedir administrador); desinstalar NÃO apaga os dados (AppData\pdv-restaurante).
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'PDV Restaurante',
    deleteAppDataOnUninstall: false,
    artifactName: 'PDV-Restaurante-Setup-${version}.${ext}',
    language: '1046', // português (Brasil)
  },
};
