const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { readRoutes, readSites } = require('./lib/dataStore');
const { buildSearchUrl } = require('./lib/buildSearchUrl');

// Packaged (electron-builder, "dir" target): data/ sits next to the .exe.
// Dev mode (npm start): data/ sits next to this file.
function getDataDir() {
  return app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'data')
    : path.join(__dirname, 'data');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 480,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('load-routes', async () => {
    try {
      return { ok: true, routes: await readRoutes(getDataDir()) };
    } catch (err) {
      return { ok: false, error: `读取 routes.xlsx 失败：${err.message}` };
    }
  });

  ipcMain.handle('search', async (_event, { routeIndex, date }) => {
    try {
      const [routes, sites] = await Promise.all([readRoutes(getDataDir()), readSites(getDataDir())]);
      const route = routes[routeIndex];
      if (!route) throw new Error('未找到选中的航线，请重新选择');
      if (!date) throw new Error('请先选择出发日期');

      const opened = [];
      for (const site of sites) {
        const { url, isTemplated } = buildSearchUrl(site, route, date);
        if (!url) continue;
        await shell.openExternal(url);
        opened.push({ name: site.name, isTemplated });
      }
      return { ok: true, opened, route: route.od };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
