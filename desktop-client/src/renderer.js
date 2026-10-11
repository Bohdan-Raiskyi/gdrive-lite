import {
  register, login, loadToken, clearToken, listFiles, uploadOrReplace, deleteFile,
  downloadFileBlob, getCurrentUserId, getCurrentUsername,
  listSpaces, listMembers, addMember, updateMemberRole, removeShare
} from "./api.js";

const $ = (id) => document.getElementById(id);
const VIEWABLE = ["cs", "jpg"];

let sortDir = "asc";
let filterType = "all";
let objectUrl = null;
let spaces = []; // [{ id, name, role }]
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

const ROLE_LABEL = { owner: "Власник", edit: "Редагування", read: "Лише читання" };
function roleBadge(role) {
  return el("span", `badge badge-${role}`, ROLE_LABEL[role] ?? role);
}
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

// Перетворення Blob -> base64 (для передачі даних у main-процес через IPC)
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Перетворення base64 (отриманого з main-процесу) назад у File для FormData
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
  $("files-tbody").replaceChildren();
  showAuthMessage("");
  showApp(false);
});

async function enterApp() {
  await refreshFiles();
  await loadSpaces().catch((err) => toast(`Простори: ${err.message}`, "error"));
  await refreshMembers();
}

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

// ---------- Вивантаження (download) через нативний діалог збереження ----------

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

// ---------- Видалення ----------

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

// ---------- Завантаження через нативний діалог вибору файлів ----------

$("upload-btn").addEventListener("click", async () => {
  const space = currentSpace();
  if (!space || space.role === "read") {
    toast("Оберіть простір, де можна записувати", "error");
    return;
  }
  try {
    const picked = await window.desktop.pickFiles();
    if (picked.length === 0) return;

    let saved = 0;
    for (const { name, data } of picked) {
      const file = base64ToFile(name, data);
      try {
        if (await uploadOrReplace(file, askReplace, space.id)) saved++;
      } catch (err) {
        toast(`${name}: ${err.message}`, "error");
      }
    }
    toast(`Збережено ${saved} з ${picked.length}`, saved === picked.length ? "success" : "info");
    await refreshFiles();
  } catch (err) {
    toast(err.message, "error");
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