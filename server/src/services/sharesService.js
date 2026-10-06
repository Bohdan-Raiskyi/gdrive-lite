const crypto = require("crypto");
const db = require("../db");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Учасники мого простору (кому я дав доступ)
function listMembersOfSpace(ownerId) {
  return db.prepare(`
    SELECT s.id, s.role, s.created_at, u.id AS user_id, u.username
    FROM shares s
    JOIN users u ON u.id = s.user_id
    WHERE s.owner_id = ?
    ORDER BY u.username ASC
  `).all(ownerId);
}

// Простори, до яких має доступ мій користувач (чиї файли я бачу)
function listSpacesSharedWithMe(userId) {
  return db.prepare(`
    SELECT s.id, s.role, s.created_at, u.id AS owner_id, u.username AS owner_name
    FROM shares s
    JOIN users u ON u.id = s.owner_id
    WHERE s.user_id = ?
    ORDER BY u.username ASC
  `).all(userId);
}

function addMember({ ownerId, username, role }) {
  if (!["read", "edit"].includes(role)) {
    throw httpError(400, "Роль має бути read або edit");
  }

  const target = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
  if (!target) throw httpError(404, "Користувача з таким логіном не знайдено");
  if (target.id === ownerId) throw httpError(400, "Не можна додати самого себе");

  const existing = db.prepare("SELECT id FROM shares WHERE owner_id = ? AND user_id = ?")
    .get(ownerId, target.id);
  if (existing) throw httpError(409, "Цей користувач уже має доступ до простору");

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO shares (id, owner_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, ownerId, target.id, role, new Date().toISOString());

  return { id, user_id: target.id, username: target.username, role };
}

// Змінити роль існуючого учасника
function updateRole({ ownerId, shareId, role }) {
  if (!["read", "edit"].includes(role)) {
    throw httpError(400, "Роль має бути read або edit");
  }
  const share = db.prepare("SELECT * FROM shares WHERE id = ?").get(shareId);
  if (!share || share.owner_id !== ownerId) throw httpError(404, "Запис доступу не знайдено");

  db.prepare("UPDATE shares SET role = ? WHERE id = ?").run(role, shareId);
  return { ...share, role };
}

// Зняти доступ. Може власник простору (прибрати учасника) або учасник (відмовитися від простору)
function removeShare({ shareId, currentUserId }) {
  const share = db.prepare("SELECT * FROM shares WHERE id = ?").get(shareId);
  if (!share) throw httpError(404, "Запис доступу не знайдено");
  if (share.owner_id !== currentUserId && share.user_id !== currentUserId) {
    throw httpError(404, "Запис доступу не знайдено");
  }
  db.prepare("DELETE FROM shares WHERE id = ?").run(shareId);
}

module.exports = {
  listMembersOfSpace, listSpacesSharedWithMe, addMember, updateRole, removeShare
};