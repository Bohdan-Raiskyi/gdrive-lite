const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Файлове сховище",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

Menu.setApplicationMenu(null);

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
}

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

ipcMain.handle("dialog:save-file", async (_event, suggestedName, base64Data) => {
  const result = await dialog.showSaveDialog({ defaultPath: suggestedName });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(base64Data, "base64"));
  return result.filePath;
});

ipcMain.handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("fs:list-directory", async (_event, dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(dirPath, entry.name);
    const [stat, buffer] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)]);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    result.push({ name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, hash });
  }
  return result;
});

ipcMain.handle("fs:read-file", async (_event, dirPath, name) => {
  const buffer = await fs.readFile(path.join(dirPath, name));
  return { name, data: buffer.toString("base64") };
});

ipcMain.handle("fs:write-file", async (_event, dirPath, name, base64Data) => {
  await fs.writeFile(path.join(dirPath, sanitizeName(name)), Buffer.from(base64Data, "base64"));
  return true;
});

ipcMain.handle("fs:delete-file", async (_event, dirPath, name) => {
  try {
    await fs.unlink(path.join(dirPath, sanitizeName(name)));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });