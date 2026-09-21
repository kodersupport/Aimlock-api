/**
 * AIMLOCK MODE 10 — API GỐC v1.2
 * Key-only + devices + JSONBin persist + thông báo admin
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
const JSONBIN_BIN_ID = (process.env.JSONBIN_BIN_ID || "").trim();
const JSONBIN_API_KEY = (process.env.JSONBIN_API_KEY || "").trim();

const PRESETS = {
  day:   { label: "1 ngày",   days: 1 },
  week:  { label: "1 tuần",   days: 7 },
  month: { label: "1 tháng",  days: 30 },
  year:  { label: "1 năm",    days: 365 },
  perm:  { label: "Vĩnh viễn", days: null, permanent: true }
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultDB() {
  const init = {
    keys: {},
    sessions: {},
    history: [],
    firstActivate: {},
    announce: { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null }, maintenance: { enabled: false, reason: "", updatedAt: null }
  };
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
  return init;
}

function normalizeDB(o) {
  if (!o || typeof o !== "object") return defaultDB();
  if (!o.keys || typeof o.keys !== "object") o.keys = {};
  if (!o.sessions || typeof o.sessions !== "object") o.sessions = {};
  if (!Array.isArray(o.history)) o.history = [];
  if (!o.firstActivate || typeof o.firstActivate !== "object") o.firstActivate = {};
  if (!o.announce || typeof o.announce !== "object") {
    o.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
  }
  if (!o.announce.title) o.announce.title = "THÔNG BÁO";
  if (!o.maintenance || typeof o.maintenance !== "object") {
    o.maintenance = { enabled: false, reason: "", updatedAt: null };
  }
  return o;
}

function readLocal() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return normalizeDB(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
    }
  } catch (e) {}
  return null;
}

function writeLocal(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {}
}

async function readRemote() {
  if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
    return { ok: false, reason: "not_configured", data: null };
  }
  try {
    const r = await fetch("https://api.jsonbin.io/v3/b/" + JSONBIN_BIN_ID + "/latest", {
      headers: {
        "X-Master-Key": JSONBIN_API_KEY,
        "X-Bin-Meta": "false"
      }
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (!r.ok) {
      console.log("JSONBin READ fail:", r.status, text.slice(0, 200));
      return { ok: false, reason: "http_" + r.status, data: null };
    }
    const rec = j && (j.record !== undefined ? j.record : j);
    if (!rec || typeof rec !== "object") {
      return { ok: false, reason: "bad_shape", data: null };
    }
    return { ok: true, reason: "ok", data: normalizeDB(rec) };
  } catch (e) {
    console.log("JSONBin READ error:", e.message);
    return { ok: false, reason: "exception", data: null };
  }
}

let _saveRemoteTimer = null;
let _persistReady = false;
let _persistStatus = "starting";

function writeRemote(data) {
  if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) return;
  if (_saveRemoteTimer) clearTimeout(_saveRemoteTimer);
  _saveRemoteTimer = setTimeout(async () => {
    try {
      const r = await fetch("https://api.jsonbin.io/v3/b/" + JSONBIN_BIN_ID, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Master-Key": JSONBIN_API_KEY
        },
        body: JSON.stringify(data)
      });
      if (!r.ok) {
        const t = await r.text();
        console.log("JSONBin WRITE fail:", r.status, t.slice(0, 200));
      } else {
        console.log("JSONBin WRITE ok — keys:", Object.keys(data.keys || {}).length);
      }
    } catch (e) {
      console.log("JSONBin WRITE error:", e.message);
    }
  }, 500);
}

function saveDB(data) {
  writeLocal(data);
  writeRemote(data);
}

let db = normalizeDB(readLocal() || defaultDB());

async function bootstrapRemote() {
  const remote = await readRemote();
  if (remote.ok && remote.data) {
    const n = Object.keys(remote.data.keys || {}).length;
    if (n > 0) {
      db = remote.data;
      writeLocal(db);
      _persistStatus = "loaded_remote (" + n + " keys)";
      console.log("DB from JSONBin:", n, "keys");
    } else {
      // Remote thật sự trống → seed 1 lần
      saveDB(db);
      _persistStatus = "seeded_empty_remote";
      console.log("JSONBin empty → seeded defaults");
    }
  } else if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
    _persistStatus = "no_jsonbin_env";
    console.log("WARN: Chưa có JSONBIN_BIN_ID / JSONBIN_API_KEY — data MẤT khi restart!");
  } else {
    // Đọc remote lỗi → KHÔNG ghi đè remote
    _persistStatus = "read_failed:" + remote.reason + " (kept local/default, NOT overwrite)";
    console.log("JSONBin read failed → giữ data local, KHÔNG ghi đè remote. reason=", remote.reason);
  }
  _persistReady = true;
}

const bootPromise = bootstrapRemote();

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
        reject(new Error("big"));
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function normalizeKey(k) { return String(k || "").trim().toUpperCase(); }
function isAdmin(req) {
  const token = req.headers["x-admin-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || "";
  return token === ADMIN_TOKEN;
}
function genKey(prefix) {
  return (prefix || "ALM") + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}
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
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
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
  db.history.unshift({ id: crypto.randomBytes(6).toString("hex"), action, detail, at: Date.now() });
  if (db.history.length > 500) db.history = db.history.slice(0, 500);
}
function sessionsForKey(keyCode) {
  const code = normalizeKey(keyCode);
  return Object.values(db.sessions).filter((s) => normalizeKey(s.key) === code);
}
function validDevicesForKey(keyCode) {
  return sessionsForKey(keyCode).filter(isSessionValid);
}
function sessionPayload(session) {
  return {
    key: session.key,
    deviceId: session.deviceId,
    device: session.device,
    activatedAt: session.activatedAt,
    expiresAt: session.expiresAt,
    label: session.label,
    permanent: session.permanent,
    remaining: remainingText(session),
    startText: formatDate(session.activatedAt),
    expireText: session.expiresAt == null ? "Vĩnh viễn" : formatDate(session.expiresAt)
  };
}

async function handle(req, res) {
  await bootPromise;

  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const method = req.method.toUpperCase();
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token"
    });
    return res.end();
  }

  if (method === "GET" && p === "/api/health") {
    return json(res, 200, {
      ok: true,
      name: "AIMLOCK MODE 10 API",
      version: "1.2.0",
      time: new Date().toISOString(),
      persist: !!(JSONBIN_BIN_ID && JSONBIN_API_KEY),
      persistStatus: _persistStatus,
      keyCount: Object.keys(db.keys || {}).length
    });
  }

  // PUBLIC announce + maintenance
  if (method === "GET" && p === "/api/announce") {
    if (!db.announce) db.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
    if (!db.maintenance) db.maintenance = { enabled: false, reason: "", updatedAt: null };
    return json(res, 200, {
      ok: true,
      announce: {
        title: db.announce.title || "THÔNG BÁO",
        text: db.announce.text || "",
        enabled: !!db.announce.enabled,
        updatedAt: db.announce.updatedAt || null
      },
      maintenance: {
        enabled: !!db.maintenance.enabled,
        reason: db.maintenance.reason || "",
        updatedAt: db.maintenance.updatedAt || null
      }
    });
  }

  if (method === "POST" && p === "/api/activate") {
    if (db.maintenance && db.maintenance.enabled) {
      return json(res, 503, {
        ok: false,
        error: "Ứng dụng đang bảo trì.\n" + (db.maintenance.reason || "Vui lòng quay lại sau."),
        maintenance: true,
        reason: (db.maintenance && db.maintenance.reason) || ""
      });
    }
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
        return json(res, 403, {
          ok: false,
          error: "Key đã đủ số thiết bị cho phép (" + keyMeta.maxUses + ")."
        });
      }
    }

    if (!db.firstActivate) db.firstActivate = {};
    const stampKey = deviceId + "|" + keyCode;
    const prev = db.sessions[deviceId];
    const prevStamp = db.firstActivate[stampKey];

    let activatedAt = Date.now();
    if (prevStamp) activatedAt = Number(prevStamp);
    else if (prev && normalizeKey(prev.key) === keyCode && prev.activatedAt) {
      activatedAt = Number(prev.activatedAt);
    }

    const ms = durationMs(keyMeta);
    let expiresAt = ms == null ? null : activatedAt + ms;

    if (expiresAt != null && Date.now() >= expiresAt) {
      logHistory("activate_denied_expired", { key: keyCode, deviceId });
      saveDB(db);
      return json(res, 403, {
        ok: false,
        error: "Key đã hết hạn. Vui lòng liên hệ ADMIN TIEN HOC."
      });
    }

    const session = {
      deviceId,
      key: keyMeta.code,
      device,
      activatedAt,
      expiresAt,
      lastSeen: Date.now(),
      label: keyMeta.label,
      permanent: !!keyMeta.permanent
    };
    const isNewDeviceOnKey = !prevStamp;
    db.sessions[deviceId] = session;
    db.firstActivate[stampKey] = activatedAt;
    if (isNewDeviceOnKey) keyMeta.usedCount = (keyMeta.usedCount || 0) + 1;
    logHistory("activate", { key: keyMeta.code, deviceId, device });
    saveDB(db);
    return json(res, 200, {
      ok: true,
      session: sessionPayload(session),
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
      ok: true,
      valid: true,
      session: sessionPayload(session),
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

  if (method === "PUT" && p === "/api/admin/announce") {
    const body = await readBody(req);
    if (!db.announce) db.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
    if (typeof body.title === "string") db.announce.title = body.title.slice(0, 80) || "THÔNG BÁO";
    if (typeof body.text === "string") db.announce.text = body.text.slice(0, 4000);
    if (typeof body.enabled === "boolean") db.announce.enabled = body.enabled;
    db.announce.updatedAt = Date.now();
    logHistory("announce_update", { enabled: db.announce.enabled });
    saveDB(db);
    return json(res, 200, { ok: true, announce: db.announce });
  }

  if (method === "GET" && p === "/api/admin/announce") {
    if (!db.announce) db.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
    if (!db.maintenance) db.maintenance = { enabled: false, reason: "", updatedAt: null };
    return json(res, 200, { ok: true, announce: db.announce, maintenance: db.maintenance });
  }

  if (method === "PUT" && p === "/api/admin/maintenance") {
    const body = await readBody(req);
    if (!db.maintenance) db.maintenance = { enabled: false, reason: "", updatedAt: null };
    if (typeof body.enabled === "boolean") db.maintenance.enabled = body.enabled;
    if (typeof body.reason === "string") db.maintenance.reason = body.reason.slice(0, 2000);
    db.maintenance.updatedAt = Date.now();
    logHistory("maintenance_update", { enabled: db.maintenance.enabled });
    saveDB(db);
    return json(res, 200, { ok: true, maintenance: db.maintenance });
  }

  if (method === "GET" && p === "/api/admin/maintenance") {
    if (!db.maintenance) db.maintenance = { enabled: false, reason: "", updatedAt: null };
    return json(res, 200, { ok: true, maintenance: db.maintenance });
  }

  if (method === "GET" && p === "/api/admin/keys") {
    const q = String(url.searchParams.get("q") || "").trim().toUpperCase();
    let list = Object.values(db.keys).map((k) => {
      const all = sessionsForKey(k.code);
      const valid = all.filter(isSessionValid);
      return {
        ...k,
        usedCount: k.usedCount || 0,
        deviceCount: valid.length,
        totalDevicesEver: all.length,
        devices: valid.map((s) => ({
          deviceId: s.deviceId,
          device: s.device,
          activatedAt: s.activatedAt,
          lastSeen: s.lastSeen,
          startText: formatDate(s.activatedAt),
          lastSeenText: formatDate(s.lastSeen),
          remaining: remainingText(s)
        }))
      };
    });
    if (q) {
      list = list.filter(
        (k) =>
          k.code.includes(q) ||
          (k.note && String(k.note).toUpperCase().includes(q)) ||
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
        ...keyMeta,
        deviceCount: valid.length,
        totalDevicesEver: all.length,
        devices: valid.map((s) => ({
          deviceId: s.deviceId,
          device: s.device,
          startText: formatDate(s.activatedAt),
          lastSeenText: formatDate(s.lastSeen),
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
      ...sessionPayload(s),
      valid: isSessionValid(s),
      lastSeen: s.lastSeen,
      lastSeenText: formatDate(s.lastSeen)
    }));
    return json(res, 200, { ok: true, sessions: list });
  }

  if (method === "GET" && p === "/api/admin/stats") {
    const keys = Object.values(db.keys);
    const sessions = Object.values(db.sessions);
    return json(res, 200, {
      ok: true,
      stats: {
        totalKeys: keys.length,
        activeKeys: keys.filter((k) => k.active).length,
        totalSessions: sessions.length,
        validSessions: sessions.filter(isSessionValid).length,
        historyCount: db.history.length,
        persist: !!(JSONBIN_BIN_ID && JSONBIN_API_KEY),
        persistStatus: _persistStatus
      }
    });
  }

  if (method === "GET" && (p === "/" || p === "/app")) {
    for (const appPath of [
      path.join(__dirname, "public", "app.html"),
      path.join(__dirname, "app.html")
    ]) {
      if (fs.existsSync(appPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(appPath));
      }
    }
  }
  if (method === "GET" && p === "/admin") {
    for (const adminPath of [
      path.join(__dirname, "public", "admin.html"),
      path.join(__dirname, "admin.html")
    ]) {
      if (fs.existsSync(adminPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(fs.readFileSync(adminPath));
      }
    }
  }
  if (method === "GET") {
    const safe =
      p
        .replace(/\\/g, "/")
        .split("/")
        .filter((x) => x !== "..")
        .join("/") || "/";
    const name = safe === "/" ? "app.html" : safe.replace(/^\//, "");
    for (const c of [path.join(__dirname, "public", name), path.join(__dirname, name)]) {
      if (c.startsWith(__dirname) && fs.existsSync(c) && fs.statSync(c).isFile()) {
        const ext = path.extname(c).toLowerCase();
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json"
        };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        return res.end(fs.readFileSync(c));
      }
    }
  }

  json(res, 404, { ok: false, error: "Not found", path: p });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      json(res, 500, { ok: false, error: "Internal Server Error" });
    });
  })
  .listen(PORT, HOST, () => {
    console.log("AIMLOCK API v1.2 | port", PORT, "| jsonbin", !!(JSONBIN_BIN_ID && JSONBIN_API_KEY));
  });
