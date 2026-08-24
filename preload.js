const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadRoutes: () => ipcRenderer.invoke('load-routes'),
  search: (routeIndex, date) => ipcRenderer.invoke('search', { routeIndex, date }),
});
