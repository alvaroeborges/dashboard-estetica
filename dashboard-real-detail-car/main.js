/* ==========================================================
   RDC REAL DETAIL CAR — APLICATIVO DESKTOP (Electron)
   Abre o painel (index.html) numa janela própria. Os dados
   continuam no localStorage, agora guardado na pasta do app.
   ========================================================== */
'use strict';

const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const ICON = path.join(__dirname, 'img', 'logo-rdc.jpg');
const WHATSAPP_WEB = 'https://web.whatsapp.com';

let mainWindow = null;
let whatsappWindow = null;

/** O WhatsApp Web recusa navegadores que se identificam como Electron. */
function chromeUserAgent(userAgent) {
  return userAgent.replace(/\s(Electron|rdc-painel)\/\S+/g, '');
}

/** Janela única do WhatsApp Web: o login (QR Code) fica salvo e a janela é reaproveitada. */
function openWhatsappWeb(url) {
  if (whatsappWindow && !whatsappWindow.isDestroyed()) {
    whatsappWindow.loadURL(url);
    if (whatsappWindow.isMinimized()) whatsappWindow.restore();
    whatsappWindow.focus();
    return;
  }
  whatsappWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'WhatsApp · RDC',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#08080a',
  });
  const agent = chromeUserAgent(whatsappWindow.webContents.getUserAgent());
  whatsappWindow.webContents.setUserAgent(agent);
  whatsappWindow.webContents.setWindowOpenHandler(({ url: link }) => {
    shell.openExternal(link);
    return { action: 'deny' };
  });
  whatsappWindow.on('closed', () => { whatsappWindow = null; });
  whatsappWindow.loadURL(url, { userAgent: agent });
}

/** Qualquer link que não seja o próprio painel sai do app. */
function handleExternal(url) {
  if (url.startsWith(WHATSAPP_WEB)) openWhatsappWeb(url);
  else if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
}

/**
 * Atualização automática pelo GitHub Releases: baixa em segundo plano
 * e pergunta se pode reiniciar. Sem internet, o app segue normalmente.
 */
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Atualização disponível',
      message: `A versão ${info.version} do RDC Painel está pronta.`,
      detail: 'Reinicie para aplicar agora. Seus dados são mantidos. '
        + 'Se preferir, a atualização é instalada quando o app for fechado.',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (error) => console.error('[RDC] Falha ao verificar atualização:', error));

  autoUpdater.checkForUpdates().catch(() => { /* sem internet: tenta na próxima abertura */ });
  // Para quem deixa o app aberto o dia todo
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    title: 'RDC · Painel de Gestão',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#08080a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    handleExternal(url);
    return { action: 'deny' };
  });
  // Ex.: modo "aplicativo" do WhatsApp usa window.location = "whatsapp://..."
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    handleExternal(url);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Uma única instância: abrir o atalho de novo só traz a janela para frente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    setupAutoUpdate();
  });

  app.on('window-all-closed', () => app.quit());
}
