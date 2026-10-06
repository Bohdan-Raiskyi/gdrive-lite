const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const db = require("../db");
const { hashFile } = require("./hash");

const STORAGE_DIR = path.join(__dirname, "..", "..", "storage");
const ALLOWED_FILTERS = ["all", "py", "jpg"];

// ownerId - чий простір, uploaderId - хто завантажив
function saveFile({ tempFilePath, originalName, ownerId, uploaderId }) {
  const id = crypto.randomUUID();
  const extension = path.extname(originalName).slice(1).toLowerCase();
  const storageFilename = `${id}.${extension}`;
  const destPath = path.join(STORAGE_DIR, storageFilename);

  fs.renameSync(tempFilePath, destPath);
  const sizeBytes = fs.statSync(destPath).size;
  const contentHash = hashFile(destPath);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO files (id, name, extension, size_bytes, created_at, modified_at,
                       uploaded_by, edited_by, storage_filename, content_hash, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(id, originalName, extension, sizeBytes, now, now, uploaderId, storageFilename, contentHash, ownerId);

  return getFileById(id);
}

function getFileById(id) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id);
}

function getFileContentPath(file) {
  return path.join(STORAGE_DIR, file.storage_filename);
}

// Пошук дубліката лише в межах простору
function findFileByName(name, ownerId) {
  return db.prepare("SELECT id, name FROM files WHERE name = ? AND owner_id = ?").get(name, ownerId);
}

// Повертає файли, які користувач бачить: свого простору і тих, до яких має доступ
function listFiles({ userId, sortDir = "asc", filterType = "all" } = {}) {
  if (!ALLOWED_FILTERS.includes(filterType)) {
    const err = new Error(`filterType має бути одним з: ${ALLOWED_FILTERS.join(", ")}`);
    err.status = 400;
    throw err;
  }
  const direction = String(sortDir).toLowerCase() === "desc" ? "DESC" : "ASC";

  const params = { userId };
  const conditions = ["(f.owner_id = @userId OR s.id IS NOT NULL)"];
  if (filterType !== "all") {
    conditions.push("f.extension = @filterType");
    params.filterType = filterType;
  }

  return db.prepare(`
    SELECT
      f.id, f.name, f.extension, f.size_bytes, f.created_at, f.modified_at,
      f.content_hash,
      f.owner_id, owner_user.username AS owner_name,
      f.uploaded_by, uploader.username AS uploaded_by_name,
      f.edited_by, editor.username AS edited_by_name,
      CASE WHEN f.owner_id = @userId THEN 'owner' ELSE s.role END AS role
    FROM files f
    JOIN users owner_user ON f.owner_id = owner_user.id
    JOIN users uploader ON f.uploaded_by = uploader.id
    LEFT JOIN users editor ON f.edited_by = editor.id
    LEFT JOIN shares s ON s.owner_id = f.owner_id AND s.user_id = @userId
    WHERE ${conditions.join(" AND ")}
    ORDER BY uploader.username ${direction}, f.created_at ASC
  `).all(params);
}

// Права перевіряє маршрут до виклику
function deleteFile(id) {
  const file = getFileById(id);
  if (!file) {
    const err = new Error("Файл не знайдено");
    err.status = 404;
    throw err;
  }
  fs.unlinkSync(getFileContentPath(file));
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
}

function updateFileContent({ id, tempFilePath, editorUserId }) {
  const file = getFileById(id);
  if (!file) {
    const err = new Error("Файл не знайдено");
    err.status = 404;
    throw err;
  }

  const destPath = getFileContentPath(file);
  fs.unlinkSync(destPath);
  fs.renameSync(tempFilePath, destPath);

  const sizeBytes = fs.statSync(destPath).size;
  const contentHash = hashFile(destPath);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE files SET size_bytes = ?, modified_at = ?, edited_by = ?, content_hash = ?
    WHERE id = ?
  `).run(sizeBytes, now, editorUserId, contentHash, id);

  return getFileById(id);
}

module.exports = {
  saveFile, getFileById, getFileContentPath, findFileByName,
  listFiles, deleteFile, updateFileContent
};