const express = require("express");
const jwt = require("jsonwebtoken");
const { registerUser, verifyCredentials } = require("../services/authService");

const router = express.Router();

router.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: "Потрібні username і password (мінімум 4 символи)" });
  }
  try {
    const user = registerUser(username, password);
    res.status(201).json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = verifyCredentials(username, password);
  if (!user) {
    return res.status(401).json({ error: "Невірний логін або пароль" });
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

  res.json({ token, user });
});

module.exports = router;