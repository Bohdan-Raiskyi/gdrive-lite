const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  saveFile: (suggestedName, base64Data) => ipcRenderer.invoke("dialog:save-file", suggestedName, base64Data),
  pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
  listDirectory: (dirPath) => ipcRenderer.invoke("fs:list-directory", dirPath),
  readFile: (dirPath, name) => ipcRenderer.invoke("fs:read-file", dirPath, name),
  writeFile: (dirPath, name, base64Data) => ipcRenderer.invoke("fs:write-file", dirPath, name, base64Data),
  deleteFile: (dirPath, name) => ipcRenderer.invoke("fs:delete-file", dirPath, name)
});