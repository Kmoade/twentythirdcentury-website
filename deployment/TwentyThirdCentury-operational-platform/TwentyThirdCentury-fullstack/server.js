const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === "production" && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error("Set JWT_SECRET to a random secret of at least 32 characters.");
}
const secret = JWT_SECRET || "development-only-change-this-secret-before-deploying";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const dbPath = process.env.DATABASE_PATH || "./data/twentythirdcentury.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) <= 1200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reporter_id, post_id)
);
`);
// Safe additive migration for databases created by earlier versions.
try { db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }

const count = db.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
if (count === 0) {
  const seed = db.prepare("INSERT INTO posts (user_id, body) VALUES (1, ?)");
  const user = db.prepare("SELECT id FROM users WHERE username = 'futurefriend'").get();
  if (user) {
    seed.run("Welcome to TwentyThirdCentury 🌍 A place for curious minds, brave ideas and small steps forward. What are you building, learning, or hoping for?");
    seed.run("Small reminder: you don't have to solve your whole future today. One useful step is still progress. ✨");
  }
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https:"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: []
  }
}}));
app.use(express.json({ limit: "30kb" }));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

const cleanText = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const publicUser = (u) => ({ id: u.id, username: u.username });
const isAdmin = (userId) => Boolean(ADMIN_EMAIL && db.prepare("SELECT 1 FROM users WHERE id=? AND lower(email)=?").get(userId, ADMIN_EMAIL));
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user.id)) return res.status(403).json({ error: "Administrator access is required." });
  next();
}
const makeToken = (u) => jwt.sign({ id: u.id, username: u.username }, secret, { expiresIn: "12h", issuer: "twentythirdcentury" });
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in to do that." });
  try { req.user = jwt.verify(token, secret, { issuer: "twentythirdcentury" });
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(req.user.id)) return res.status(401).json({ error: "Your account is no longer available. Please sign in again." });
    next();
  }
  catch { return res.status(401).json({ error: "Your session expired. Please sign in again." }); }
}
function handle(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
const postQuery = `
SELECT p.id, p.body, p.created_at, u.username,
 (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
 (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments,
 EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
FROM posts p JOIN users u ON u.id=p.user_id WHERE p.status='active'`;

app.get("/api/health", (req, res) => res.json({ ok: true, service: "TwentyThirdCentury", time: new Date().toISOString() }));

app.post("/api/auth/register", rateLimit({ windowMs: 60*60*1000, limit: 8, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const username = cleanText(req.body.username, 24);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Username must be 3–24 characters using letters, numbers or underscores." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be at least 10 characters." });
  try {
    const result = db.prepare("INSERT INTO users(username,email,password_hash) VALUES(?,?,?)").run(username, email, bcrypt.hashSync(password, 12));
    const user = { id: Number(result.lastInsertRowid), username };
    res.status(201).json({ token: makeToken(user), user });
  } catch (e) {
    if (String(e.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "That username or email is already registered." });
    throw e;
  }
});

app.post("/api/auth/login", rateLimit({ windowMs: 15*60*1000, limit: 12, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: "Email or password is incorrect." });
  const user = publicUser(u);
  res.json({ token: makeToken(user), user });
});

app.get("/api/me", auth, (req, res) => res.json({ user: { id: req.user.id, username: req.user.username }, isAdmin: isAdmin(req.user.id) }));

app.delete("/api/me", auth, (req, res) => {
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Your password is incorrect." });
  db.prepare("DELETE FROM users WHERE id=?").run(req.user.id);
  res.json({ deleted: true, message: "Your account and associated community data have been deleted." });
});

app.get("/api/posts", (req, res) => {
  const viewer = Number(req.query.viewerId || 0);
  const posts = db.prepare(postQuery + " ORDER BY p.id DESC LIMIT 60").all(viewer);
  const commentStmt = db.prepare("SELECT c.id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id ASC LIMIT 30");
  res.json({ posts: posts.map(p => ({ ...p, liked: Boolean(p.liked), commentsList: commentStmt.all(p.id) })) });
});

app.post("/api/posts", auth, (req, res) => {
  const body = cleanText(req.body.body, 1200);
  if (body.length < 3) return res.status(400).json({ error: "Write at least 3 characters." });
  const result = db.prepare("INSERT INTO posts(user_id,body) VALUES(?,?)").run(req.user.id, body);
  const post = db.prepare(postQuery + " AND p.id=?").get(req.user.id, result.lastInsertRowid);
  res.status(201).json({ post: { ...post, liked: Boolean(post.liked), commentsList: [] } });
});

app.post("/api/posts/:id/like", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare("SELECT id FROM posts WHERE id=? AND status='active'").get(id)) return res.status(404).json({ error: "Post not found." });
  const existing = db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(req.user.id, id);
  if (existing) db.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").run(req.user.id, id);
  else db.prepare("INSERT INTO likes(user_id,post_id) VALUES(?,?)").run(req.user.id, id);
  const likes = db.prepare("SELECT COUNT(*) n FROM likes WHERE post_id=?").get(id).n;
  res.json({ liked: !existing, likes });
});

app.post("/api/posts/:id/report", auth, rateLimit({ windowMs: 60*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const id = Number(req.params.id);
  const reasons = new Set(["spam", "harassment", "hate", "misinformation", "other"]);
  const reason = cleanText(req.body.reason, 24);
  const details = cleanText(req.body.details, 300);
  if (!Number.isInteger(id) || !db.prepare("SELECT id FROM posts WHERE id=? AND status='active'").get(id)) return res.status(404).json({ error: "Post not found." });
  if (!reasons.has(reason)) return res.status(400).json({ error: "Choose a valid report reason." });
  try { db.prepare("INSERT INTO reports(reporter_id,post_id,reason,details) VALUES(?,?,?,?)").run(req.user.id,id,reason,details); }
  catch (error) { if (String(error.code).startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "You have already reported this post." }); throw error; }
  res.status(201).json({ reported: true, message: "Thank you. Your report has been sent for review." });
});

app.get("/api/admin/reports", auth, requireAdmin, (req, res) => {
  const reports = db.prepare(`SELECT r.id,r.reason,r.details,r.status,r.created_at,p.id AS post_id,p.body AS post_body,u.username AS reporter,author.username AS author
    FROM reports r JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=r.reporter_id JOIN users author ON author.id=p.user_id
    ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.id DESC LIMIT 100`).all();
  res.json({ reports });
});

app.post("/api/admin/reports/:id/resolve", auth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const action = req.body.action === "hide" ? "hide" : "dismiss";
  const report = db.prepare("SELECT post_id FROM reports WHERE id=?").get(id);
  if (!report) return res.status(404).json({ error: "Report not found." });
  const update = db.transaction(() => {
    if (action === "hide") db.prepare("UPDATE posts SET status='hidden' WHERE id=?").run(report.post_id);
    db.prepare("UPDATE reports SET status='resolved' WHERE post_id=?").run(report.post_id);
  });
  update();
  res.json({ resolved: true, action });
});

app.post("/api/posts/:id/comments", auth, (req, res) => {
  const id = Number(req.params.id);
  const body = cleanText(req.body.body, 500);
  if (!db.prepare("SELECT id FROM posts WHERE id=? AND status='active'").get(id)) return res.status(404).json({ error: "Post not found." });
  if (body.length < 1) return res.status(400).json({ error: "Comment can't be empty." });
  const result = db.prepare("INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)").run(id, req.user.id, body);
  res.status(201).json({ comment: { id: Number(result.lastInsertRowid), body, username: req.user.username, created_at: new Date().toISOString() } });
});

app.post("/api/checkins", auth, (req, res) => {
  const allowed = new Set(["great", "good", "okay", "low", "rough"]);
  const mood = cleanText(req.body.mood, 12);
  const note = cleanText(req.body.note, 240);
  if (!allowed.has(mood)) return res.status(400).json({ error: "Choose a valid mood." });
  db.prepare("INSERT INTO checkins(user_id,mood,note) VALUES(?,?,?)").run(req.user.id, mood, note);
  res.status(201).json({ saved: true, message: "Check-in saved. Thank you for checking in with yourself." });
});

app.get("/api/checkins", auth, (req, res) => {
  const rows = db.prepare("SELECT mood,note,created_at FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 30").all(req.user.id);
  res.json({ checkins: rows });
});

app.post("/api/chat", rateLimit({ windowMs: 60*1000, limit: 20, standardHeaders: true, legacyHeaders: false }), handle(async (req, res) => {
  const message = cleanText(req.body.message, 1200);
  const agent = ["nova", "byte", "sol"].includes(req.body.agent) ? req.body.agent : "nova";
  if (message.length < 1) return res.status(400).json({ error: "Type a message first." });
  const prompts = {
    nova: "You are Nova, a practical, imaginative idea architect. Help users turn ambitious ideas into small testable steps. Be clear and honest.",
    byte: "You are Byte, a patient technology mentor. Explain technology accessibly, offer step-by-step help, and never claim to have performed actions you did not perform.",
    sol: "You are Sol, a warm wellbeing companion, not a therapist or emergency service. Be compassionate, nonjudgmental, and practical. If someone may be in immediate danger or considering self-harm, encourage them to contact local emergency services or a trusted person now. Do not diagnose or promise confidentiality."
  };
  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages: [{ role: "system", content: prompts[agent] }, { role: "user", content: message }], temperature: 0.7, max_tokens: 450 })
    });
    if (!response.ok) return res.status(502).json({ error: "The AI service is temporarily unavailable. Please try again shortly." });
    const data = await response.json();
    return res.json({ reply: data.choices?.[0]?.message?.content || "I couldn't form a response just now. Please try again." , mode: "ai" });
  }
  const text = message.toLowerCase();
  let reply;
  if (agent === "sol") {
    if (/suicid|kill myself|end my life|self.harm|hurt myself|can't go on/.test(text)) {
      reply = "I'm really sorry things feel this heavy. You deserve support right now, not to handle this alone. If you're in immediate danger, call your local emergency number (112 from a mobile phone in South Africa), go to the nearest emergency department, or contact someone you trust and ask them to stay with you. I can stay with you while you think about the next safe step, but I'm not an emergency or clinical service.";
    } else reply = "Thank you for sharing that with me. You don't have to solve everything at once. What is one small thing that might make the next ten minutes a little easier—water, a breath of fresh air, messaging someone you trust, or telling me a bit more about what's going on?";
  } else if (agent === "byte") {
    reply = "Let's make this practical. Tell me your goal, what you've tried so far, and what device or tools you're using. I'll break the next step into manageable pieces. If you're just starting, we can begin with the simplest working version.";
  } else {
    reply = "Let's give the idea a small first shape. Who is it for, what problem does it solve, and what is the smallest version you could test this week? Share your rough idea—even if it's messy—and we'll turn it into a simple plan.";
  }
  res.json({ reply, mode: "guided" });
}));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => console.log(`TwentyThirdCentury running on port ${PORT}`));
