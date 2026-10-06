const express = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const requireAuth = require("../middleware/auth");
const {
  saveFile, listFiles, getFileContentPath, deleteFile, updateFileContent, findFileByName
} = require("../services/fileStorageService");
const { getMimeType } = require("../services/mimeTypes");
const { assertSpaceAccess, assertFileAccess } = require("../services/accessService");

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });

// multer/busboy декодує назву файлу як latin1, а браузер надсилає UTF-8
function fixOriginalName(name) {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}

function removeTemp(file) {
  if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

router.get("/", requireAuth, (req, res) => {
  const { sortDir, filterType } = req.query;
  try {
    res.json(listFiles({ userId: req.user.id, sortDir, filterType }));
  } catch (err) {
    sendError(res, err);
  }
});

// Завантаження в простір: ?spaceId=... або власний простір, якщо параметр не передано
router.post("/", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Файл не надано (поле form-data повинно називатись 'file')" });
  }

  try {
    const spaceId = req.query.spaceId || req.user.id;
    assertSpaceAccess(spaceId, req.user.id, "edit");

    const originalName = fixOriginalName(req.file.originalname);
    const existing = findFileByName(originalName, spaceId);
    if (existing) {
      removeTemp(req.file);
      return res.status(409).json({
        error: `Файл "${originalName}" вже існує у просторі`,
        existingId: existing.id
      });
    }

    const file = saveFile({
      tempFilePath: req.file.path,
      originalName,
      ownerId: spaceId,
      uploaderId: req.user.id
    });
    res.status(201).json(file);
  } catch (err) {
    removeTemp(req.file);
    sendError(res, err);
  }
});

router.put("/:id", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Файл не надано" });
  }
  try {
    assertFileAccess(req.params.id, req.user.id, "edit");
    const file = updateFileContent({
      id: req.params.id,
      tempFilePath: req.file.path,
      editorUserId: req.user.id
    });
    res.json(file);
  } catch (err) {
    removeTemp(req.file);
    sendError(res, err);
  }
});

router.get("/:id/content", requireAuth, (req, res) => {
  try {
    const file = assertFileAccess(req.params.id, req.user.id, "read");
    res.setHeader("Content-Type", getMimeType(file.extension));
    fs.createReadStream(getFileContentPath(file)).pipe(res);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id/download", requireAuth, (req, res) => {
  try {
    const file = assertFileAccess(req.params.id, req.user.id, "read");
    res.download(getFileContentPath(file), file.name);
  } catch (err) {
    sendError(res, err);
  }
});

// Видалення лише для власника простору
router.delete("/:id", requireAuth, (req, res) => {
  try {
    assertFileAccess(req.params.id, req.user.id, "owner");
    deleteFile(req.params.id);
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;