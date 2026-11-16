'use strict';
// Casca desktop (Electron): sobe o servidor local numa porta livre e abre a janela do app.
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildApplication } = require('./src/compositionRoot');
const DailyBackup = require('./src/infrastructure/backup/DailyBackup');
const { executarBackupSeguro } = require('./src/desktop/executarBackupSeguro');
const { protegerNavegacao } = require('./src/desktop/protegerNavegacao');
const { comLimite } = require('./src/desktop/comLimite');
const { tituloDaJanela } = require('./src/desktop/titulo');
const JsonLineLogger = require('./src/infrastructure/logging/JsonLineLogger');
const { lerConfiguracaoSincronizacao, estadoEmArquivo } = require('./src/infrastructure/sync/configSincronizacao');
const pacote = require('./package.json');
const { detectarNavegador } = require('./src/infrastructure/whatsapp/detectarNavegador');

// PASTA DE DADOS FIXA — não altere. O banco (pdv.sqlite) fica aqui e o instalador NÃO a remove ao desinstalar,
// então reinstalar ou atualizar mantém todos os dados. (--user-data-dir ou PDV_USER_DATA servem só para testes.)
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', process.env.PDV_USER_DATA || path.join(app.getPath('appData'), 'pdv-restaurante'));
}

const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();

const SEIS_HORAS = 6 * 60 * 60 * 1000;
const LIMITE_PARAR_WHATSAPP_MS = 5000;
let win;
let application;
let logger = console; // vira o JsonLineLogger em iniciar()
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
  let avisou = false;
  const rodar = () => executarBackupSeguro(backup, {
    logger,
    aoFalhar: (error) => {
      if (avisou) return;
      avisou = true; // um aviso por execução do app; não bloqueante
      dialog.showMessageBox(win, {
        type: 'warning', title: 'Backup não realizado', message: 'Não foi possível gravar o backup diário.',
        detail: `${error.message}\n\nVerifique a pasta Documentos\\PDV Restaurante Backups (permissão, espaço, OneDrive).`,
      }).catch(() => {});
    },
  });
  const rodarComLog = () => { const r = rodar(); logger.info?.(r ? 'backup diário concluído' : 'backup diário não realizado'); return r; };
  rodarComLog();
  timers.push(setInterval(rodarComLog, SEIS_HORAS));
  if (atualizador) {
    timers.push(setTimeout(() => atualizador.check(), 5_000));
    timers.push(setInterval(() => atualizador.check(), SEIS_HORAS));
  }
}

async function iniciar() {
  const dbPath = path.join(app.getPath('userData'), 'pdv.sqlite');
  logger = new JsonLineLogger({ pasta: path.join(app.getPath('userData'), 'logs'), relogio: Date.now });
  logger.info('aplicativo iniciado', { versao: app.getVersion() });
  const atualizador = criarAtualizador();
  // Sessão do WhatsApp em userData: fora do banco e do backup. O Edge instalado é o navegador (nada é baixado).
  const whatsapp = { habilitado: true, dataPath: path.join(app.getPath('userData'), 'whatsapp-session'), navegador: null };
  // Cópia para a nuvem (opcional): precisa de SUPABASE_URL e SUPABASE_SECRET_KEY em um .env na pasta de dados do app.
  const nuvem = lerConfiguracaoSincronizacao({ pastas: [app.getPath('userData'), __dirname] });
  const sincronizacao = nuvem && { ...nuvem, ...estadoEmArquivo(path.join(app.getPath('userData'), 'sync-postgres-estado.json')) };
  application = buildApplication({ dbPath, whatsapp, logger, sincronizacao });
  whatsapp.navegador = detectarNavegador({ configurado: application.services.config.get('whatsapp.navegador') });
  const inicial = application.services.adminBootstrap.run();
  const { port } = await application.server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  application.services.sincronizacao.iniciar();

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
    title: tituloDaJanela(pacote.productName || 'PDV Restaurante', app.getVersion()), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  protegerNavegacao(win.webContents, url, (alvo) => shell.openExternal(alvo));
  win.loadURL(url);
  application.bus.subscribe(({ tipo, dados }) => { if (tipo === 'whatsapp') logger.info('estado do WhatsApp', { estado: dados.estado }); });
  agendarManutencao(atualizador);
  // Só depois da janela abrir; sem o Edge o estado fica DESCONECTADO e GET /api/whatsapp/estado informa o motivo.
  if (whatsapp.navegador) application.mensageiro.iniciar().catch((error) => logger.error('falha ao iniciar o WhatsApp', { motivo: error.message }));
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
  comLimite(Promise.resolve().then(() => application.mensageiro.parar?.()), LIMITE_PARAR_WHATSAPP_MS, { rotulo: 'whatsapp', logger })
    .then(() => application.close()).catch((error) => logger.error('falha ao encerrar', { motivo: error.message }))
    .finally(() => { logger.info('aplicativo encerrado'); logger.fechar?.().finally(() => app.quit()); });
});
app.on('window-all-closed', () => app.quit());
