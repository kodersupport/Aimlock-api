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
// Upstash Redis REST (khuyến nghị — ổn định hơn JSONBin)
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const DB_REDIS_KEY = (process.env.DB_REDIS_KEY || "aimlock_db_v1").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();

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
    announce: { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null }, maintenance: { enabled: false, reason: "", updatedAt: null }, settings: { contactText: "Liên hệ admin TIEN HOC", contactUrl: "", supportNote: "" }
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
  if (!o.settings || typeof o.settings !== "object") {
    o.settings = { contactText: "Liên hệ admin TIEN HOC", contactUrl: "", supportNote: "" };
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

async function readUpstash() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return { ok: false, reason: "no_upstash", data: null };
  try {
    const r = await fetch(UPSTASH_URL + "/get/" + encodeURIComponent(DB_REDIS_KEY), {
      headers: { Authorization: "Bearer " + UPSTASH_TOKEN }
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      console.log("Upstash READ fail:", r.status, JSON.stringify(j).slice(0, 200));
      return { ok: false, reason: "upstash_http_" + r.status, data: null };
    }
    // Upstash returns { result: "<json string>" | null }
    let rec = j && j.result;
    if (rec == null || rec === "") return { ok: true, reason: "empty", data: normalizeDB({ keys: {}, sessions: {}, history: [], firstActivate: {}, announce: {}, maintenance: {} }) };
    if (typeof rec === "string") {
      try { rec = JSON.parse(rec); } catch (e) {
        return { ok: false, reason: "upstash_parse", data: null };
      }
    }
    if (!rec || typeof rec !== "object") return { ok: false, reason: "upstash_shape", data: null };
    return { ok: true, reason: "ok", data: normalizeDB(rec) };
  } catch (e) {
    console.log("Upstash READ error:", e.message);
    return { ok: false, reason: "upstash_exception", data: null };
  }
}

async function writeUpstash(data) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  try {
    const r = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + UPSTASH_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["SET", DB_REDIS_KEY, JSON.stringify(data)])
    });
    if (!r.ok) {
      const t = await r.text();
      console.log("Upstash WRITE fail:", r.status, t.slice(0, 200));
      return false;
    }
    console.log("Upstash WRITE ok — keys:", Object.keys(data.keys || {}).length);
    return true;
  } catch (e) {
    console.log("Upstash WRITE error:", e.message);
    return false;
  }
}

