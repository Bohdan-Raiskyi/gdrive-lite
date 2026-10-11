import { listFiles, uploadOrReplace, updateFile, downloadFileBlob, getCurrentUserId } from "./api.js";

function dirKey(userId) { return `syncDir:${userId}`; }
function stateKey(userId, spaceId) { return `syncState:${userId}:${spaceId}`; }

// base64 -> File (для передачі у FormData при вивантаженні з локальної папки)
function base64ToFile(name, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name);
}

// Blob -> base64 (для запису файлу, отриманого з сервера, у локальну папку)
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Шлях зберігається лише локально: на відміну від вебу, тут це реальний шлях на диску,
// валідний лише на цьому комп'ютері, тому надсилати його на сервер немає сенсу.
export function getSavedDirectory() {
  const userId = getCurrentUserId();
  if (!userId) return null;
  return localStorage.getItem(dirKey(userId));
}

export async function pickSyncDirectory() {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("Спочатку увійдіть у систему");
  const dirPath = await window.desktop.pickDirectory();
  if (!dirPath) return null; // користувач скасував вибір
  localStorage.setItem(dirKey(userId), dirPath);
  return dirPath;
}

function loadState(userId, spaceId) {
  try {
    return JSON.parse(localStorage.getItem(stateKey(userId, spaceId)) || "{}");
  } catch {
    return {};
  }
}
function saveState(userId, spaceId, state) {
  localStorage.setItem(stateKey(userId, spaceId), JSON.stringify(state));
}

function pickNewestByName(list) {
  const map = new Map();
  for (const f of list) {
    const prev = map.get(f.name);
    if (!prev || Date.parse(f.modified_at) > Date.parse(prev.modified_at)) map.set(f.name, f);
  }
  return map;
}

// base - хеш, спільний після минулої синхронізації. Та сама логіка, що і в web-client/src/sync.js
function decideDirection(base, l, r) {
  const localChanged = base === undefined || l.hash !== base;
  const remoteChanged = base === undefined || r.content_hash !== base;
  if (localChanged && !remoteChanged) return "upload";
  if (remoteChanged && !localChanged) return "download";
  return l.mtimeMs > Date.parse(r.modified_at) ? "upload" : "download";
}

// Синхронізація лише з власним простором - те саме рішення, що і для веб-клієнта
export async function syncFolder(dirPath, { onError = () => {} } = {}) {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("Немає активного користувача");
  const spaceId = userId;

  const [localList, remoteAll, state] = await Promise.all([
    window.desktop.listDirectory(dirPath),
    listFiles({ filterType: "all" }),
    Promise.resolve(loadState(userId, spaceId))
  ]);

  const local = new Map(localList.map((f) => [f.name, f]));
  const remote = pickNewestByName(remoteAll.filter((f) => f.owner_id === spaceId));

  const newState = { ...state };
  const stats = { uploaded: 0, updatedRemote: 0, downloaded: 0, updatedLocal: 0, skipped: 0, errors: 0 };
  const names = new Set([...local.keys(), ...remote.keys()]);

  for (const name of names) {
    const l = local.get(name);
    const r = remote.get(name);
    try {
      if (l && !r) {
        const { data } = await window.desktop.readFile(dirPath, name);
        const saved = await uploadOrReplace(base64ToFile(name, data), () => false, spaceId);
        if (!saved) throw new Error("вже існує у просторі");
        stats.uploaded++;
        newState[name] = l.hash;
      } else if (!l && r) {
        const blob = await downloadFileBlob(r.id);
        await window.desktop.writeFile(dirPath, name, await blobToBase64(blob));
        stats.downloaded++;
        newState[name] = r.content_hash;
      } else if (l.hash === r.content_hash) {
        stats.skipped++;
        newState[name] = l.hash;
      } else if (decideDirection(state[name], l, r) === "upload") {
        const { data } = await window.desktop.readFile(dirPath, name);
        await updateFile(r.id, base64ToFile(name, data));
        stats.updatedRemote++;
        newState[name] = l.hash;
      } else {
        const blob = await downloadFileBlob(r.id);
        await window.desktop.writeFile(dirPath, name, await blobToBase64(blob));
        stats.updatedLocal++;
        newState[name] = r.content_hash;
      }
    } catch (err) {
      stats.errors++;
      onError(`"${name}": ${err.message}`);
    }
  }

  saveState(userId, spaceId, newState);
  return stats;
}

// Для трекінгу видалень: прибирає файл з локальної синхронізованої папки, якщо він там є
export async function removeLocalFile(dirPath, name) {
  return window.desktop.deleteFile(dirPath, name);
}