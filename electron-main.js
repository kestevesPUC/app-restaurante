'use strict';
// Casca desktop (Electron): sobe o servidor local numa porta livre e abre a janela do app.
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildApplication } = require('./src/compositionRoot');
const DailyBackup = require('./src/infrastructure/backup/DailyBackup');

// PASTA DE DADOS FIXA — não altere. O banco (pdv.sqlite) fica aqui e o instalador NÃO a remove ao desinstalar,
// então reinstalar ou atualizar mantém todos os dados. (--user-data-dir ou PDV_USER_DATA servem só para testes.)
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', process.env.PDV_USER_DATA || path.join(app.getPath('appData'), 'pdv-restaurante'));
}

const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();

const SEIS_HORAS = 6 * 60 * 60 * 1000;
let win;
let application;
let encerrando = false;
const timers = [];

/** Atualizador real só no app instalado e com canal configurado (app-update.yml gerado pelo build). */
function criarAtualizador() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return undefined;
  const { autoUpdater } = require('electron-updater'); // eslint-disable-line global-require
  const ElectronUpdater = require('./src/desktop/ElectronUpdater'); // eslint-disable-line global-require
  return new ElectronUpdater({
    autoUpdater,
    onDownloaded: async (versao) => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info', title: 'Atualização disponível', message: `A versão ${versao} foi baixada.`,
        detail: 'Reinicie o programa para instalar. Se preferir, ela será instalada ao fechar o programa.',
        buttons: ['Reiniciar e instalar agora', 'Depois'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    },
  });
}

function agendarManutencao(atualizador) {
  const backup = new DailyBackup({ db: application.db, pasta: path.join(app.getPath('documents'), 'PDV Restaurante Backups') });
  const rodar = () => { try { backup.run(); } catch (error) { console.error('[backup]', error.message); } };
  rodar();
  timers.push(setInterval(rodar, SEIS_HORAS));
  if (atualizador) {
    timers.push(setTimeout(() => atualizador.check(), 5_000));
    timers.push(setInterval(() => atualizador.check(), SEIS_HORAS));
  }
}

async function iniciar() {
  const dbPath = path.join(app.getPath('userData'), 'pdv.sqlite');
  const atualizador = criarAtualizador();
  application = buildApplication({ dbPath });
  const inicial = application.services.adminBootstrap.run();
  const { port } = await application.server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;

  if (inicial) {
    await dialog.showMessageBox({
      type: 'info', title: 'Primeiro acesso', message: 'Usuário inicial criado',
      detail: `Usuário: ADMIN\nSenha provisória: ${inicial.senhaProvisoria}\n\nA troca da senha é obrigatória no primeiro acesso.`,
    });
  }

  // Sem opções de desenvolvedor no app empacotado.
  if (app.isPackaged) Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    icon: path.join(__dirname, 'build', 'icon.png'), width: 1280, height: 820, minWidth: 360, minHeight: 480,
    title: `PDV Restaurante · v${app.getVersion()}`, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url: alvo }) => {
    if (/^https?:\/\//i.test(alvo)) shell.openExternal(alvo);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, alvo) => {
    if (alvo !== url && !alvo.startsWith(`${url}/`)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(alvo)) shell.openExternal(alvo);
    }
  });
  win.loadURL(url);
  agendarManutencao(atualizador);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

if (instanciaUnica) {
  app.whenReady().then(iniciar).catch((error) => {
    dialog.showErrorBox('PDV Restaurante', `Não foi possível iniciar: ${error.message}`);
    app.quit();
  });
}

// Encerra com limpeza: para os timers, fecha o servidor e o banco antes de sair.
app.on('before-quit', (event) => {
  if (encerrando || !application) return;
  event.preventDefault();
  encerrando = true;
  timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  application.close().catch((error) => console.error('[encerrar]', error.message)).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
