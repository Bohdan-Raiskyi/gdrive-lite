const crypto = require("crypto");
const fs = require("fs");

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

module.exports = { hashFile };