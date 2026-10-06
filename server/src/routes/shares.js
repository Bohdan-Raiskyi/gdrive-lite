const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  listMembersOfSpace, listSpacesSharedWithMe, addMember, updateRole, removeShare
} = require("../services/sharesService");

const router = express.Router();

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

// Учасники мого простору
router.get("/members", requireAuth, (req, res) => {
  res.json(listMembersOfSpace(req.user.id));
});

// Простори, до яких маю доступ
router.get("/spaces", requireAuth, (req, res) => {
  res.json(listSpacesSharedWithMe(req.user.id));
});

// Запросити користувача за логіном: { username, role }
router.post("/members", requireAuth, (req, res) => {
  try {
    const { username, role } = req.body;
    if (!username) return res.status(400).json({ error: "Потрібен username" });
    const member = addMember({ ownerId: req.user.id, username, role });
    res.status(201).json(member);
  } catch (err) {
    sendError(res, err);
  }
});

// Змінити роль: { role }
router.patch("/members/:id", requireAuth, (req, res) => {
  try {
    const share = updateRole({ ownerId: req.user.id, shareId: req.params.id, role: req.body.role });
    res.json(share);
  } catch (err) {
    sendError(res, err);
  }
});

// Зняти доступ: власник прибирає учасника, учасник відмовляється від простору
router.delete("/:id", requireAuth, (req, res) => {
  try {
    removeShare({ shareId: req.params.id, currentUserId: req.user.id });
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;