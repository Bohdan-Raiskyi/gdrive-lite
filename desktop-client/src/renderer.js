import {
  register, login, loadToken, clearToken, listFiles, uploadOrReplace, deleteFile,
  downloadFileBlob, getCurrentUserId, getCurrentUsername,
  listSpaces, listMembers, addMember, updateMemberRole, removeShare
} from "./api.js";
import { getSavedDirectory, pickSyncDirectory, syncFolder, removeLocalFile } from "./sync.js";

const $ = (id) => document.getElementById(id);
const VIEWABLE = ["cs", "jpg"];
const ROLE_LABEL = { owner: "Власник", edit: "Редагування", read: "Лише читання" };

let sortDir = "asc";
let filterType = "all";
let objectUrl = null;
let spaces = [];
let syncDir = null;
let dragDepth = 0;

// ---------- Допоміжні функції ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, onClick) {
  const b = el("button", className, text);
  b.addEventListener("click", onClick);
  return b;
}
function cell(text, className) { return el("td", className, text); }
function roleBadge(role) { return el("span", `badge badge-${role}`, ROLE_LABEL[role] ?? role); }

function formatDate(iso) { return new Date(iso).toLocaleString("uk-UA"); }
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const toastContainer = $("toast-container");
function toast(text, type = "info") {
  const node = el("div", `toast toast-${type}`, text);
  toastContainer.appendChild(node);
  setTimeout(() => node.remove(), type === "error" ? 6000 : 3500);
}

function showAuthMessage(text) { $("auth-message").textContent = text; }

const askReplace = (name) =>
  confirm(`Файл "${name}" уже є у просторі. Замінити його новою версією?`);

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToFile(name, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name);
}

// ---------- Вхід, вихід ----------

function showApp(loggedIn) {
  $("auth-section").classList.toggle("hidden", loggedIn);
  $("files-section").classList.toggle("hidden", !loggedIn);
  $("panels-section").classList.toggle("hidden", !loggedIn);
  $("user-name").textContent = loggedIn ? getCurrentUsername() ?? "" : "";
}

async function enterApp() {
  // Кожен блок ізольований: помилка в одному не блокує інші
  syncDir = getSavedDirectory();
  $("sync-folder").textContent = syncDir ? `Папка: ${syncDir}` : "Папка не обрана";
  await refreshFiles();
  await loadSpaces().catch((err) => toast(`Простори: ${err.message}`, "error"));
  await refreshMembers();
}

$("login-btn").addEventListener("click", async () => {
  try {
    await login($("username").value, $("password").value);
    showAuthMessage("");
    showApp(true);
    await enterApp();
  } catch (err) {
    showAuthMessage(err.message);
  }
});

$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("login-btn").click();
});

$("register-btn").addEventListener("click", async () => {
  try {
    await register($("username").value, $("password").value);
    showAuthMessage("Реєстрація успішна, тепер увійдіть.");
  } catch (err) {
    showAuthMessage(err.message);
  }
});

$("logout-btn").addEventListener("click", () => {
  clearToken();
  syncDir = null;
  $("files-tbody").replaceChildren();
  $("sync-folder").textContent = "";
  showAuthMessage("");
  showApp(false);
});

// ---------- Простори ----------

async function loadSpaces() {
  const shared = await listSpaces();
  spaces = [
    { id: getCurrentUserId(), name: "Мій простір", role: "owner" },
    ...shared.map((s) => ({ id: s.owner_id, name: `Простір: ${s.owner_name}`, role: s.role }))
  ];
  renderSpaceSelect();
  renderSharedList(shared);
}

function renderSpaceSelect() {
  const select = $("space-select");
  const previous = select.value;
  select.replaceChildren();
  for (const s of spaces) {
    const label = s.role === "read" ? `${s.name} (лише читання)` : s.name;
    const opt = new Option(label, s.id);
    opt.disabled = s.role === "read";
    select.append(opt);
  }
  const writable =
    spaces.find((s) => s.role !== "read" && s.id === previous) ??
    spaces.find((s) => s.role !== "read");
  if (writable) select.value = writable.id;
}

function currentSpace() {
  const id = $("space-select").value;
  return spaces.find((s) => s.id === id) ?? null;
}

function renderSharedList(shared) {
  const list = $("shared-list");
  list.replaceChildren();
  if (!shared.length) {
    list.append(el("p", "muted", "Немає просторів, відкритих вам"));
    return;
  }
  for (const s of shared) {
    const row = el("div", "row");
    const info = el("div", "row-info");
    info.append(el("span", "row-title", s.owner_name), roleBadge(s.role));
    row.append(info, button("Відмовитися", "btn btn-danger btn-small", () => leaveSpace(s)));
    list.append(row);
  }
}

