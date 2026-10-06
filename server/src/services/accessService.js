const db = require("../db");

// Порядок ролей: кожна наступна включає права попередньої
const RANK = { read: 1, edit: 2, owner: 3 };

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Роль користувача в просторі власника: "owner", "edit", "read" або null
function getSpaceRole(spaceOwnerId, userId) {
  if (spaceOwnerId === userId) return "owner";
  const row = db.prepare("SELECT role FROM shares WHERE owner_id = ? AND user_id = ?")
    .get(spaceOwnerId, userId);
  return row ? row.role : null;
}

// Перевіряє доступ до простору. Якщо доступу немає, повертає 404, щоб не розкривати існування простору.
function assertSpaceAccess(spaceOwnerId, userId, needed) {
  const role = getSpaceRole(spaceOwnerId, userId);
  if (!role) throw httpError(404, "Простір не знайдено");
  if (RANK[role] < RANK[needed]) throw httpError(403, "Недостатньо прав у цьому просторі");
  return role;
}

// Перевіряє доступ до конкретного файлу через його простір і повертає запис файлу
function assertFileAccess(fileId, userId, needed) {
  const file = db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);
  if (!file) throw httpError(404, "Файл не знайдено");

  const role = getSpaceRole(file.owner_id, userId);
  if (!role) throw httpError(404, "Файл не знайдено");
  if (RANK[role] < RANK[needed]) throw httpError(403, "Недостатньо прав для цієї дії");

  return file;
}

module.exports = { getSpaceRole, assertSpaceAccess, assertFileAccess };