async function readJsonbin() {
  if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
    return { ok: false, reason: "not_configured", data: null };
  }
  try {
    const r = await fetch("https://api.jsonbin.io/v3/b/" + JSONBIN_BIN_ID + "/latest", {
      headers: { "X-Master-Key": JSONBIN_API_KEY, "X-Bin-Meta": "false" }
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (!r.ok) {
      console.log("JSONBin READ fail:", r.status, text.slice(0, 200));
      return { ok: false, reason: "http_" + r.status, data: null };
    }
    const rec = j && (j.record !== undefined ? j.record : j);
    if (!rec || typeof rec !== "object") return { ok: false, reason: "bad_shape", data: null };
    return { ok: true, reason: "ok", data: normalizeDB(rec) };
  } catch (e) {
    console.log("JSONBin READ error:", e.message);
    return { ok: false, reason: "exception", data: null };
  }
}

async function writeJsonbin(data) {
  if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) return false;
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
      console.log("JSONBin WRITE fail:", r.status);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function readRemote() {
  // Ưu tiên Upstash
  const u = await readUpstash();
  if (u.ok && u.reason !== "empty") return { ok: true, reason: "upstash:" + u.reason, data: u.data };
  if (u.ok && u.reason === "empty") {
    // thử jsonbin để migrate
    const j = await readJsonbin();
    if (j.ok && j.data && Object.keys(j.data.keys || {}).length > 0) {
      return { ok: true, reason: "jsonbin_migrate", data: j.data };
    }
    return { ok: true, reason: "empty", data: u.data };
  }
  const j = await readJsonbin();
  if (j.ok) return { ok: true, reason: "jsonbin:" + j.reason, data: j.data };
  return { ok: false, reason: u.reason + "|" + j.reason, data: null };
}

let _saveRemoteTimer = null;
let _persistReady = false;
let _persistStatus = "starting";

function writeRemote(data) {
  if (!UPSTASH_URL && !JSONBIN_BIN_ID) return;
  if (_saveRemoteTimer) clearTimeout(_saveRemoteTimer);
  _saveRemoteTimer = setTimeout(async () => {
    const okU = await writeUpstash(data);
    if (!okU) await writeJsonbin(data);
  }, 400);
}

function saveDB(data) {
  writeLocal(data);
  writeRemote(data);
}

let db = normalizeDB(readLocal() || defaultDB());

async function bootstrapRemote() {
  const hasRemote = !!(UPSTASH_URL && UPSTASH_TOKEN) || !!(JSONBIN_BIN_ID && JSONBIN_API_KEY);
  const remote = await readRemote();
  if (remote.ok && remote.data) {
    const n = Object.keys(remote.data.keys || {}).length;
    if (n > 0) {
      db = remote.data;
      writeLocal(db);
      // nếu lấy từ jsonbin mà có upstash → migrate sang upstash
      if (String(remote.reason).indexOf("jsonbin") === 0 && UPSTASH_URL) {
        await writeUpstash(db);
      }
      _persistStatus = "loaded (" + n + " keys) via " + remote.reason;
      console.log("DB loaded:", _persistStatus);
    } else {
      saveDB(db);
      _persistStatus = "seeded_empty_remote";
      console.log("Remote empty → seeded defaults");
    }
  } else if (!hasRemote) {
    _persistStatus = "no_remote_env";
    console.log("WARN: Chưa cấu hình UPSTASH hoặc JSONBIN — data MẤT khi restart!");
  } else {
    _persistStatus = "read_failed:" + remote.reason + " (kept local, NOT overwrite)";
    console.log("Remote read failed → keep local. reason=", remote.reason);
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

function telegramEnabled() {
  const token = TELEGRAM_BOT_TOKEN || (db.settings && db.settings.telegramBotToken) || "";
  const chat = TELEGRAM_CHAT_ID || (db.settings && db.settings.telegramChatId) || "";
  return !!(token && chat);
}

function getTgToken() {
  return TELEGRAM_BOT_TOKEN || (db.settings && db.settings.telegramBotToken) || "";
}
function getTgChatId() {
  return String(TELEGRAM_CHAT_ID || (db.settings && db.settings.telegramChatId) || "");
}

async function sendTelegram(text, chatId) {
  try {
    const token = getTgToken();
    const chat = chatId != null ? String(chatId) : getTgChatId();
    if (!token || !chat) return false;
    const url = "https://api.telegram.org/bot" + token + "/sendMessage";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: String(text).slice(0, 3500),
        disable_web_page_preview: true
      })
    });
    if (!r.ok) {
      const t = await r.text();
      console.log("Telegram fail:", r.status, t.slice(0, 150));
      return false;
    }
    return true;
  } catch (e) {
    console.log("Telegram error:", e.message);
    return false;
  }
}

