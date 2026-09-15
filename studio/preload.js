// Minimal, safe bridge between the sidebar UI and the main process.
// The renderer never gets Node access — only these three capabilities.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  navigate: (tab) => ipcRenderer.send('studio:navigate', tab),
  openLiveSite: () => ipcRenderer.send('studio:open-live-site'),
  openClaude: () => ipcRenderer.send('studio:open-claude'),
  onStatus: (callback) =>
    ipcRenderer.on('studio:status', (_event, status) => callback(status)),
  publish: () => ipcRenderer.invoke('studio:publish'),
  onPublishProgress: (callback) =>
    ipcRenderer.on('studio:publish-progress', (_event, progress) => callback(progress)),
  gitHubStatus: () => ipcRenderer.invoke('studio:github-status'),
  saveGitHub: (config) => ipcRenderer.invoke('studio:save-github', config),
});
