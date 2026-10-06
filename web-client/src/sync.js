import { listFiles, uploadOrReplace, updateFile, downloadFileBlob, getCurrentUserId } from "./api.js";

const DB_NAME = "gdrive-lite";
const STORE = "handles";

// Ключі прив'язані до користувача, щоб папка першого не потрапляла другому
function handleKey(userId) { return `syncDir:${userId}`; }
function stateKey(userId, spaceId) { return `syncState:${userId}:${spaceId}`; }

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Публічні функції для main.js ----------

export async function pickSyncDirectory() {
  if (!window.showDirectoryPicker) {
    throw new Error("Браузер не підтримує вибір папки (потрібен Chrome або Edge)");
  }
  const userId = getCurrentUserId();
  if (!userId) throw new Error("Спочатку увійдіть у систему");
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbPut(handleKey(userId), handle);
  return handle;
}

export function getSavedDirectory() {
  const userId = getCurrentUserId();
  if (!userId) return Promise.resolve(null);
  return idbGet(handleKey(userId));
}

// Має викликатися з обробника кліку (потрібна дія користувача)
export async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

// Синхронізація з конкретним простором. Лише простір, де роль дозволяє запис
export async function syncFolder(dirHandle, { spaceId, onError = () => {} } = {}) {
  const userId = getCurrentUserId();
  if (spaceId !== userId) {
  throw new Error("Синхронізація доступна лише для власного простору");
  }
  if (!userId) throw new Error("Немає активного користувача");

  const [local, remoteAll, state] = await Promise.all([
    readLocalFiles(dirHandle),
    listFiles({ filterType: "all" }),
    idbGet(stateKey(userId, spaceId)).then((s) => s ?? {})
  ]);

  // Беремо лише файли вибраного простору
  const remoteList = remoteAll.filter((f) => f.owner_id === spaceId);
  const remote = pickNewestByName(remoteList);
  const newState = { ...state };
  const stats = { uploaded: 0, updatedRemote: 0, downloaded: 0, updatedLocal: 0, skipped: 0, errors: 0 };
  const names = new Set([...local.keys(), ...remote.keys()]);

  for (const name of names) {
    const l = local.get(name);
    const r = remote.get(name);
    try {
      if (l && !r) {
        const saved = await uploadOrReplace(l.file, () => false, spaceId);
        if (!saved) throw new Error("вже існує у просторі");
        stats.uploaded++;
        newState[name] = l.hash;
      } else if (!l && r) {
        await writeLocal(dirHandle, name, await downloadFileBlob(r.id));
        stats.downloaded++;
        newState[name] = r.content_hash;
      } else if (l.hash === r.content_hash) {
        stats.skipped++;
        newState[name] = l.hash;
      } else if (decideDirection(state[name], l, r) === "upload") {
        if (r.role === "read") throw new Error("немає права запису в цей простір");
        await updateFile(r.id, l.file);
        stats.updatedRemote++;
        newState[name] = l.hash;
      } else {
        await writeLocal(dirHandle, name, await downloadFileBlob(r.id));
        stats.updatedLocal++;
        newState[name] = r.content_hash;
      }
    } catch (err) {
      stats.errors++;
      onError(`"${name}": ${err.message}`);
    }
  }

  await idbPut(stateKey(userId, spaceId), newState);
  return stats;
}

// ---------- Внутрішні допоміжні функції ----------

// base - хеш, який був спільним після минулої синхронізації (undefined, якщо файл ще не синхронізувався)
function decideDirection(base, l, r) {
  const localChanged = base === undefined || l.hash !== base;
  const remoteChanged = base === undefined || r.content_hash !== base;

  if (localChanged && !remoteChanged) return "upload";
  if (remoteChanged && !localChanged) return "download";

  // Конфлікт або перша синхронізація: перемагає новіша версія.
  // Дати тут використовуються тільки як крайній випадок, а не для щоденного порівняння.
  const remoteTime = Date.parse(r.modified_at);
  return l.lastModified > remoteTime ? "upload" : "download";
}

// Ключ для обох сторін - ім'я, очищене від символів, що заборонені у Windows
function pickNewestByName(list) {
  const map = new Map();
  for (const f of list) {
    const key = safeLocalName(f.name);
    const prev = map.get(key);
    if (!prev || Date.parse(f.modified_at) > Date.parse(prev.modified_at)) {
      map.set(key, f);
    }
  }
  return map;
}

async function readLocalFiles(dirHandle) {
  const map = new Map();
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind !== "file") continue;
    const file = await entry.getFile();
    map.set(name, {
      file,
      lastModified: file.lastModified,
      hash: await sha256(file)
    });
  }
  return map;
}

async function sha256(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeLocalName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
}

async function writeLocal(dirHandle, name, blob) {
  const fileHandle = await dirHandle.getFileHandle(safeLocalName(name), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}