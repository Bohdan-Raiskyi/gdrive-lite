const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");

function registerUser(username, password) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    const err = new Error("Користувач з таким іменем вже існує");
    err.status = 409;
    throw err;
  }
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toISOString();

  db.prepare(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, username, passwordHash, createdAt);

  return { id, username };
}

function verifyCredentials(username, password) {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return null;

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return null;

  return { id: user.id, username: user.username };
}

module.exports = { registerUser, verifyCredentials };