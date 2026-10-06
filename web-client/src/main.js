import {
  register, login, loadToken, clearToken, listFiles, uploadOrReplace, deleteFile,
  downloadFileBlob, listSpaces, getCurrentUserId, getCurrentUsername,
  listMembers, addMember, updateMemberRole, removeShare
} from "./api.js";
import { pickSyncDirectory, getSavedDirectory, ensurePermission, syncFolder } from "./sync.js";

// ---------- Стан і константи ----------

const $ = (id) => document.getElementById(id);
const ROLE_LABEL = { owner: "Власник", edit: "Редагування", read: "Лише читання" };
const VIEWABLE = ["cs", "jpg"];

let sortDir = "asc";
let filterType = "all";
let spaces = [];           // [{ id, name, role }]
let syncDir = null;
let objectUrl = null;
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

function cell(text, className) {
  return el("td", className, text);
}

function roleBadge(role) {
  return el("span", `badge badge-${role}`, ROLE_LABEL[role] ?? role);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("uk-UA");
}

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

function showAuthMessage(text, type = "error") {
  const node = $("auth-message");
  node.textContent = text;
  node.className = `form-message form-${type}`;
}

const askReplace = (name) =>
  confirm(`Файл "${name}" уже є у просторі. Замінити його новою версією?`);

// ---------- Вхід, вихід, стан екрана ----------

function showApp(loggedIn) {
  $("auth-section").classList.toggle("hidden", loggedIn);
  $("files-section").classList.toggle("hidden", !loggedIn);
  $("logout-btn").classList.toggle("hidden", !loggedIn);
  $("user-name").textContent = loggedIn ? getCurrentUsername() ?? "" : "";
}

async function enterApp() {
  showApp(true);
  await Promise.all([loadSpaces(), restoreSyncFolder()]);
  await Promise.all([refreshFiles(), refreshMembers()]);
}

$("login-btn").addEventListener("click", async () => {
  try {
    await login($("username").value, $("password").value);
    showAuthMessage("");
    await enterApp();
  } catch (err) {
    showAuthMessage(err.message, "error");
  }
});

$("password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("login-btn").click();
});

$("register-btn").addEventListener("click", async () => {
  try {
    await register($("username").value, $("password").value);
    showAuthMessage("Реєстрація успішна, тепер увійдіть.", "success");
  } catch (err) {
    showAuthMessage(err.message, "error");
  }
});

$("logout-btn").addEventListener("click", () => {
  clearToken();
  spaces = [];
  syncDir = null;
  $("space-select").replaceChildren();
  $("files-tbody").replaceChildren();
  $("member-list").replaceChildren();
  $("shared-list").replaceChildren();
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

      row.append(
        info,
        select,
        button("Прибрати", "btn btn-danger btn-small", () => removeMember(m))
      );
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
  const canEdit = isOwner || file.role === "edit";

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

// Видимість стовпців застосовується після кожного рендеру, щоб вона не губилась при оновленні
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

// ---------- Дії з файлом ----------

async function viewContent(file) {
  try {
    const blob = await downloadFileBlob(file.id);
    const text = $("text-viewer");
    const img = $("image-viewer");
    text.classList.add("hidden");
    img.classList.add("hidden");
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
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
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
});

async function downloadFile(file) {
  try {
    const blob = await downloadFileBlob(file.id);
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // одразу відкликати URL іноді обриває завантаження
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteOwnFile(file) {
  if (!confirm(`Видалити файл "${file.name}"?`)) return;
  try {
    await deleteFile(file.id);
    toast("Файл видалено", "success");
    await refreshFiles();
  } catch (err) {
    toast(err.message, "error");
  }
}


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

// ---------- Завантаження ----------

async function saveFiles(files) {
  const space = currentSpace();
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

$("upload-btn").addEventListener("click", () => $("file-input").click());

$("file-input").addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  e.target.value = "";
  saveFiles(files);
});

// ---------- Drag-n-drop ----------

const filesSection = $("files-section");

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

// Файл, відпущений поза зоною, браузер не має відкривати
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

filesSection.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  filesSection.classList.remove("drag-over");

  // getAsFile() і webkitGetAsEntry() мають викликатися синхронно в обробнику drop
  const items = Array.from(e.dataTransfer.items ?? []);
  const fileItems = items.filter((item) => item.kind === "file");
  const folderCount = fileItems.filter((item) => item.webkitGetAsEntry?.()?.isDirectory).length;
  const files = fileItems
    .filter((item) => !item.webkitGetAsEntry?.()?.isDirectory)
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (folderCount > 0) toast("Папки не підтримуються, перетягніть окремі файли", "error");
  saveFiles(files);
});

// ---------- Синхронізація з локальною папкою ----------

async function restoreSyncFolder() {
  // Ключ папки прив'язаний до userId, тож після входу іншим користувачем папка не відновиться
  syncDir = await getSavedDirectory().catch(() => null);
  $("sync-folder").textContent = syncDir ? `Папка: ${syncDir.name}` : "Папка не обрана";
}

$("pick-dir-btn").addEventListener("click", async () => {
  try {
    syncDir = await pickSyncDirectory();
    $("sync-folder").textContent = `Папка: ${syncDir.name}`;
    toast("Папку обрано", "success");
  } catch (err) {
    if (err.name !== "AbortError") toast(err.message, "error");
  }
});

async function runSync() {
  const myId = getCurrentUserId();
  const space = spaces.find((s) => s.id === myId);
  if (!syncDir) {
    toast("Спочатку оберіть локальну папку", "error");
    return;
  }
  if (!space) {
    toast("Не вдалося визначити ваш простір", "error");
    return;
  }
  if (!(await ensurePermission(syncDir))) {
    toast("Немає дозволу на доступ до папки", "error");
    return;
  }

  const btn = $("sync-btn");
  btn.disabled = true;
  try {
    const errors = [];
    const s = await syncFolder(syncDir, { spaceId: space.id, onError: (msg) => errors.push(msg) });
    toast(
      `«${space.name}»: завантажено ${s.uploaded + s.updatedRemote}, ` +
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
}

$("sync-btn").addEventListener("click", runSync);

// ---------- Старт ----------

updateSortLabel();

if (loadToken()) {
  enterApp().catch(() => {
    clearToken();
    showApp(false);
    showAuthMessage("Сесія завершилась, увійдіть знову", "error");
  });
} else {
  showApp(false);
}