const API_BASE = "http://localhost:3000";
let authToken = null;

export function setToken(token) {
  authToken = token;
  localStorage.setItem("token", token);
}
export function loadToken() {
  authToken = localStorage.getItem("token");
  return authToken;
}
export function clearToken() {
  authToken = null;
  localStorage.removeItem("token");
}
function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error((await res.json()).error || "Помилка реєстрації");
  return res.json();
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error((await res.json()).error || "Помилка входу");
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function listFiles({ sortDir = "asc", filterType = "all", spaceId } = {}) {
  const params = new URLSearchParams({ sortDir, filterType });
  if (spaceId) params.set("spaceId", spaceId);
  const res = await fetch(`${API_BASE}/files?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || "Помилка отримання списку");
  return res.json();
}

export async function uploadFile(file, spaceId) {
  const formData = new FormData();
  formData.append("file", file);
  const url = spaceId ? `${API_BASE}/files?spaceId=${encodeURIComponent(spaceId)}` : `${API_BASE}/files`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(), body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || "Помилка завантаження");
    err.status = res.status;
    err.existingId = data.existingId;
    throw err;
  }
  return res.json();
}

// Завантажує файл. Якщо такий уже є на сервері, питає askReplace(name).
// Повертає збережений файл або null, якщо користувач відмовився від заміни.
export async function uploadOrReplace(file, askReplace, spaceId) {
  try {
    return await uploadFile(file, spaceId);
  } catch (err) {
    if (err.status !== 409) throw err;
    if (!askReplace(file.name)) return null;
    return updateFile(err.existingId, file);
  }
}

export async function deleteFile(id) {
  const res = await fetch(`${API_BASE}/files/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 204) throw new Error("Помилка видалення");
}

export async function fetchContent(id) {
  const res = await fetch(`${API_BASE}/files/${id}/content`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Помилка перегляду вмісту");
  return res;
}

export async function updateFile(id, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/files/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: formData
  });
  if (!res.ok) throw new Error((await res.json()).error || "Помилка оновлення файлу");
  return res.json();
}

export async function downloadFileBlob(id) {
  const res = await fetchContent(id);
  return res.blob();
}

export async function listSpaces() {
  const res = await fetch(`${API_BASE}/shares/spaces`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Помилка отримання просторів");
  return res.json();
}

export function getCurrentUserId() {
  const token = authToken;
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ---------- Допоміжні функції ----------

async function ensureOk(res, fallback) {
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || fallback);
}

function readTokenPayload() {
  if (!authToken) return null;
  try {
    return JSON.parse(atob(authToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function getCurrentUsername() {
  return readTokenPayload()?.username ?? null;
}

// ---------- Учасники простору ----------

export async function listMembers() {
  const res = await fetch(`${API_BASE}/shares/members`, { headers: authHeaders() });
  await ensureOk(res, "Не вдалося отримати учасників");
  return res.json();
}

export async function addMember(username, role) {
  const res = await fetch(`${API_BASE}/shares/members`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, role })
  });
  await ensureOk(res, "Не вдалося додати учасника");
  return res.json();
}

export async function updateMemberRole(shareId, role) {
  const res = await fetch(`${API_BASE}/shares/members/${shareId}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ role })
  });
  await ensureOk(res, "Не вдалося змінити роль");
  return res.json();
}

// Зняти доступ: власник прибирає учасника, або учасник виходить з простору
export async function removeShare(shareId) {
  const res = await fetch(`${API_BASE}/shares/${shareId}`, { method: "DELETE", headers: authHeaders() });
  await ensureOk(res, "Не вдалося зняти доступ");
}
