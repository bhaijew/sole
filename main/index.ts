import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, powerMonitor } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Bonjour } from 'bonjour-service';
import { initDatabase, closeDatabase } from './db';
import { startServer, stopServer, getLocalIP, isServerRunning } from './server';
import { startKdsServer, stopKdsServer, getKdsPort, isKdsServerRunning } from './kds-server';
import { initPrinter, printReceipt, printKOT } from './printers/thermal';
import { registerIpcHandlers } from './ipc';
import { initCloudSync, stopRealtimeOrderListener, stopCloudSyncIntervals } from './services/cloud-sync';
import { stopKdsIntervals } from './services/kds';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import {
  getUpdateProgressState,
  setUpdateProgressState,
  setCheckForUpdatesHandler,
  setQuitAndInstallHandler,
} from './services/updater-state';


log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
const logPath = log.transports.file.getFile().path.replace(/[^\/\\]+$/, '');
console.log('[Log] Log files location:', logPath);

let updateAvailable = false;
let updateDownloaded = false;
let isManualCheck = false;

function setupAutoUpdater(): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true; // Auto-download in background without prompting
  autoUpdater.autoInstallOnAppQuit = true;

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'bhaijew',
      repo: 'sole',
    });
  } catch (feedErr) {
    console.warn('[Update] Could not set feed URL:', feedErr);
  }

  setUpdateProgressState({
    version: app.getVersion(),
  });

  setCheckForUpdatesHandler((manual) => {
    checkForUpdates(manual);
  });

  setQuitAndInstallHandler(() => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('[Update] Checking for updates on GitHub...');
    setUpdateProgressState({ status: 'checking', error: null, lastChecked: new Date().toISOString() });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Update] Update available:', info.version);
    updateAvailable = true;
    isManualCheck = false;
    setUpdateProgressState({
      status: 'available',
      version: app.getVersion(),
      newVersion: info.version,
      releaseDate: info.releaseDate as string || null,
      releaseNotes: (typeof info.releaseNotes === 'string' ? info.releaseNotes : null),
      percent: 0,
      error: null,
      lastChecked: new Date().toISOString(),
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
    console.log('[Update] Downloading update in background...');
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Update] No updates available');
    setUpdateProgressState({
      status: 'up-to-date',
      version: app.getVersion(),
      error: null,
      lastChecked: new Date().toISOString(),
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
    if (isManualCheck) {
      isManualCheck = false;
      dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: 'Sole What is up to date!',
        detail: `You are running the latest version (${app.getVersion()}).`,
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent * 10) / 10;
    const transferredMb = (progress.transferred / 1024 / 1024).toFixed(1);
    const totalMb = (progress.total / 1024 / 1024).toFixed(1);
    const speedMb = (progress.bytesPerSecond / 1024 / 1024).toFixed(1);

    console.log(`[Update] Download progress: ${percent}% (${transferredMb}MB / ${totalMb}MB @ ${speedMb}MB/s)`);

    setUpdateProgressState({
      status: 'downloading',
      percent,
      transferred: progress.transferred,
      total: progress.total,
      transferredMb,
      totalMb,
      speedMb,
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Update] Download complete:', info.version);
    updateDownloaded = true;
    setUpdateProgressState({
      status: 'ready-to-install',
      version: app.getVersion(),
      newVersion: info.version,
      percent: 100,
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Sole What v${info.version} ready to install!`,
      detail: `Version ${info.version} has been downloaded.\n\nRestart now to apply the update, or it will be applied automatically when you close the app.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    // 404 means no release artifacts published yet — treat as "up to date", not an error.
    const is404 = err.message?.includes('404') || err.message?.includes('Cannot find latest');
    if (is404) {
      log.debug('[Update] No release artifacts found (404) — skipping update');
      setUpdateProgressState({
        status: 'up-to-date',
        version: app.getVersion(),
        error: null,
        lastChecked: new Date().toISOString(),
      });
      mainWindow?.webContents.send('update-status', getUpdateProgressState());
      if (isManualCheck) {
        isManualCheck = false;
        dialog.showMessageBox({
          type: 'info',
          title: 'Check for Updates',
          message: 'Sole What is up to date!',
          detail: `You are running the latest version (${app.getVersion()}).`,
          buttons: ['OK'],
        });
      }
    } else {
      log.error('[Update] Error:', err);
      setUpdateProgressState({
        status: 'error',
        version: app.getVersion(),
        error: err.message,
        lastChecked: new Date().toISOString(),
      });
      mainWindow?.webContents.send('update-status', getUpdateProgressState());
      if (isManualCheck) {
        isManualCheck = false;
        dialog.showMessageBox({
          type: 'error',
          title: 'Update Error',
          message: 'Failed to check for updates.',
          detail: err.message,
          buttons: ['OK'],
        });
      }
    }
  });
}

function checkForUpdates(manual = false): void {
  if (isDev) {
    setUpdateProgressState({
      status: 'up-to-date',
      version: app.getVersion(),
      lastChecked: new Date().toISOString(),
      error: null,
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Check for Updates',
        message: 'Running in development mode.',
        detail: `App is in dev mode (${app.getVersion()}). Auto-updates are active in production builds.`,
        buttons: ['OK'],
      });
    }
    return;
  }
  isManualCheck = manual;
  setUpdateProgressState({
    status: 'checking',
    error: null,
    lastChecked: new Date().toISOString(),
  });
  mainWindow?.webContents.send('update-status', getUpdateProgressState());
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Update] Check failed:', err);
    setUpdateProgressState({
      status: 'error',
      version: app.getVersion(),
      error: err.message,
    });
    mainWindow?.webContents.send('update-status', getUpdateProgressState());
  });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bonjour: Bonjour | null = null;
