/**
 * AIMLOCK MODE 10 — API GỐC (Key System)
 * Pure Node.js, không phụ thuộc package ngoài.
 * Chạy: node server.js
 * Mặc định: http://localhost:3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// ===================== CONFIG =====================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "TIENHOC_ADMIN_2026"; // ĐỔI TOKEN NÀY!
const JWT_SECRET = process.env.JWT_SECRET || "alm10_secret_change_me_" + crypto.randomBytes(8).toString("hex");

// Thời hạn mặc định (ngày) — dùng khi tạo key
const PRESETS = {
  day:   { label: "1 ngày",   days: 1 },
  week:  { label: "1 tuần",   days: 7 },
  month: { label: "1 tháng",  days: 30 },
  year:  { label: "1 năm",    days: 365 },
  perm:  { label: "Vĩnh viễn", days: null, permanent: true }
};

// ===================== DB (JSON file) =====================
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = {
        keys: {},       // keyCode -> { code, label, days, permanent, createdAt, maxUses, usedCount, active, note }
        sessions: {},   // usernameLower -> { user, key, device, activatedAt, expiresAt, lastSeen }
        history: []     // log activate / revoke
      };
      // seed key vĩnh viễn
      init.keys["NTH-31"] = {
        code: "NTH-31",
        label: "Vĩnh viễn",
        days: null,
        permanent: true,
        createdAt: Date.now(),
        maxUses: 0, // 0 = unlimited
        usedCount: 0,
        active: true,
        note: "Admin permanent"
      };
      init.keys["ALM10"] = {
        code: "ALM10",
        label: "1 ngày",
        days: 1,
        permanent: false,
        createdAt: Date.now(),
        maxUses: 0,
        usedCount: 0,
        active: true,
        note: ""
      };
      init.keys["ALM10.1"] = {
        code: "ALM10.1",
        label: "1 tuần",
        days: 7,
        permanent: false,
        createdAt: Date.now(),
        maxUses: 0,
        usedCount: 0,
        active: true,
        note: ""
      };
      init.keys["ALM10.2"] = {
        code: "ALM10.2",
        label: "1 tháng",
        days: 30,
        permanent: false,
        createdAt: Date.now(),
        maxUses: 0,
        usedCount: 0,
        active: true,
        note: ""
      };
      init.keys["ALM10.3"] = {
        code: "ALM10.3",
        label: "1 năm",
        days: 365,
        permanent: false,
        createdAt: Date.now(),
        maxUses: 0,
        usedCount: 0,
        active: true,
        note: ""
      };
      saveDB(init);
      return init;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    console.error("DB load error:", e.message);
    return { keys: {}, sessions: {}, history: [] };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save error:", e.message);
  }
}

let db = loadDB();

// ===================== HELPERS =====================
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function normalizeKey(k) {
  return String(k || "").trim().toUpperCase();
}

function normalizeUser(u) {
  return String(u || "").trim();
}

function userId(u) {
  return normalizeUser(u).toLowerCase();
}

function isAdmin(req) {
  const token =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    "";
  return token === ADMIN_TOKEN;
}

function genKey(prefix = "ALM") {
  const part = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${part}`;
}

function durationMs(meta) {
  if (!meta || meta.permanent || meta.days == null) return null;
  return meta.days * 24 * 60 * 60 * 1000;
}

function isSessionValid(session) {
  if (!session || !session.user || !session.key) return false;
  const keyMeta = db.keys[normalizeKey(session.key)];
  if (!keyMeta || !keyMeta.active) return false;
  if (keyMeta.permanent || session.expiresAt == null) return true;
  return Date.now() < session.expiresAt;
}

function deviceFromUA(ua) {
  ua = ua || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([\d.]+)/);
    return m ? "Android " + m[1] : "Android";
  }
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac/i.test(ua)) return "Mac";
  return "Web Browser";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function remainingText(session) {
  if (!session) return "Không xác định";
  if (session.expiresAt == null) return "Vĩnh viễn";
  const left = session.expiresAt - Date.now();
  if (left <= 0) return "Đã hết hạn";
  const sec = Math.floor(left / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d > 0) parts.push(d + " ngày");
  if (h > 0) parts.push(h + " giờ");
  if (m > 0) parts.push(m + " phút");
  if (d === 0 && h === 0) parts.push(s + " giây");
  return "Còn " + (parts.join(" ") || "0 giây");
}

function logHistory(action, detail) {
  db.history.unshift({
    id: crypto.randomBytes(6).toString("hex"),
    action,
    detail,
    at: Date.now()
  });
  if (db.history.length > 500) db.history = db.history.slice(0, 500);
}

// ===================== ROUTES =====================
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method.toUpperCase();
  const p = url.pathname.replace(/\/+$/, "") || "/";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token"
    });
    return res.end();
  }

  // Health
  if (method === "GET" && p === "/api/health") {
    return json(res, 200, {
      ok: true,
      name: "AIMLOCK MODE 10 API",
      version: "1.0.0",
      time: new Date().toISOString()
    });
  }

  // ---------- PUBLIC: Activate ----------
  // POST /api/activate  { user, key, device? }
  if (method === "POST" && p === "/api/activate") {
    const body = await readBody(req);
    const user = normalizeUser(body.user);
    const keyCode = normalizeKey(body.key);
    const device = body.device || deviceFromUA(req.headers["user-agent"]);

    if (!user) return json(res, 400, { ok: false, error: "Vui lòng nhập tài khoản." });
    if (!keyCode) return json(res, 400, { ok: false, error: "Vui lòng nhập key." });

    const keyMeta = db.keys[keyCode];
    if (!keyMeta || !keyMeta.active) {
      return json(res, 403, {
        ok: false,
        error: "TK/MK HIỆN CHƯA ĐƯỢC ADMIN TIEN HOC KÍCH HOẠT"
      });
    }

    if (keyMeta.maxUses > 0 && keyMeta.usedCount >= keyMeta.maxUses) {
      return json(res, 403, { ok: false, error: "Key đã hết lượt sử dụng." });
    }

    const uid = userId(user);
    const prev = db.sessions[uid];

    // Giữ mốc activatedAt lần đầu của username (giống logic cũ)
    let activatedAt = Date.now();
    if (prev && prev.activatedAt) {
      activatedAt = Math.min(Number(prev.activatedAt), activatedAt);
    }

    const ms = durationMs(keyMeta);
    let expiresAt = ms == null ? null : activatedAt + ms;

    // Nếu đã từng kích hoạt và đã hết hạn → không cho dùng lại cùng key cũ
    if (prev && prev.expiresAt != null && Date.now() >= prev.expiresAt && prev.key === keyCode) {
      logHistory("activate_denied_expired", { user, key: keyCode });
      saveDB(db);
      return json(res, 403, {
        ok: false,
        error: "Key đã hết hạn. Vui lòng liên hệ ADMIN TIEN HOC."
      });
    }

    // Nếu đổi key mới (admin cấp key mới) thì reset thời hạn từ bây giờ
    if (prev && prev.key && prev.key !== keyCode) {
      activatedAt = Date.now();
      expiresAt = ms == null ? null : activatedAt + ms;
    }

    const session = {
      user,
      key: keyMeta.code,
      device,
      activatedAt,
      expiresAt,
      lastSeen: Date.now(),
      label: keyMeta.label,
      permanent: !!keyMeta.permanent
    };

    db.sessions[uid] = session;
    keyMeta.usedCount = (keyMeta.usedCount || 0) + 1;
    logHistory("activate", { user, key: keyMeta.code, device });
    saveDB(db);

    return json(res, 200, {
      ok: true,
      session: {
        user: session.user,
        key: session.key,
        device: session.device,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        label: session.label,
        permanent: session.permanent,
        remaining: remainingText(session),
        startText: formatDate(session.activatedAt),
        expireText: session.expiresAt == null ? "Vĩnh viễn" : formatDate(session.expiresAt)
      }
    });
  }

  // ---------- PUBLIC: Validate / me ----------
  // POST /api/validate  { user }  hoặc  GET /api/session?user=
  if (
    (method === "POST" && p === "/api/validate") ||
    (method === "GET" && p === "/api/session")
  ) {
    let user;
    if (method === "POST") {
      const body = await readBody(req);
      user = normalizeUser(body.user);
    } else {
      user = normalizeUser(url.searchParams.get("user"));
    }
    if (!user) return json(res, 400, { ok: false, error: "Thiếu user" });

    const session = db.sessions[userId(user)];
    if (!session || !isSessionValid(session)) {
      return json(res, 200, {
        ok: false,
        valid: false,
        error: "Key đã hết hạn / Chưa kích hoạt"
      });
    }

    session.lastSeen = Date.now();
    saveDB(db);

    return json(res, 200, {
      ok: true,
      valid: true,
      session: {
        user: session.user,
        key: session.key,
        device: session.device,
        activatedAt: session.activatedAt,
        expiresAt: session.expiresAt,
        label: session.label,
        permanent: session.permanent,
        remaining: remainingText(session),
        startText: formatDate(session.activatedAt),
        expireText: session.expiresAt == null ? "Vĩnh viễn" : formatDate(session.expiresAt)
      }
    });
  }

  // ---------- PUBLIC: Logout (optional) ----------
  if (method === "POST" && p === "/api/logout") {
    const body = await readBody(req);
    const user = normalizeUser(body.user);
    if (user && db.sessions[userId(user)]) {
      logHistory("logout", { user });
      // Không xóa session để giữ lịch sử activatedAt; chỉ đánh dấu
      // Nếu muốn xóa hẳn: delete db.sessions[userId(user)];
      saveDB(db);
    }
    return json(res, 200, { ok: true });
  }

  // ========== ADMIN (cần X-Admin-Token) ==========
  if (!isAdmin(req) && p.startsWith("/api/admin")) {
    return json(res, 401, { ok: false, error: "Unauthorized — cần Admin Token" });
  }

  // GET /api/admin/keys
  if (method === "GET" && p === "/api/admin/keys") {
    const list = Object.values(db.keys).map((k) => ({
      ...k,
      usedCount: k.usedCount || 0
    }));
    return json(res, 200, { ok: true, keys: list });
  }

  // POST /api/admin/keys  — tạo key mới
  // body: { code?, label?, days?, permanent?, maxUses?, note?, preset? }
  if (method === "POST" && p === "/api/admin/keys") {
    const body = await readBody(req);
    let meta = {};
    if (body.preset && PRESETS[body.preset]) {
      meta = { ...PRESETS[body.preset] };
    } else {
      meta.label = body.label || "Custom";
      meta.days = body.permanent ? null : Number(body.days) || 1;
      meta.permanent = !!body.permanent;
    }

    const code = normalizeKey(body.code || genKey("ALM"));
    if (db.keys[code]) {
      return json(res, 409, { ok: false, error: "Key đã tồn tại: " + code });
    }

    const entry = {
      code,
      label: meta.label,
      days: meta.permanent ? null : meta.days,
      permanent: !!meta.permanent,
      createdAt: Date.now(),
      maxUses: Number(body.maxUses) || 0,
      usedCount: 0,
      active: true,
      note: body.note || ""
    };
    db.keys[code] = entry;
    logHistory("key_create", { code, label: entry.label });
    saveDB(db);
    return json(res, 201, { ok: true, key: entry });
  }

  // PUT /api/admin/keys/:code  — sửa / bật tắt
  if (method === "PUT" && p.startsWith("/api/admin/keys/")) {
    const code = normalizeKey(p.replace("/api/admin/keys/", ""));
    const keyMeta = db.keys[code];
    if (!keyMeta) return json(res, 404, { ok: false, error: "Không tìm thấy key" });

    const body = await readBody(req);
    if (typeof body.active === "boolean") keyMeta.active = body.active;
    if (body.label) keyMeta.label = body.label;
    if (body.note !== undefined) keyMeta.note = body.note;
    if (body.maxUses !== undefined) keyMeta.maxUses = Number(body.maxUses) || 0;
    if (body.days !== undefined) {
      keyMeta.days = body.days == null ? null : Number(body.days);
      keyMeta.permanent = body.days == null;
    }
    logHistory("key_update", { code, changes: body });
    saveDB(db);
    return json(res, 200, { ok: true, key: keyMeta });
  }

  // DELETE /api/admin/keys/:code
  if (method === "DELETE" && p.startsWith("/api/admin/keys/")) {
    const code = normalizeKey(p.replace("/api/admin/keys/", ""));
    if (!db.keys[code]) return json(res, 404, { ok: false, error: "Không tìm thấy key" });
    delete db.keys[code];
    logHistory("key_delete", { code });
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // GET /api/admin/sessions
  if (method === "GET" && p === "/api/admin/sessions") {
    const list = Object.values(db.sessions).map((s) => ({
      ...s,
      valid: isSessionValid(s),
      remaining: remainingText(s),
      startText: formatDate(s.activatedAt),
      expireText: s.expiresAt == null ? "Vĩnh viễn" : formatDate(s.expiresAt)
    }));
    return json(res, 200, { ok: true, sessions: list });
  }

  // DELETE /api/admin/sessions/:user  — thu hồi quyền user
  if (method === "DELETE" && p.startsWith("/api/admin/sessions/")) {
    const u = decodeURIComponent(p.replace("/api/admin/sessions/", ""));
    const uid = userId(u);
    if (!db.sessions[uid]) return json(res, 404, { ok: false, error: "Không có session" });
    delete db.sessions[uid];
    logHistory("session_revoke", { user: u });
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // GET /api/admin/history
  if (method === "GET" && p === "/api/admin/history") {
    return json(res, 200, { ok: true, history: db.history.slice(0, 100) });
  }

  // GET /api/admin/stats
  if (method === "GET" && p === "/api/admin/stats") {
    const keys = Object.values(db.keys);
    const sessions = Object.values(db.sessions);
    return json(res, 200, {
      ok: true,
      stats: {
        totalKeys: keys.length,
        activeKeys: keys.filter((k) => k.active).length,
        totalSessions: sessions.length,
        validSessions: sessions.filter((s) => isSessionValid(s)).length,
        historyCount: db.history.length
      }
    });
  }

  // Serve main app (AIMLOCK web)
  if (method === "GET" && (p === "/" || p === "/app")) {
    const appPath = path.join(__dirname, "public", "app.html");
    if (fs.existsSync(appPath)) {
      const html = fs.readFileSync(appPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
  }

  // Serve admin panel
  if (method === "GET" && p === "/admin") {
    const html = fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  // Static files from public/
  if (method === "GET") {
    const safe = p.replace(/\\/g, "/").split("/").filter(function(x){return x!=="..";}).join("/") || "/";
    const filePath = path.join(__dirname, "public", safe === "/" ? "app.html" : safe);
    if (filePath.startsWith(path.join(__dirname, "public")) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      return res.end(fs.readFileSync(filePath));
    }
  }

  json(res, 404, { ok: false, error: "Not found", path: p });
}

// ===================== START =====================
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    json(res, 500, { ok: false, error: "Internal Server Error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   AIMLOCK MODE 10 — API GỐC                  ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Web:    http://localhost:${PORT}/               ║`);
  console.log(`║  Admin:  http://localhost:${PORT}/admin          ║`);
  console.log(`║  Token:  ${ADMIN_TOKEN}`);
  console.log(`║                                              ║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
  console.log("Endpoints:");
  console.log("  POST /api/activate     { user, key }");
  console.log("  POST /api/validate     { user }");
  console.log("  GET  /api/session?user=");
  console.log("  GET  /api/admin/keys          (header X-Admin-Token)");
  console.log("  POST /api/admin/keys          tạo key");
  console.log("  PUT  /api/admin/keys/:code");
  console.log("  DELETE /api/admin/keys/:code");
  console.log("  GET  /api/admin/sessions");
  console.log("  DELETE /api/admin/sessions/:user");
  console.log("");
});
