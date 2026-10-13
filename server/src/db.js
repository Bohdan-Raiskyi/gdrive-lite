const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { hashFile } = require("./services/hash");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.sqlite");
const STORAGE_DIR = path.join(__dirname, "..", "storage");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    extension         TEXT NOT NULL,
    size_bytes        INTEGER NOT NULL,
    created_at        TEXT NOT NULL,
    modified_at       TEXT NOT NULL,
    uploaded_by       TEXT NOT NULL REFERENCES users(id),
    edited_by         TEXT REFERENCES users(id),
    storage_filename  TEXT NOT NULL UNIQUE
  );
`);

// Міграція: додаємо колонку з хешем вмісту, якщо її ще немає
const hasHashColumn = db.prepare("PRAGMA table_info(files)").all().some((c) => c.name === "content_hash");
if (!hasHashColumn) {
  db.exec("ALTER TABLE files ADD COLUMN content_hash TEXT");
}

// Заповнюємо хеші для файлів, завантажених раніше
const withoutHash = db.prepare("SELECT id, storage_filename FROM files WHERE content_hash IS NULL").all();
const setHash = db.prepare("UPDATE files SET content_hash = ? WHERE id = ?");
for (const row of withoutHash) {
  const filePath = path.join(STORAGE_DIR, row.storage_filename);
  if (fs.existsSync(filePath)) {
    setHash.run(hashFile(filePath), row.id);
  }
}

// Міграція: власник простору
const fileColumns = db.prepare("PRAGMA table_info(files)").all().map((c) => c.name);
if (!fileColumns.includes("owner_id")) {
  db.exec("ALTER TABLE files ADD COLUMN owner_id TEXT REFERENCES users(id)");
  // Існуючі файли належать тому, хто їх завантажив
  db.exec("UPDATE files SET owner_id = uploaded_by WHERE owner_id IS NULL");
}

// Спільний доступ до просторів
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('read', 'edit')),
    created_at  TEXT NOT NULL,
    UNIQUE (owner_id, user_id)
  );
`);

// Ім'я файлу унікальне в межах простору власника, а не глобально
try {
  db.exec("DROP INDEX IF EXISTS idx_files_name");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_files_owner_name ON files(owner_id, name)");
} catch (err) {
  console.warn("Унікальний індекс не створено, перевірте дублікати:", err.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_settings (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL,
    space_id    TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

// Дозволяє тестам явно закрити з'єднання перед видаленням тимчасової БД
db.closeForTests = () => db.close();
module.exports = db;