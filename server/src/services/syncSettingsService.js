const db = require("../db");

function getSyncSettings(userId) {
  const row = db.prepare("SELECT folder_name, space_id, updated_at FROM sync_settings WHERE user_id = ?")
    .get(userId);
  if (!row) return null;
  return { folderName: row.folder_name, spaceId: row.space_id, updatedAt: row.updated_at };
}

function saveSyncSettings(userId, { folderName, spaceId }) {
  db.prepare(`
    INSERT INTO sync_settings (user_id, folder_name, space_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      folder_name = excluded.folder_name,
      space_id = excluded.space_id,
      updated_at = excluded.updated_at
  `).run(userId, folderName, spaceId, new Date().toISOString());
  return getSyncSettings(userId);
}

function deleteSyncSettings(userId) {
  db.prepare("DELETE FROM sync_settings WHERE user_id = ?").run(userId);
}

module.exports = { getSyncSettings, saveSyncSettings, deleteSyncSettings };