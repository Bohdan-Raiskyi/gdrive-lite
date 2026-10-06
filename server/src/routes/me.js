const express = require("express");
const requireAuth = require("../middleware/auth");
const { getSyncSettings, saveSyncSettings, deleteSyncSettings } = require("../services/syncSettingsService");

const router = express.Router();

router.get("/sync", requireAuth, (req, res) => {
  res.json(getSyncSettings(req.user.id));
});

// Body: { folderName, spaceId }. spaceId має бути власним простором або простором з правом запису
router.put("/sync", requireAuth, (req, res) => {
  const { folderName, spaceId } = req.body;
  if (!folderName || typeof folderName !== "string") {
    return res.status(400).json({ error: "Потрібна назва папки (folderName)" });
  }
  if (!spaceId || typeof spaceId !== "string") {
    return res.status(400).json({ error: "Потрібен простір (spaceId)" });
  }
  try {
    const { assertSpaceAccess } = require("../services/accessService");
    assertSpaceAccess(spaceId, req.user.id, "edit");
    res.json(saveSyncSettings(req.user.id, { folderName, spaceId }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/sync", requireAuth, (req, res) => {
  deleteSyncSettings(req.user.id);
  res.status(204).send();
});

module.exports = router;