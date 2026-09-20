/**
 * AIMLOCK MODE 10 — API GỐC v1.1
 * Chỉ nhập KEY — theo dõi thiết bị
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "TIENHOC_ADMIN_2026";

const PRESETS = {
  day:   { label: "1 ngày",   days: 1 },
  week:  { label: "1 tuần",   days: 7 },
  month: { label: "1 tháng",  days: 30 },
  year:  { label: "1 năm",    days: 365 },
  perm:  { label: "Vĩnh viễn", days: null, permanent: true }
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = { keys: {}, sessions: {}, history: [] };
      const seed = [
        ["NTH-31", "Vĩnh viễn", null, true],
        ["ALM10", "1 ngày", 1, false],
        ["ALM10.1", "1 tuần", 7, false],
        ["ALM10.2", "1 tháng", 30, false],
        ["ALM10.3", "1 năm", 365, false]
      ];
      for (const [code, label, days, permanent] of seed) {
        init.keys[code] = {
          code, label, days, permanent,
          createdAt: Date.now(), maxUses: 0, usedCount: 0, active: true, note: ""
        };
      }
      saveDB(init);
      return init;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return { keys: {}, sessions: {}, history: [] };
  }
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8"); } catch (e) {}
}

let db = loadDB();

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
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) { req.destroy(); reject(new Error("big")); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

function normalizeKey(k) { return String(k || "").trim().toUpperCase(); }
function isAdmin(req) {
  const token = req.headers["x-admin-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || "";
  return token === ADMIN_TOKEN;
}
function genKey(prefix) { return (prefix || "ALM") + "-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
function durationMs(meta) {
  if (!meta || meta.permanent || meta.days == null) return null;
  return meta.days * 24 * 60 * 60 * 1000;
}
function isSessionValid(session) {
  if (!session || !session.key || !session.deviceId) return false;
  const keyMeta = db.keys[normalizeKey(session.key)];
  if (!keyMeta || !keyMeta.active) return false;
  if (keyMeta.permanent || session.expiresAt == null) return true;
  return Date.now() < session.expiresAt;
}
function deviceFromUA(ua) {
  ua = ua || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Android/i.test(ua)) { const m = ua.match(/Android\s([\d.]+)/); return m ? "Android " + m[1] : "Android"; }
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac/i.test(ua)) return "Mac";
  return "Web Browser";
}
function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
function remainingText(session) {
  if (!session) return "Không xác định";
  if (session.expiresAt == null) return "Vĩnh viễn";
  const left = session.expiresAt - Date.now();
  if (left <= 0) return "Đã hết hạn";
  const sec = Math.floor(left / 1000);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts = [];
  if (d > 0) parts.push(d + " ngày");
  if (h > 0) parts.push(h + " giờ");
  if (m > 0) parts.push(m + " phút");
  if (d === 0 && h === 0) parts.push(s + " giây");
  return "Còn " + (parts.join(" ") || "0 giây");
}
function logHistory(action, detail) {
  db.history.unshift({ id: crypto.randomBytes(6).toString("hex"), action, detail, at: Date.now() });
  if (db.history.length > 500) db.history = db.history.slice(0, 500);
}
function sessionsForKey(keyCode) {
  const code = normalizeKey(keyCode);
  return Object.values(db.sessions).filter((s) => normalizeKey(s.key) === code);
}
function validDevicesForKey(keyCode) { return sessionsForKey(keyCode).filter(isSessionValid); }
function sessionPayload(session) {
  return {
    key: session.key, deviceId: session.deviceId, device: session.device,
    activatedAt: session.activatedAt, expiresAt: session.expiresAt,
    label: session.label, permanent: session.permanent,
    remaining: remainingText(session),
    startText: formatDate(session.activatedAt),
    expireText: session.expiresAt == null ? "Vĩnh viễn" : formatDate(session.expiresAt)
  };
}

async function handle(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const method = req.method.toUpperCase();
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token" });
    return res.end();
  }

  if (method === "GET" && p === "/api/health") {
    return json(res, 200, { ok: true, name: "AIMLOCK MODE 10 API", version: "1.1.0", time: new Date().toISOString() });
  }

  if (method === "POST" && p === "/api/activate") {
    const body = await readBody(req);
    const keyCode = normalizeKey(body.key);
    let deviceId = String(body.deviceId || "").trim();
    const device = body.device || deviceFromUA(req.headers["user-agent"]);
    if (!keyCode) return json(res, 400, { ok: false, error: "Vui lòng nhập key." });
    if (!deviceId) deviceId = crypto.randomBytes(12).toString("hex");

    const keyMeta = db.keys[keyCode];
    if (!keyMeta || !keyMeta.active) {
      return json(res, 403, { ok: false, error: "KEY CHƯA ĐƯỢC ADMIN TIEN HOC KÍCH HOẠT" });
    }

    const others = validDevicesForKey(keyCode).filter((s) => s.deviceId !== deviceId);
    if (keyMeta.maxUses > 0 && others.length >= keyMeta.maxUses) {
      const existing = db.sessions[deviceId];
      if (!existing || normalizeKey(existing.key) !== keyCode) {
        return json(res, 403, { ok: false, error: "Key đã đủ số thiết bị cho phép (" + keyMeta.maxUses + ")." });
      }
    }

    const prev = db.sessions[deviceId];
    let activatedAt = Date.now();
    if (prev && normalizeKey(prev.key) === keyCode && prev.activatedAt) activatedAt = Number(prev.activatedAt);
    const ms = durationMs(keyMeta);
    let expiresAt = ms == null ? null : activatedAt + ms;

    if (prev && normalizeKey(prev.key) === keyCode && prev.expiresAt != null && Date.now() >= prev.expiresAt) {
      logHistory("activate_denied_expired", { key: keyCode, deviceId });
      saveDB(db);
      return json(res, 403, { ok: false, error: "Key đã hết hạn. Vui lòng liên hệ ADMIN TIEN HOC." });
    }
    if (prev && prev.key && normalizeKey(prev.key) !== keyCode) {
      activatedAt = Date.now();
      expiresAt = ms == null ? null : activatedAt + ms;
    }

    const session = {
      deviceId, key: keyMeta.code, device, activatedAt, expiresAt,
      lastSeen: Date.now(), label: keyMeta.label, permanent: !!keyMeta.permanent
    };
    const isNew = !prev || normalizeKey(prev.key) !== keyCode;
    db.sessions[deviceId] = session;
    if (isNew) keyMeta.usedCount = (keyMeta.usedCount || 0) + 1;
    logHistory("activate", { key: keyMeta.code, deviceId, device });
    saveDB(db);
    return json(res, 200, {
      ok: true, session: sessionPayload(session),
      deviceCount: validDevicesForKey(keyCode).length,
      maxDevices: keyMeta.maxUses || 0
    });
  }

  if ((method === "POST" && p === "/api/validate") || (method === "GET" && p === "/api/session")) {
    let deviceId;
    if (method === "POST") {
      const body = await readBody(req);
      deviceId = String(body.deviceId || "").trim();
    } else deviceId = String(url.searchParams.get("deviceId") || "").trim();
    if (!deviceId) return json(res, 400, { ok: false, error: "Thiếu deviceId" });
    const session = db.sessions[deviceId];
    if (!session || !isSessionValid(session)) {
      return json(res, 200, { ok: false, valid: false, error: "Key đã hết hạn / Chưa kích hoạt" });
    }
    session.lastSeen = Date.now();
    saveDB(db);
    return json(res, 200, {
      ok: true, valid: true, session: sessionPayload(session),
      deviceCount: validDevicesForKey(session.key).length
    });
  }

  if (method === "POST" && p === "/api/logout") {
    const body = await readBody(req);
    const deviceId = String(body.deviceId || "").trim();
    if (deviceId && db.sessions[deviceId]) {
      logHistory("logout", { deviceId, key: db.sessions[deviceId].key });
      delete db.sessions[deviceId];
      saveDB(db);
    }
    return json(res, 200, { ok: true });
  }

  if (!isAdmin(req) && p.startsWith("/api/admin")) {
    return json(res, 401, { ok: false, error: "Unauthorized — cần Admin Token" });
  }

  if (method === "GET" && p === "/api/admin/keys") {
    const q = String(url.searchParams.get("q") || "").trim().toUpperCase();
    let list = Object.values(db.keys).map((k) => {
      const all = sessionsForKey(k.code);
      const valid = all.filter(isSessionValid);
      return {
        ...k, usedCount: k.usedCount || 0,
        deviceCount: valid.length, totalDevicesEver: all.length,
        devices: valid.map((s) => ({
          deviceId: s.deviceId, device: s.device,
          activatedAt: s.activatedAt, lastSeen: s.lastSeen,
          startText: formatDate(s.activatedAt), lastSeenText: formatDate(s.lastSeen),
          remaining: remainingText(s)
        }))
      };
    });
    if (q) {
      list = list.filter((k) =>
        k.code.includes(q) || (k.note && String(k.note).toUpperCase().includes(q)) ||
        (k.label && String(k.label).toUpperCase().includes(q))
      );
    }
    return json(res, 200, { ok: true, keys: list });
  }

  if (method === "GET" && /^\/api\/admin\/keys\/[^/]+$/.test(p)) {
    const code = normalizeKey(p.replace("/api/admin/keys/", ""));
    const keyMeta = db.keys[code];
    if (!keyMeta) return json(res, 404, { ok: false, error: "Không tìm thấy key" });
    const all = sessionsForKey(code);
    const valid = all.filter(isSessionValid);
    return json(res, 200, {
      ok: true,
      key: {
        ...keyMeta, deviceCount: valid.length, totalDevicesEver: all.length,
        devices: valid.map((s) => ({
          deviceId: s.deviceId, device: s.device,
          startText: formatDate(s.activatedAt), lastSeenText: formatDate(s.lastSeen),
          remaining: remainingText(s),
          expireText: s.expiresAt == null ? "Vĩnh viễn" : formatDate(s.expiresAt)
        }))
      }
    });
  }

  if (method === "POST" && p === "/api/admin/keys") {
    const body = await readBody(req);
    let meta = {};
    if (body.preset && PRESETS[body.preset]) meta = Object.assign({}, PRESETS[body.preset]);
    else {
      meta.label = body.label || "Custom";
      meta.days = body.permanent ? null : Number(body.days) || 1;
      meta.permanent = !!body.permanent;
    }
    const code = normalizeKey(body.code || genKey("ALM"));
    if (db.keys[code]) return json(res, 409, { ok: false, error: "Key đã tồn tại: " + code });
    const entry = {
      code, label: meta.label, days: meta.permanent ? null : meta.days, permanent: !!meta.permanent,
      createdAt: Date.now(), maxUses: Number(body.maxUses) || 0, usedCount: 0, active: true, note: body.note || ""
    };
    db.keys[code] = entry;
    logHistory("key_create", { code });
    saveDB(db);
    return json(res, 201, { ok: true, key: entry });
  }

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
    logHistory("key_update", { code });
    saveDB(db);
    return json(res, 200, { ok: true, key: keyMeta });
  }

  if (method === "DELETE" && p.startsWith("/api/admin/keys/")) {
    const code = normalizeKey(p.replace("/api/admin/keys/", ""));
    if (!db.keys[code]) return json(res, 404, { ok: false, error: "Không tìm thấy key" });
    for (const id of Object.keys(db.sessions)) {
      if (normalizeKey(db.sessions[id].key) === code) delete db.sessions[id];
    }
    delete db.keys[code];
    logHistory("key_delete", { code });
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  if (method === "DELETE" && p.startsWith("/api/admin/devices/")) {
    const deviceId = decodeURIComponent(p.replace("/api/admin/devices/", ""));
    if (!db.sessions[deviceId]) return json(res, 404, { ok: false, error: "Không có thiết bị" });
    logHistory("device_kick", { deviceId, key: db.sessions[deviceId].key });
    delete db.sessions[deviceId];
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  if (method === "GET" && p === "/api/admin/sessions") {
    const list = Object.values(db.sessions).map((s) => ({
      ...sessionPayload(s), valid: isSessionValid(s),
      lastSeen: s.lastSeen, lastSeenText: formatDate(s.lastSeen)
    }));
    return json(res, 200, { ok: true, sessions: list });
  }

  if (method === "GET" && p === "/api/admin/stats") {
    const keys = Object.values(db.keys);
    const sessions = Object.values(db.sessions);
    return json(res, 200, {
      ok: true,
      stats: {
        totalKeys: keys.length, activeKeys: keys.filter((k) => k.active).length,
        totalSessions: sessions.length, validSessions: sessions.filter(isSessionValid).length,
        historyCount: db.history.length
      }
    });
  }

  if (method === "GET" && (p === "/" || p === "/app")) {
    for (const appPath of [path.join(__dirname, "public", "app.html"), path.join(__dirname, "app.html")]) {
      if (fs.existsSync(appPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(appPath));
      }
    }
  }
  if (method === "GET" && p === "/admin") {
    for (const adminPath of [path.join(__dirname, "public", "admin.html"), path.join(__dirname, "admin.html")]) {
      if (fs.existsSync(adminPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(adminPath));
      }
    }
  }
  if (method === "GET") {
    const safe = p.replace(/\\/g, "/").split("/").filter((x) => x !== "..").join("/") || "/";
    const name = safe === "/" ? "app.html" : safe.replace(/^\//, "");
    for (const c of [path.join(__dirname, "public", name), path.join(__dirname, name)]) {
      if (c.startsWith(__dirname) && fs.existsSync(c) && fs.statSync(c).isFile()) {
        const ext = path.extname(c).toLowerCase();
        const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        return res.end(fs.readFileSync(c));
      }
    }
  }
  json(res, 404, { ok: false, error: "Not found", path: p });
}

http.createServer((req, res) => {
  handle(req, res).catch((err) => { console.error(err); json(res, 500, { ok: false, error: "Internal Server Error" }); });
}).listen(PORT, HOST, () => {
  console.log("AIMLOCK API v1.1 — key-only + devices | http://localhost:" + PORT);
});
