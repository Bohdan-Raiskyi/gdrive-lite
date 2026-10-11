const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));
  // win.webContents.openDevTools();
}

// Відкриває системний діалог вибору файлів, читає кожен обраний файл
// і повертає масив { name, data } у base64, бо IPC не передає File/Blob напряму.
ipcMain.handle("dialog:pick-files", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
  if (result.canceled) return [];

  const files = [];
  for (const filePath of result.filePaths) {
    const buffer = await fs.readFile(filePath);
    files.push({ name: path.basename(filePath), data: buffer.toString("base64") });
  }
  return files;
});

// Відкриває діалог збереження і записує отримані base64-дані за обраним шляхом
ipcMain.handle("dialog:save-file", async (_event, suggestedName, base64Data) => {
  const result = await dialog.showSaveDialog({ defaultPath: suggestedName });
  if (result.canceled || !result.filePath) return null;

  await fs.writeFile(result.filePath, Buffer.from(base64Data, "base64"));
  return result.filePath;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});