function isAllowedTgChat(chatId) {
  const allowed = getTgChatId();
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

function tgHelpText() {
  return [
    "🤖 AIMLOCK ADMIN BOT",
    "",
    "/help — menu lệnh",
    "/stats — thống kê",
    "/keys — danh sách key (20 mới)",
    "/key MÃ — chi tiết 1 key",
    "/new [ngày|perm] [note] — tạo key",
    "   vd: /new 30 khachA",
    "   vd: /new perm VIP",
    "   vd: /new week",
    "/bulk số [ngày|perm] — tạo hàng loạt (max 20)",
    "   vd: /bulk 5 30",
    "/extend MÃ số_ngày — gia hạn",
    "   vd: /extend ALM-XXXX 30",
    "/extend MÃ perm — thành vĩnh viễn",
    "/off MÃ — tắt key",
    "/on MÃ — bật key",
    "/del MÃ — xóa key",
    "/kick MÃ — kick all TB của key",
    "/maint on|off [lý do] — bảo trì",
    "/say tiêu đề | nội dung — bật thông báo",
    "/sayoff — tắt thông báo",
    "",
    "Chỉ Chat ID admin mới dùng được."
  ].join("\n");
}

function parseDurationToken(tok) {
  tok = String(tok || "").toLowerCase();
  if (tok === "perm" || tok === "vinhvien" || tok === "vv") {
    return { permanent: true, days: null, label: "Vĩnh viễn", preset: "perm" };
  }
  if (tok === "day" || tok === "1d") return { permanent: false, days: 1, label: "1 ngày", preset: "day" };
  if (tok === "week" || tok === "1w") return { permanent: false, days: 7, label: "1 tuần", preset: "week" };
  if (tok === "month" || tok === "1m") return { permanent: false, days: 30, label: "1 tháng", preset: "month" };
  if (tok === "year" || tok === "1y") return { permanent: false, days: 365, label: "1 năm", preset: "year" };
  const n = Number(tok);
  if (n > 0) return { permanent: false, days: n, label: n + " ngày", preset: null };
  return { permanent: false, days: 30, label: "1 tháng", preset: "month" };
}

async function handleTelegramCommand(chatId, text) {
  const raw = String(text || "").trim();
  if (!raw) return;
  if (!isAllowedTgChat(chatId)) {
    await sendTelegram("⛔ Không có quyền. Chat ID không khớp admin.", chatId);
    return;
  }

  const parts = raw.split(/\s+/);
  const cmd = parts[0].toLowerCase().split("@")[0];
  const args = parts.slice(1);

  try {
    if (cmd === "/start" || cmd === "/help") {
      await sendTelegram(tgHelpText(), chatId);
      return;
    }

    if (cmd === "/stats") {
      const keys = Object.values(db.keys);
      const sessions = Object.values(db.sessions).filter(isSessionValid);
      await sendTelegram(
        "📊 STATS\nKey: " + keys.length + " (active " + keys.filter(k=>k.active).length + ")\n" +
        "Online TB: " + sessions.length + "\n" +
        "Vĩnh viễn: " + keys.filter(k=>k.permanent).length + "\n" +
        "Bảo trì: " + (db.maintenance && db.maintenance.enabled ? "ON" : "OFF") + "\n" +
        "Persist: " + _persistStatus,
        chatId
      );
      return;
    }

    if (cmd === "/keys") {
      const list = Object.values(db.keys).slice(-20).reverse();
      if (!list.length) { await sendTelegram("Chưa có key.", chatId); return; }
      const lines = list.map(k =>
        (k.active ? "✅" : "⛔") + " " + k.code + " · " + k.label +
        (k.note ? " · " + k.note : "") +
        " · TB " + validDevicesForKey(k.code).length
      );
      await sendTelegram("🔑 KEYS (20 gần)\n" + lines.join("\n"), chatId);
      return;
    }

    if (cmd === "/key") {
      const code = normalizeKey(args[0] || "");
      const k = db.keys[code];
      if (!k) { await sendTelegram("Không tìm thấy key.", chatId); return; }
      const devs = validDevicesForKey(code);
      await sendTelegram(
        "🔑 " + k.code + "\nLoại: " + k.label + "\nActive: " + (k.active?"ON":"OFF") +
        "\nMax TB: " + (k.maxUses||"∞") + "\nĐang dùng: " + devs.length +
        "\nNote: " + (k.note||"—") +
        (devs.length ? "\nTB:\n- " + devs.map(d=>d.device).join("\n- ") : ""),
        chatId
      );
      return;
    }

    if (cmd === "/new") {
      const dur = parseDurationToken(args[0] || "30");
      const note = args.slice(dur.preset || String(Number(args[0])) === String(args[0]) || ["perm","day","week","month","year"].includes(String(args[0]||"").toLowerCase()) ? 1 : 0).join(" ") || "";
      // note: if first arg is duration, note from args[1..]
      let note2 = "";
      if (args.length) {
        const first = String(args[0]).toLowerCase();
        if (first === "perm" || first === "day" || first === "week" || first === "month" || first === "year" || Number(first) > 0) {
          note2 = args.slice(1).join(" ");
        } else {
          note2 = args.join(" ");
        }
      }
      const code = normalizeKey(genKey("ALM"));
      const entry = {
        code,
        label: dur.label,
        days: dur.permanent ? null : dur.days,
        permanent: !!dur.permanent,
        createdAt: Date.now(),
        maxUses: 0,
        usedCount: 0,
        active: true,
        note: note2
      };
      db.keys[code] = entry;
      logHistory("key_create_tg", { code });
      saveDB(db);
      await sendTelegram("🔑 ĐÃ TẠO\n" + code + "\n" + entry.label + (note2 ? "\nNote: " + note2 : ""), chatId);
      return;
    }

    if (cmd === "/bulk") {
      const count = Math.min(Math.max(Number(args[0]) || 5, 1), 20);
      const dur = parseDurationToken(args[1] || "30");
      const created = [];
      for (let i = 0; i < count; i++) {
        let code = normalizeKey(genKey("ALM"));
        let tries = 0;
        while (db.keys[code] && tries < 15) { code = normalizeKey(genKey("ALM")); tries++; }
        if (db.keys[code]) continue;
        const entry = {
          code, label: dur.label, days: dur.permanent ? null : dur.days, permanent: !!dur.permanent,
          createdAt: Date.now(), maxUses: 1, usedCount: 0, active: true, note: "tg-bulk"
        };
        db.keys[code] = entry;
        created.push(code);
      }
      logHistory("key_bulk_tg", { count: created.length });
      saveDB(db);
      await sendTelegram("🔑 BULK " + created.length + " key (" + dur.label + ")\n" + created.join("\n"), chatId);
      return;
    }

    if (cmd === "/extend") {
      const code = normalizeKey(args[0] || "");
      const k = db.keys[code];
      if (!k) { await sendTelegram("Không tìm thấy key.", chatId); return; }
      const second = String(args[1] || "").toLowerCase();
      if (second === "perm") {
        k.permanent = true; k.days = null; k.label = "Vĩnh viễn";
      } else {
        const addDays = Number(args[1]) || 0;
        if (addDays <= 0) { await sendTelegram("Dùng: /extend MÃ 30  hoặc /extend MÃ perm", chatId); return; }
        if (!k.permanent) {
          k.days = (Number(k.days) || 0) + addDays;
          k.label = k.days + " ngày";
          const addMs = addDays * 86400000;
          for (const sess of Object.values(db.sessions)) {
            if (normalizeKey(sess.key) === code && sess.expiresAt != null) {
              sess.expiresAt = Number(sess.expiresAt) + addMs;
              sess.label = k.label;
            }
          }
        }
      }
      logHistory("key_extend_tg", { code });
      saveDB(db);
      await sendTelegram("⏰ Đã gia hạn " + code + " → " + k.label, chatId);
      return;
    }

    if (cmd === "/off" || cmd === "/on") {
      const code = normalizeKey(args[0] || "");
      const k = db.keys[code];
      if (!k) { await sendTelegram("Không tìm thấy key.", chatId); return; }
      k.active = cmd === "/on";
      logHistory("key_toggle_tg", { code, active: k.active });
      saveDB(db);
      await sendTelegram((k.active ? "✅ Bật " : "⛔ Tắt ") + code, chatId);
      return;
    }

    if (cmd === "/del") {
      const code = normalizeKey(args[0] || "");
      if (!db.keys[code]) { await sendTelegram("Không tìm thấy key.", chatId); return; }
      for (const id of Object.keys(db.sessions)) {
        if (normalizeKey(db.sessions[id].key) === code) delete db.sessions[id];
      }
      delete db.keys[code];
      logHistory("key_delete_tg", { code });
      saveDB(db);
      await sendTelegram("🗑️ Đã xóa " + code, chatId);
      return;
    }

    if (cmd === "/kick") {
      const code = normalizeKey(args[0] || "");
      if (!db.keys[code]) { await sendTelegram("Không tìm thấy key.", chatId); return; }
      let n = 0;
      for (const id of Object.keys(db.sessions)) {
        if (normalizeKey(db.sessions[id].key) === code) { delete db.sessions[id]; n++; }
      }
      logHistory("key_kick_tg", { code, n });
      saveDB(db);
      await sendTelegram("👢 Kick " + n + " TB của " + code, chatId);
      return;
    }

    if (cmd === "/maint") {
      if (!db.maintenance) db.maintenance = { enabled: false, reason: "", updatedAt: null };
      const on = String(args[0] || "").toLowerCase();
      if (on === "on") {
        db.maintenance.enabled = true;
        db.maintenance.reason = args.slice(1).join(" ") || db.maintenance.reason || "Đang bảo trì";
      } else if (on === "off") {
        db.maintenance.enabled = false;
      } else {
        await sendTelegram("Dùng: /maint on lý do  |  /maint off", chatId);
        return;
      }
      db.maintenance.updatedAt = Date.now();
      logHistory("maint_tg", { enabled: db.maintenance.enabled });
      saveDB(db);
      await sendTelegram((db.maintenance.enabled ? "🔧 Bảo trì ON\n" : "✅ Bảo trì OFF\n") + (db.maintenance.reason || ""), chatId);
      return;
    }

    if (cmd === "/say") {
      if (!db.announce) db.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
      const body = args.join(" ");
      const bits = body.split("|");
      if (bits.length >= 2) {
        db.announce.title = bits[0].trim().slice(0, 80) || "THÔNG BÁO";
        db.announce.text = bits.slice(1).join("|").trim();
      } else {
        db.announce.title = "THÔNG BÁO";
        db.announce.text = body;
      }
      db.announce.enabled = true;
      db.announce.updatedAt = Date.now();
      logHistory("announce_tg", {});
      saveDB(db);
      await sendTelegram("📢 Đã bật thông báo\n" + db.announce.title + "\n" + db.announce.text, chatId);
      return;
    }

    if (cmd === "/sayoff") {
      if (!db.announce) db.announce = { title: "THÔNG BÁO", text: "", enabled: false, updatedAt: null };
      db.announce.enabled = false;
      db.announce.updatedAt = Date.now();
      saveDB(db);
      await sendTelegram("📢 Đã tắt thông báo", chatId);
      return;
    }

    await sendTelegram("Không hiểu lệnh. Gõ /help", chatId);
  } catch (e) {
    console.log("TG cmd error:", e);
    await sendTelegram("Lỗi xử lý: " + (e.message || e), chatId);
  }
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
      persist: !!(UPSTASH_URL && UPSTASH_TOKEN) || !!(JSONBIN_BIN_ID && JSONBIN_API_KEY),
      persistStatus: _persistStatus,
      keyCount: Object.keys(db.keys || {}).length,
      telegram: telegramEnabled()
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
      },
      settings: db.settings || { contactText: "Liên hệ admin TIEN HOC", contactUrl: "", supportNote: "" }
    });
  }

  // Telegram webhook — điều khiển admin qua bot
  if (method === "POST" && p === "/api/telegram/webhook") {
    const body = await readBody(req);
    try {
      const msg = body.message || body.edited_message;
      if (msg && msg.chat && msg.text) {
        const chatId = msg.chat.id;
        const text = msg.text;
        // async process but respond 200 quickly
        handleTelegramCommand(chatId, text).catch((e) => console.log(e));
      }
    } catch (e) {
      console.log("webhook parse", e.message);
    }
    return json(res, 200, { ok: true });
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
    sendTelegram("✅ KÍCH HOẠT\nKey: " + keyMeta.code + "\nThiết bị: " + device + "\nTB đang dùng: " + validDevicesForKey(keyCode).length + (keyMeta.maxUses ? "/" + keyMeta.maxUses : ""));
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
    if (db.announce.enabled && db.announce.text) {
      sendTelegram("📢 THÔNG BÁO " + (db.announce.enabled ? "BẬT" : "TẮT") + "\n" + (db.announce.title || "") + "\n" + db.announce.text);
    }
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
    sendTelegram((db.maintenance.enabled ? "🔧 BẬT BẢO TRÌ\n" : "✅ TẮT BẢO TRÌ\n") + (db.maintenance.reason || ""));
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


  // BULK create keys
  if (method === "POST" && p === "/api/admin/keys/bulk") {
    const body = await readBody(req);
    let meta = {};
    if (body.preset && PRESETS[body.preset]) meta = Object.assign({}, PRESETS[body.preset]);
    else {
      meta.label = body.label || "Custom";
      meta.days = body.permanent ? null : Number(body.days) || 1;
      meta.permanent = !!body.permanent;
    }
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);
    const maxUses = Number(body.maxUses) || 0;
    const note = body.note || "";
    const prefix = String(body.prefix || "ALM").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "ALM";
    const created = [];
    for (let i = 0; i < count; i++) {
      let code = normalizeKey(genKey(prefix));
      let tries = 0;
      while (db.keys[code] && tries < 20) {
        code = normalizeKey(genKey(prefix));
        tries++;
      }
      if (db.keys[code]) continue;
      const entry = {
        code,
        label: meta.label,
        days: meta.permanent ? null : meta.days,
        permanent: !!meta.permanent,
        createdAt: Date.now(),
        maxUses,
        usedCount: 0,
        active: true,
        note
      };
      db.keys[code] = entry;
      created.push(entry);
    }
    logHistory("key_bulk_create", { count: created.length, preset: body.preset || meta.label });
    saveDB(db);
    sendTelegram("🔑 TẠO HÀNG LOẠT\nSố lượng: " + created.length + "\nLoại: " + (meta.label || "") + "\nPrefix: " + prefix);
    return json(res, 201, { ok: true, keys: created, count: created.length });
  }

  // EXTEND key by days
  if (method === "POST" && /^\/api\/admin\/keys\/[^/]+\/extend$/.test(p)) {
    const code = normalizeKey(p.replace("/api/admin/keys/", "").replace("/extend", ""));
    const keyMeta = db.keys[code];
    if (!keyMeta) return json(res, 404, { ok: false, error: "Không tìm thấy key" });
    const body = await readBody(req);
    const addDays = Number(body.days) || 0;
    if (body.permanent === true) {
      keyMeta.permanent = true;
      keyMeta.days = null;
      keyMeta.label = "Vĩnh viễn";
    } else if (addDays > 0) {
      if (keyMeta.permanent) {
        // đang vĩnh viễn → giữ nguyên
      } else {
        keyMeta.days = (Number(keyMeta.days) || 0) + addDays;
        keyMeta.label = keyMeta.days + " ngày";
        keyMeta.permanent = false;
      }
      // Gia hạn session đang chạy: cộng thêm ms vào expiresAt
      const addMs = addDays * 24 * 60 * 60 * 1000;
      for (const s of Object.values(db.sessions)) {
        if (normalizeKey(s.key) === code && s.expiresAt != null) {
          s.expiresAt = Number(s.expiresAt) + addMs;
          s.label = keyMeta.label;
        }
      }
      // firstActivate giữ nguyên mốc — chỉ kéo expires
    }
    logHistory("key_extend", { code, addDays, permanent: !!body.permanent });
    saveDB(db);
    sendTelegram("⏰ GIA HẠN\nKey: " + code + "\n" + (body.permanent ? "→ Vĩnh viễn" : ("+" + addDays + " ngày")) + "\nHiện: " + keyMeta.label);
    return json(res, 200, { ok: true, key: keyMeta });
  }

  // Kick ALL devices of a key
  if (method === "DELETE" && /^\/api\/admin\/keys\/[^/]+\/devices$/.test(p)) {
    const code = normalizeKey(p.replace("/api/admin/keys/", "").replace("/devices", ""));
    if (!db.keys[code]) return json(res, 404, { ok: false, error: "Không tìm thấy key" });
    let n = 0;
    for (const id of Object.keys(db.sessions)) {
      if (normalizeKey(db.sessions[id].key) === code) {
        delete db.sessions[id];
        n++;
      }
    }
    logHistory("key_kick_all", { code, count: n });
    saveDB(db);
    return json(res, 200, { ok: true, kicked: n });
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
    sendTelegram("🔑 KEY MỚI\nMã: " + code + "\nLoại: " + entry.label + "\nMax TB: " + (entry.maxUses || "∞") + "\nNote: " + (entry.note || "—"));
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
    sendTelegram("🗑️ XÓA KEY\nMã: " + code);
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

  if (method === "GET" && p === "/api/admin/history") {
    const list = (db.history || []).slice(0, 100).map((h) => ({
      ...h,
      atText: formatDate(h.at)
    }));
    return json(res, 200, { ok: true, history: list });
  }

  if (method === "GET" && p === "/api/admin/settings") {
    if (!db.settings) db.settings = { contactText: "Liên hệ admin TIEN HOC", contactUrl: "", supportNote: "" };
    return json(res, 200, { ok: true, settings: db.settings });
  }

  if (method === "PUT" && p === "/api/admin/settings") {
    const body = await readBody(req);
    if (!db.settings) db.settings = { contactText: "Liên hệ admin TIEN HOC", contactUrl: "", supportNote: "", telegramChatId: "", telegramBotToken: "" };
    if (typeof body.contactText === "string") db.settings.contactText = body.contactText.slice(0, 120);
    if (typeof body.contactUrl === "string") db.settings.contactUrl = body.contactUrl.slice(0, 300);
    if (typeof body.supportNote === "string") db.settings.supportNote = body.supportNote.slice(0, 500);
    if (typeof body.telegramChatId === "string") db.settings.telegramChatId = body.telegramChatId.slice(0, 64);
    if (typeof body.telegramBotToken === "string") db.settings.telegramBotToken = body.telegramBotToken.slice(0, 128);
    logHistory("settings_update", {});
    saveDB(db);
    return json(res, 200, { ok: true, settings: db.settings });
  }

  // Test telegram
  if (method === "POST" && p === "/api/admin/telegram/test") {
    const ok = await sendTelegram("🤖 AIMLOCK TEST\nBot đã kết nối thành công.\nTime: " + new Date().toISOString());
    return json(res, ok ? 200 : 500, { ok: ok, error: ok ? undefined : "Gửi thất bại — kiểm tra token/chat id" });
  }

  if (method === "POST" && p === "/api/admin/telegram/setup-webhook") {
    const token = getTgToken();
    if (!token) return json(res, 400, { ok: false, error: "Chưa có TELEGRAM_BOT_TOKEN" });
    const body = await readBody(req);
    const host = (body.url || ("https://" + (req.headers.host || ""))).replace(/\/$/, "");
    const hook = host + "/api/telegram/webhook";
    const r = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: hook, drop_pending_updates: true })
    });
    const j = await r.json().catch(() => ({}));
    return json(res, j.ok ? 200 : 500, { ok: !!j.ok, webhook: hook, telegram: j });
  }

  if (method === "GET" && p === "/api/admin/telegram/webhook-info") {
    const token = getTgToken();
    if (!token) return json(res, 400, { ok: false, error: "Chưa có token" });
    const r = await fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo");
    const j = await r.json().catch(() => ({}));
    return json(res, 200, { ok: true, info: j.result || j });
  }

  if (method === "GET" && p === "/api/admin/stats") {
    const keys = Object.values(db.keys);
    const sessions = Object.values(db.sessions);
    const valid = sessions.filter(isSessionValid);
    let expiringSoon = 0;
    const soonMs = 3 * 24 * 60 * 60 * 1000;
    for (const s of valid) {
      if (s.expiresAt != null && s.expiresAt - Date.now() > 0 && s.expiresAt - Date.now() <= soonMs) expiringSoon++;
    }
    const permanentKeys = keys.filter((k) => k.permanent).length;
    const timedKeys = keys.filter((k) => !k.permanent).length;
    return json(res, 200, {
      ok: true,
      stats: {
        totalKeys: keys.length,
        activeKeys: keys.filter((k) => k.active).length,
        permanentKeys,
        timedKeys,
        totalSessions: sessions.length,
        validSessions: valid.length,
        expiringSoon,
        historyCount: db.history.length,
        persist: !!(UPSTASH_URL && UPSTASH_TOKEN) || !!(JSONBIN_BIN_ID && JSONBIN_API_KEY),
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
    console.log("AIMLOCK API v1.2 | port", PORT, "| upstash", !!(UPSTASH_URL && UPSTASH_TOKEN), "| jsonbin", !!(JSONBIN_BIN_ID && JSONBIN_API_KEY));
  });
