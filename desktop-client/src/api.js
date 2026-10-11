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

function readTokenPayload() {
  if (!authToken) return null;
  try {
    return JSON.parse(atob(authToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
export function getCurrentUsername() { return readTokenPayload()?.username ?? null; }
export function getCurrentUserId() { return readTokenPayload()?.sub ?? null; }

async function ensureOk(res, fallback) {
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.error || fallback);
  err.status = res.status;
  err.existingId = data.existingId;
  throw err;
}

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  await ensureOk(res, "Помилка реєстрації");
  return res.json();
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  await ensureOk(res, "Помилка входу");
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function listFiles({ sortDir = "asc", filterType = "all", spaceId } = {}) {
  const params = new URLSearchParams({ sortDir, filterType });
  if (spaceId) params.set("spaceId", spaceId);
  const res = await fetch(`${API_BASE}/files?${params}`, { headers: authHeaders() });
  await ensureOk(res, "Помилка отримання списку");
  return res.json();
}

export async function uploadFile(file, spaceId) {
  const formData = new FormData();
  formData.append("file", file);
  const url = spaceId ? `${API_BASE}/files?spaceId=${encodeURIComponent(spaceId)}` : `${API_BASE}/files`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(), body: formData });
  await ensureOk(res, "Помилка завантаження");
  return res.json();
}

// Якщо файл з такою назвою вже є у просторі (409), askReplace вирішує, оновити вміст чи скасувати
export async function uploadOrReplace(file, askReplace, spaceId) {
  try {
    return await uploadFile(file, spaceId);
  } catch (err) {
    if (err.status !== 409) throw err;
    if (!askReplace(file.name)) return null;
    return updateFile(err.existingId, file);
  }
}

export async function updateFile(id, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/files/${id}`, { method: "PUT", headers: authHeaders(), body: formData });
  await ensureOk(res, "Помилка оновлення файлу");
  return res.json();
}

export async function deleteFile(id) {
  const res = await fetch(`${API_BASE}/files/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 204) await ensureOk(res, "Помилка видалення");
}

export async function downloadFileBlob(id) {
  const res = await fetch(`${API_BASE}/files/${id}/content`, { headers: authHeaders() });
  await ensureOk(res, "Помилка перегляду вмісту");
  return res.blob();
}

export async function listSpaces() {
  const res = await fetch(`${API_BASE}/shares/spaces`, { headers: authHeaders() });
  await ensureOk(res, "Помилка отримання просторів");
  return res.json();
}

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

export async function removeShare(shareId) {
  const res = await fetch(`${API_BASE}/shares/${shareId}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 204) await ensureOk(res, "Не вдалося зняти доступ");
}