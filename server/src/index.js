require("dotenv").config();const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const db = require("./db");
const authRoutes = require("./routes/auth");
const filesRoutes = require("./routes/files");
const sharesRoutes = require("./routes/shares");
const meRoutes = require("./routes/me");
const requireAuth = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use("/auth", authRoutes);
app.use("/files", filesRoutes);
app.use("/shares", sharesRoutes);
app.use("/me", meRoutes);

app.get("/whoami", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/health", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const fileCount = db.prepare("SELECT COUNT(*) AS count FROM files").get().count;
  res.json({ status: "ok", users: userCount, files: fileCount, time: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Сервер запущено: http://localhost:${PORT}`));
}

module.exports = app;