let isQuitting = false;
let isCleaningUp = false;

export function cleanupAndExit(): void {
  if (isCleaningUp) return;
  isCleaningUp = true;
  isQuitting = true;

  console.log('[Flo] Cleaning up resources before exit...');

  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch (err) {
    console.error('[Flo] Error destroying tray:', err);
  }

  try {
    stopCloudSyncIntervals();
  } catch (err) {
    console.error('[Flo] Error stopping cloud sync:', err);
  }

  try {
    stopKdsIntervals();
  } catch (err) {
    console.error('[Flo] Error stopping KDS intervals:', err);
  }

  try {
    stopMdns();
  } catch (err) {
    console.error('[Flo] Error stopping mDNS:', err);
  }

  try {
    stopKdsServer();
  } catch (err) {
    console.error('[Flo] Error stopping KDS server:', err);
  }

  try {
    stopServer();
  } catch (err) {
    console.error('[Flo] Error stopping server:', err);
  }

  try {
    closeDatabase();
  } catch (err) {
    console.error('[Flo] Error closing database:', err);
  }

  console.log('[Flo] Resources cleaned up. Terminating process...');
  setTimeout(() => {
    app.exit(0);
  }, 100).unref();
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PORT = parseInt(process.env.PORT || '3001', 10);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Sole-What',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // Prevents renderer freeze & white screen when laptop lid is closed
    },
    show: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Always load from the embedded Express server (serves static Next.js export).
  // This avoids file:// protocol issues and keeps dev/prod behaviour identical.
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Allow target="_blank" links to open new windows for local URLs (e.g. the KDS page).
  // External URLs are sent to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isLocal = url.startsWith(`http://localhost:${PORT}`) ||
                    url.startsWith(`http://127.0.0.1:${PORT}`) ||
                    url.startsWith(`http://${getLocalIP()}:${PORT}`);
    if (isLocal) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 800,
          title: 'Sole-What - Kitchen Display',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (process.platform === 'darwin') {
        event.preventDefault();
        mainWindow?.hide();
      } else {
        cleanupAndExit();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('[Window] Renderer process gone:', details.reason);
    console.error('[Window] Renderer process gone:', details.reason);
    
    if (details.reason !== 'clean-exit') {
      dialog.showMessageBox({
        type: 'error',
        title: 'App Crashed',
        message: 'The app crashed and will restart.',
        detail: `Reason: ${details.reason}`,
        buttons: ['OK'],
      }).then(() => {
        mainWindow?.destroy();
        mainWindow = null;
        createWindow();
      });
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('[Window] Failed to load:', errorCode, errorDescription);
    console.error('[Window] Failed to load:', errorCode, errorDescription);
    // Auto-retry reload if local server was waking up
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://localhost:${PORT}`);
      }
    }, 1500);
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('[Window] Window became unresponsive after idle/sleep, attempting reload...');
    console.warn('[Window] Window became unresponsive after idle/sleep, attempting reload...');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }, 1000);
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[Window] Window became responsive again');
  });
}

// PowerMonitor: Automatically recover from laptop sleep / lid closed
powerMonitor.on('resume', () => {
  log.info('[PowerMonitor] System resumed from sleep / laptop lid opened');
  console.log('[PowerMonitor] System resumed from sleep / laptop lid opened');
  if (mainWindow && !mainWindow.isDestroyed()) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[PowerMonitor] Refreshing window surface to eliminate white screen');
        mainWindow.webContents.invalidate();
        mainWindow.webContents.reloadIgnoringCache();
      }
    }, 1000);
  }
});

powerMonitor.on('unlock-screen', () => {
  log.info('[PowerMonitor] Screen unlocked');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.invalidate();
  }
});

app.on('child-process-gone', (event, details) => {
  if (details.type === 'GPU') {
    log.warn('[App] GPU process gone:', details.reason);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  }
});

function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, '../../assets/icon.png')
    : path.join(process.resourcesPath, 'assets/icon.png');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Sole What', click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }},
      { type: 'separator' },
      { label: 'Quit', click: () => { cleanupAndExit(); } },
    ]);

    tray.setToolTip('Sole What POS');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  } catch {
    console.log('[Tray] Icon not found, skipping tray');
  }
}

