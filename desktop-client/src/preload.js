const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  saveFile: (suggestedName, base64Data) => ipcRenderer.invoke("dialog:save-file", suggestedName, base64Data)
});