async function leaveSpace(share) {
  if (!confirm(`Відмовитися від простору "${share.owner_name}"?`)) return;
  try {
    await removeShare(share.id);
    toast("Ви вийшли з простору", "success");
    await loadSpaces();
    await refreshFiles();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Учасники мого простору ----------

async function refreshMembers() {
  const list = $("member-list");
  try {
    const members = await listMembers();
    list.replaceChildren();
    if (!members.length) {
      list.append(el("p", "muted", "Учасників ще немає"));
      return;
    }
    for (const m of members) {
      const row = el("div", "row");
      const info = el("div", "row-info");
      info.append(el("span", "row-title", m.username));

      const select = el("select", "input input-small");
      select.append(new Option("Читання", "read"), new Option("Редагування", "edit"));
      select.value = m.role;
      select.addEventListener("change", async () => {
        try {
          await updateMemberRole(m.id, select.value);
          m.role = select.value;
          toast("Роль змінено", "success");
          await refreshFiles();
        } catch (err) {
          toast(err.message, "error");
          select.value = m.role;
        }
      });

      row.append(info, select, button("Прибрати", "btn btn-danger btn-small", () => removeMember(m)));
      list.append(row);
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

async function removeMember(member) {
  if (!confirm(`Прибрати ${member.username} з вашого простору?`)) return;
  try {
    await removeShare(member.id);
    toast(`${member.username} більше не має доступу`, "success");
    await refreshMembers();
  } catch (err) {
    toast(err.message, "error");
  }
}

$("add-member-btn").addEventListener("click", async () => {
  const username = $("member-username").value.trim();
  if (!username) {
    toast("Введіть логін користувача", "error");
    return;
  }
  try {
    await addMember(username, $("member-role").value);
    $("member-username").value = "";
    toast(`Користувача ${username} додано`, "success");
    await refreshMembers();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------- Таблиця файлів ----------

async function refreshFiles() {
  try {
    const files = await listFiles({ sortDir, filterType });
    renderTable(files);
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderTable(files) {
  const tbody = $("files-tbody");
  tbody.replaceChildren();
  $("empty-state").classList.toggle("hidden", files.length > 0);
  for (const file of files) tbody.append(buildRow(file));
  applyColumnVisibility();
}

function buildRow(file) {
  const tr = document.createElement("tr");
  const isOwner = file.role === "owner";

  const nameCell = el("td");
  nameCell.append(el("span", "file-name", file.name));
  if (!isOwner) nameCell.append(" ", roleBadge(file.role));

  tr.append(
    nameCell,
    cell(isOwner ? "Ви" : file.owner_name, "col-owner"),
    cell(formatDate(file.created_at), "col-created"),
    cell(formatDate(file.modified_at), "col-modified"),
    cell(file.uploaded_by_name, "col-uploader"),
    cell(file.edited_by_name ?? "—", "col-editor"),
    cell(formatSize(file.size_bytes), "col-size")
  );

  const actions = el("td", "actions-cell");
  if (VIEWABLE.includes(file.extension)) {
    actions.append(button("Переглянути", "btn btn-small", () => viewContent(file)));
  }
  actions.append(button("Завантажити", "btn btn-small", () => downloadFile(file)));
  if (isOwner) {
    actions.append(button("Видалити", "btn btn-small btn-danger", () => deleteOwnFile(file)));
  }
  tr.append(actions);
  return tr;
}

function applyColumnVisibility() {
  document.querySelectorAll(".col-toggle").forEach((cb) => {
    document
      .querySelectorAll(`#files-table .col-${cb.dataset.col}`)
      .forEach((node) => node.classList.toggle("hidden", !cb.checked));
  });
}
document.querySelectorAll(".col-toggle").forEach((cb) => {
  cb.addEventListener("change", applyColumnVisibility);
});

// ---------- Перегляд вмісту ----------

async function viewContent(file) {
  try {
    const blob = await downloadFileBlob(file.id);
    const text = $("text-viewer");
    const img = $("image-viewer");
    text.classList.add("hidden");
    img.classList.add("hidden");
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    $("viewer-title").textContent = file.name;

    if (file.extension === "cs") {
      text.textContent = await blob.text();
      text.classList.remove("hidden");
    } else {
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      img.classList.remove("hidden");
    }
    $("viewer").showModal();
  } catch (err) {
    toast(err.message, "error");
  }
}
$("viewer-close").addEventListener("click", () => $("viewer").close());
$("viewer").addEventListener("close", () => {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
});

// ---------- Вивантаження ----------

async function downloadFile(file) {
  try {
    const blob = await downloadFileBlob(file.id);
    const base64 = await blobToBase64(blob);
    const savedPath = await window.desktop.saveFile(file.name, base64);
    if (savedPath) toast(`Збережено: ${savedPath}`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Видалення (з трекінгом локальної копії) ----------

async function deleteOwnFile(file) {
  if (!confirm(`Видалити файл "${file.name}"?`)) return;
  try {
    await deleteFile(file.id);
    toast("Файл видалено", "success");
    await removeFromLocalIfSynced(file.name);
    await refreshFiles();
  } catch (err) {
    toast(err.message, "error");
  }
}

// Найкраще зусилля: якщо папка синхронізації обрана, прибираємо локальну копію теж,
// щоб наступна синхронізація не "воскресила" файл на сервері
async function removeFromLocalIfSynced(name) {
  if (!syncDir) return;
  try {
    const removed = await removeLocalFile(syncDir, name);
    if (removed) toast(`Видалено і з локальної папки: ${name}`, "info");
  } catch (err) {
    console.warn("Не вдалося видалити локальну копію:", err.message);
  }
}

// ---------- Завантаження файлів (спільна логіка для кнопки і drag-n-drop) ----------

async function saveFiles(files, space) {
  if (!space || space.role === "read") {
    toast("Оберіть простір, де можна записувати", "error");
    return;
  }
  if (files.length === 0) return;

  let saved = 0;
  for (const file of files) {
    try {
      if (await uploadOrReplace(file, askReplace, space.id)) saved++;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, "error");
    }
  }
  toast(`Збережено ${saved} з ${files.length}`, saved === files.length ? "success" : "info");
  await refreshFiles();
}

$("upload-btn").addEventListener("click", async () => {
  try {
    const picked = await window.desktop.pickFiles(); // [{ name, data: base64 }]
    if (picked.length === 0) return;
    const files = picked.map(({ name, data }) => base64ToFile(name, data));
    await saveFiles(files, currentSpace());
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------- Drag-n-drop ----------

const filesSection = $("files-section");

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });

filesSection.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  filesSection.classList.add("drag-over");
});

filesSection.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

filesSection.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    filesSection.classList.remove("drag-over");
  }
});

// Файли, перетягнуті у вікно Electron, - звичайні об'єкти File стандартного Web API,
// тому для них не потрібне IPC-читання: вони читаються так само, як у браузері
filesSection.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  filesSection.classList.remove("drag-over");

  const items = Array.from(e.dataTransfer.items ?? []);
  const fileItems = items.filter((item) => item.kind === "file");
  const folderCount = fileItems.filter((item) => item.webkitGetAsEntry?.()?.isDirectory).length;
  const files = fileItems
    .filter((item) => !item.webkitGetAsEntry?.()?.isDirectory)
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (folderCount > 0) toast("Папки не підтримуються, перетягніть окремі файли", "error");
  saveFiles(files, currentSpace());
});

// ---------- Синхронізація ----------

$("pick-dir-btn").addEventListener("click", async () => {
  try {
    const dirPath = await pickSyncDirectory();
    if (!dirPath) return; // скасовано
    syncDir = dirPath;
    $("sync-folder").textContent = `Папка: ${syncDir}`;
    toast("Папку обрано", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

$("sync-btn").addEventListener("click", async () => {
  if (!syncDir) {
    toast("Спочатку оберіть локальну папку", "error");
    return;
  }
  const btn = $("sync-btn");
  btn.disabled = true;
  try {
    const errors = [];
    const s = await syncFolder(syncDir, { onError: (msg) => errors.push(msg) });
    toast(
      `Синхронізація: завантажено ${s.uploaded + s.updatedRemote}, ` +
      `отримано ${s.downloaded + s.updatedLocal}, без змін ${s.skipped}`,
      errors.length ? "info" : "success"
    );
    if (errors.length) {
      console.warn("Помилки синхронізації:", errors);
      toast(`Помилок: ${errors.length}. Деталі в консолі`, "error");
    }
    await refreshFiles();
  } catch (err) {
    toast(`Помилка синхронізації: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Фільтр і сортування ----------

function updateSortLabel() {
  $("sort-btn").textContent = `Завантажив: ${sortDir === "asc" ? "А→Я" : "Я→А"}`;
}
$("sort-btn").addEventListener("click", () => {
  sortDir = sortDir === "asc" ? "desc" : "asc";
  updateSortLabel();
  refreshFiles();
});
$("filter-select").addEventListener("change", (e) => {
  filterType = e.target.value;
  refreshFiles();
});

// ---------- Старт ----------

updateSortLabel();

if (loadToken()) {
  showApp(true);
  enterApp().catch(() => {
    clearToken();
    showApp(false);
  });
} else {
  showApp(false);
}