function startMdns(): void {
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: 'Flo',
      type: 'http',
      port: PORT,
      host: 'flo',   // resolves as flo.local on the LAN
      txt: { version: app.getVersion(), kds: `/kds`, kds_port: String(getKdsPort()) },
    });
    const ip = getLocalIP();
    console.log(`[mDNS] Advertising flo.local:${PORT}  (IP fallback: http://${ip}:${PORT})`);
    console.log(`[mDNS] KDS available at http://flo.local:${getKdsPort()}  (IP fallback: http://${ip}:${getKdsPort()})`);
  } catch (err) {
    console.warn('[mDNS] Could not start Bonjour:', err);
  }
}

function stopMdns(): void {
  if (bonjour) {
    try {
      bonjour.unpublishAll(() => {
        try {
          bonjour?.destroy();
        } catch {}
      });
    } catch (err) {
      console.warn('[mDNS] Error stopping Bonjour:', err);
    }
    bonjour = null;
  }
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Order', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-order') },
        { label: 'Quick Search', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('quick-search') },
        { type: 'separator' },
        { label: 'Backup Database', click: () => mainWindow?.webContents.send('backup-database') },
        { label: 'Restore Backup', click: () => mainWindow?.webContents.send('restore-backup') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => { cleanupAndExit(); } },
      ],
    },
    {
      label: 'Orders',
      submenu: [
        { label: 'View All Orders', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('view-orders') },
      ],
    },
    {
      label: 'Reports',
      submenu: [
        { label: 'Daily Summary', click: () => mainWindow?.webContents.send('report-daily') },
        { label: 'Sales Report', click: () => mainWindow?.webContents.send('report-sales') },
        { label: 'X Report', click: () => mainWindow?.webContents.send('report-x') },
        { label: 'Z Report', click: () => mainWindow?.webContents.send('report-z') },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'Business Settings', click: () => mainWindow?.webContents.send('settings-business') },
        { label: 'Tax Settings', click: () => mainWindow?.webContents.send('settings-tax') },
        { label: 'Printer Setup', click: () => mainWindow?.webContents.send('settings-printer') },
        { label: 'Kitchen Stations', click: () => mainWindow?.webContents.send('settings-kitchen') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Sole What', click: () => showAbout() },
        { label: 'Check for Updates', click: () => checkForUpdates(true) },
      ],
    },
  ];

  if (isDev) {
    template.push({
      label: 'Developer',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAbout(): void {
  const ip = getLocalIP();
  const kdsPort = getKdsPort();
  dialog.showMessageBox({
    type: 'info',
    title: 'About Sole What',
    message: 'Sole What POS',
    detail: [
      `Version: ${app.getVersion()}`,
      `Electron: ${process.versions.electron}`,
      `Node: ${process.versions.node}`,
      '',
      'A self-hosted, offline-first Point of Sale system.',
      'Your data stays yours.',
      '',
      `POS URL: http://flo.local:${PORT}`,
      `KDS URL: http://flo.local:${kdsPort}`,
      '',
      `KDS IP fallback: http://${ip}:${kdsPort}`,
    ].join('\n'),
  });
}

async function initialize(): Promise<void> {
  try {
    console.log('[Flo] Initializing...');

    console.log('[Flo] Initializing database...');
    initDatabase();

    console.log('[Flo] Starting local server...');
    await startServer();

    console.log('[Flo] Starting KDS server on port 3002...');
    await startKdsServer();

    console.log('[Flo] Starting mDNS advertisement...');
    startMdns();

    console.log('[Flo] Initializing printer...');
    await initPrinter();

    console.log('[Flo] Registering IPC handlers...');
    registerIpcHandlers();

    ipcMain.handle('get-update-status', () => getUpdateProgressState());

    ipcMain.handle('check-for-updates', () => {
      checkForUpdates(true);
      return getUpdateProgressState();
    });

    ipcMain.handle('quit-and-install', () => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    });

    ipcMain.handle('get-status', () => {
      const mem = process.memoryUsage();
      return {
        server: isServerRunning() ? 'running' : 'stopped',
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss: Math.round(mem.rss / 1024 / 1024),
        },
        uptime: process.uptime(),
        port: PORT,
      };
    });

    console.log('[Flo] Creating window...');
    createWindow();
    createTray();
    createMenu();
    setupAutoUpdater();

    if (!isDev) {
      setTimeout(() => checkForUpdates(), 5000);
      // Automatically check for new updates every 30 minutes
      setInterval(() => checkForUpdates(), 30 * 60 * 1000);
    }

    console.log('[Flo] Ready!');
    await initCloudSync();
  } catch (error) {
    console.error('[Flo] Initialization error:', error);
    dialog.showErrorBox('Initialization Error', `Failed to start Flo: ${error}`);
    app.quit();
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Flo] Another instance is already running. Quitting duplicate.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(initialize);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndExit();
  }
});

app.on('activate', () => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  cleanupAndExit();
});

app.on('will-quit', () => {
  cleanupAndExit();
});

process.on('uncaughtException', (error) => {
  log.error('[Flo] Uncaught exception:', error);
  console.error('[Flo] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('[Flo] Unhandled rejection:', reason);
  console.error('[Flo] Unhandled rejection:', reason);
});
