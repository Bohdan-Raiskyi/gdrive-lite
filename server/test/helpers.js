const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src");

// Піднімає реальний сервер на вільному порту з тимчасовою БД і сховищем файлів.
function startTestServer() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gdrive-lite-test-"));
  process.env.DB_PATH = path.join(tmpRoot, "test.sqlite");
  process.env.STORAGE_DIR = path.join(tmpRoot, "storage");
  fs.mkdirSync(process.env.STORAGE_DIR, { recursive: true });

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) delete require.cache[key];
  }

  const app = require("../src/index.js");
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, baseUrl: `http://localhost:${server.address().port}`, tmpRoot });
    });
  });
}

function stopTestServer({ server, tmpRoot }) {
  return new Promise((resolve, reject) => {
    server.close((closeErr) => {
      if (closeErr) return reject(closeErr);
      try {
        const db = require("../src/db");
        db.closeForTests();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = { startTestServer, stopTestServer };