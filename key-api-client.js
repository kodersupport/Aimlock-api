/**
 * AIMLOCK MODE 10 — Key API Client v1.1
 * Chỉ nhập KEY (không cần tài khoản)
 */
(function () {
  "use strict";

  const API_BASE =
    (typeof window !== "undefined" && window.ALM10_API_BASE) ||
    (location.protocol === "file:" ? "http://localhost:3000" : location.origin);

  const STORAGE = "alm10_session_v4";
  const DEVICE_KEY = "alm10_device_id_v1";

  const gate = document.getElementById("keyGate");
  const success = document.getElementById("keySuccess");
  const userInput = document.getElementById("kgUser");
  const passInput = document.getElementById("kgPass");
  const submitBtn = document.getElementById("kgSubmit");
  const errEl = document.getElementById("kgError");
  const ksMsg = document.getElementById("ksMsg");
  const ksTime = document.getElementById("ksTime");
  const ksEnter = document.getElementById("ksEnter");

  // Ẩn ô tài khoản — chỉ hiện KEY
  (function hideUserField() {
    if (userInput) {
      const field = userInput.closest(".key-field");
      if (field) field.style.display = "none";
      userInput.value = "";
    }
    const passLabel = document.querySelector('label[for="kgPass"]');
    if (passLabel) passLabel.textContent = "KEY";
    if (passInput) {
      passInput.placeholder = "Nhập key...";
      passInput.autocomplete = "off";
    }
  })();

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return "d_tmp_" + Date.now();
    }
  }

  function deviceName() {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
    if (/Android/i.test(ua)) {
      const m = ua.match(/Android\s([\d.]+)/);
      return m ? "Android " + m[1] : "Android";
    }
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Mac/i.test(ua)) return "Mac";
    return "Web Browser";
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveLocal(s) {
    try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch {}
  }
  function clearLocal() {
    try {
      localStorage.removeItem(STORAGE);
      localStorage.removeItem("alm10_session_v3");
      localStorage.removeItem("alm10_session_v2");
    } catch {}
  }

  async function apiPost(path, body) {
    const r = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return r.json();
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function lockUI() {
    document.body.style.overflow = "hidden";
    if (gate) gate.hidden = false;
    const shell = document.querySelector(".app-shell");
    const nav = document.querySelector(".bottom-nav");
    if (shell) shell.style.visibility = "hidden";
    if (nav) nav.style.visibility = "hidden";
  }
  function unlockUI() {
    document.body.style.overflow = "";
    if (gate) gate.hidden = true;
    if (success) success.hidden = true;
    const shell = document.querySelector(".app-shell");
    const nav = document.querySelector(".bottom-nav");
    if (shell) shell.style.visibility = "";
    if (nav) nav.style.visibility = "";
  }

  function showSuccess(s) {
    if (!ksMsg || !ksTime) return;
    ksMsg.innerHTML =
      "Key: <b>" + escapeHtml(s.key) + "</b> (" + escapeHtml(s.label || "") + ")<br/>" +
      "Thiết bị: <b>" + escapeHtml(s.device || "") + "</b>";
    ksTime.innerHTML =
      "Bắt đầu: <b>" + escapeHtml(s.startText || "") + "</b><br/>" +
      "Hết hạn: <b>" + escapeHtml(s.expireText || "") + "</b><br/>" +
      escapeHtml(s.remaining || "");
    if (success) success.hidden = false;
  }

  function showError(msg) {
    if (errEl) {
      errEl.textContent = msg || "";
      errEl.classList.toggle("is-show", !!msg);
    }
  }

  async function activate() {
    showError("");
    const key = ((passInput && passInput.value) || "").trim();
    if (!key) { showError("Vui lòng nhập key."); return; }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "ĐANG KÍCH HOẠT..."; }

    try {
      const data = await apiPost("/api/activate", {
        key: key,
        deviceId: getDeviceId(),
        device: deviceName()
      });
      if (!data.ok || !data.session) {
        showError(data.error || "Kích hoạt thất bại");
        return;
      }
      saveLocal(data.session);
      showSuccess(data.session);
      startTick();
    } catch (e) {
      showError("Không kết nối được API. Thử lại sau.");
      console.error(e);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "KÍCH HOẠT"; }
    }
  }

  async function validateDevice() {
    try {
      return await apiPost("/api/validate", { deviceId: getDeviceId() });
    } catch {
      return { ok: false, valid: false };
    }
  }

  function enterApp() {
    unlockUI();
    updateHomeKeyInfo();
    fetchAnnounce();
  }

  function bindLogout() {
    const btn = document.getElementById("settings-logout-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      apiPost("/api/logout", { deviceId: getDeviceId() }).catch(function () {});
      clearLocal();
      if (tickTimer) clearInterval(tickTimer);
      lockUI();
      if (passInput) passInput.value = "";
      showError("");
      if (success) success.hidden = true;
    });
  }

  let tickTimer = null;
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(async function () {
      const data = await validateDevice();
      if (!data.valid || !data.session) {
        clearInterval(tickTimer);
        clearLocal();
        unlockUI();
        lockUI();
        showError("Key đã hết hạn. Vui lòng liên hệ ADMIN TIEN HOC.");
        if (success) success.hidden = true;
        return;
      }
      saveLocal(data.session);
      if (success && !success.hidden) showSuccess(data.session);
      updateHomeKeyInfo();
      fetchAnnounce();
    }, 15000);
  }

  function updateHomeKeyInfo() {
    const elUser = document.getElementById("kiUser");
    const elKey = document.getElementById("kiKey");
    const elType = document.getElementById("kiType");
    const elDevice = document.getElementById("kiDevice");
    const elStart = document.getElementById("kiStart");
    const elExpire = document.getElementById("kiExpire");
    const elLeft = document.getElementById("kiLeft");
    const elStatus = document.getElementById("kiStatus");
    if (!elKey && !elUser) return;

    const s = loadLocal();
    if (!s || !s.key) {
      if (elUser) elUser.textContent = "—";
      if (elKey) elKey.textContent = "—";
      if (elType) elType.textContent = "—";
      if (elDevice) elDevice.textContent = "—";
      if (elStart) elStart.textContent = "—";
      if (elExpire) elExpire.textContent = "—";
      if (elLeft) elLeft.textContent = "Hết hạn / Chưa kích hoạt";
      if (elStatus) { elStatus.textContent = "Hết hạn"; elStatus.classList.add("is-expired"); }
      return;
    }

    if (elUser) elUser.textContent = s.device || "—";
    if (elKey) elKey.textContent = s.key || "—";
    if (elType) elType.textContent = s.label || "—";
    if (elDevice) elDevice.textContent = s.device || "—";
    if (elStart) elStart.textContent = s.startText || "—";
    if (elExpire) elExpire.textContent = s.expireText || "—";
    if (elLeft) elLeft.textContent = s.remaining || "—";
    if (elStatus) { elStatus.textContent = "Đang hoạt động"; elStatus.classList.remove("is-expired"); }
  }


  // ===== THÔNG BÁO + BẢO TRÌ =====
  function ensureAnnounceStyles() {
    if (document.getElementById("almNoticeStyles")) return;
    var st = document.createElement("style");
    st.id = "almNoticeStyles";
    st.textContent = [
      "#almAnnounceBoard{display:none;position:relative;z-index:100001;margin:12px 12px 0;padding:0;border-radius:18px;overflow:hidden;",
      "border:1px solid rgba(255,120,140,0.4);background:linear-gradient(165deg,rgba(40,8,14,0.98),rgba(18,4,8,0.96));",
      "box-shadow:0 12px 40px rgba(0,0,0,0.45),0 0 24px rgba(255,59,82,0.12);}",
      "#almAnnounceBoard .ab-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(90deg,rgba(255,59,82,0.28),rgba(255,59,82,0.06));",
      "border-bottom:1px solid rgba(255,108,124,0.22);}",
      "#almAnnounceBoard .ab-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;",
      "background:rgba(255,59,82,0.25);border:1px solid rgba(255,138,151,0.35);font-size:15px;}",
      "#almAnnounceBoard .ab-title{margin:0;font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#ff9aa5;}",
      "#almAnnounceBoard .ab-time{margin:2px 0 0;font-size:10px;color:rgba(255,244,245,0.45);}",
      "#almAnnounceBoard .ab-body{padding:14px;font-size:13px;line-height:1.6;color:#fff4f5;white-space:pre-wrap;word-break:break-word;font-weight:500;}",
      "#almAnnounceBoard .ab-foot{padding:8px 14px 12px;font-size:10px;color:rgba(255,244,245,0.35);letter-spacing:0.06em;}",
      "#almAnnounceBoardApp{display:none;margin:0 0 14px;}",
      "#almMaintOverlay{display:none;position:fixed;inset:0;z-index:200000;background:rgba(3,1,2,0.92);backdrop-filter:blur(12px);",
      "-webkit-backdrop-filter:blur(12px);align-items:center;justify-content:center;padding:20px;}",
      "#almMaintOverlay.show{display:flex;}",
      "#almMaintOverlay .mb{max-width:360px;width:100%;padding:28px 22px;border-radius:24px;text-align:center;",
      "border:1px solid rgba(255,180,80,0.35);background:linear-gradient(165deg,rgba(40,24,8,0.98),rgba(12,6,2,0.98));",
      "box-shadow:0 24px 60px rgba(0,0,0,0.55),0 0 30px rgba(255,180,80,0.1);}",
      "#almMaintOverlay .mb-icon{font-size:36px;margin-bottom:10px;}",
      "#almMaintOverlay .mb-title{margin:0 0 8px;font-size:16px;font-weight:900;letter-spacing:0.12em;color:#ffd78f;text-transform:uppercase;}",
      "#almMaintOverlay .mb-reason{margin:0;font-size:13px;line-height:1.65;color:#fff4f5;white-space:pre-wrap;word-break:break-word;}",
      "#almMaintOverlay .mb-foot{margin:16px 0 0;font-size:11px;color:rgba(255,244,245,0.4);}"
    ].join("");
    document.head.appendChild(st);
  }

  function ensureAnnounceBoard(target) {
    ensureAnnounceStyles();
    var id = target === "app" ? "almAnnounceBoardApp" : "almAnnounceBoard";
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement("div");
    el.id = id;
    el.innerHTML = '<div class="ab-head"><div class="ab-icon">📢</div><div><p class="ab-title"></p><p class="ab-time"></p></div></div><div class="ab-body"></div><div class="ab-foot">AIMLOCK MODE 10 · Admin TIEN HOC</div>';
    if (target === "app") {
      var shell = document.querySelector(".app-shell");
      var header = shell && shell.querySelector(".app-header");
      if (header && header.parentNode) header.parentNode.insertBefore(el, header.nextSibling);
      else if (shell) shell.insertBefore(el, shell.firstChild);
      else document.body.appendChild(el);
    } else {
      var gate = document.getElementById("keyGate");
      var box = gate && gate.querySelector(".key-box");
      if (box) box.insertBefore(el, box.firstChild);
      else document.body.appendChild(el);
    }
    return el;
  }

  function ensureMaintOverlay() {
    ensureAnnounceStyles();
    var el = document.getElementById("almMaintOverlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "almMaintOverlay";
    el.innerHTML = '<div class="mb"><div class="mb-icon">🔧</div><p class="mb-title">Đang bảo trì</p><p class="mb-reason"></p><p class="mb-foot">Vui lòng quay lại sau · Admin TIEN HOC</p></div>';
    document.body.appendChild(el);
    return el;
  }

  function formatAnnTime(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      var p = function(n){ return String(n).padStart(2,"0"); };
      return p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes());
    } catch(e) { return ""; }
  }

  function renderAnnounceBoard(el, ann) {
    if (!el) return;
    if (!ann || !ann.enabled || !ann.text) {
      el.style.display = "none";
      return;
    }
    var title = el.querySelector(".ab-title");
    var time = el.querySelector(".ab-time");
    var body = el.querySelector(".ab-body");
    if (title) title.textContent = ann.title || "THÔNG BÁO";
    if (time) time.textContent = ann.updatedAt ? ("Cập nhật: " + formatAnnTime(ann.updatedAt)) : "";
    if (body) body.textContent = ann.text || "";
    el.style.display = "block";
  }

  function applyMaintenance(mnt) {
    var ov = ensureMaintOverlay();
    var shell = document.querySelector(".app-shell");
    var nav = document.querySelector(".bottom-nav");
    if (mnt && mnt.enabled) {
      var reason = ov.querySelector(".mb-reason");
      if (reason) reason.textContent = mnt.reason || "Hệ thống đang bảo trì. Vui lòng quay lại sau.";
      ov.classList.add("show");
      if (gate) { gate.style.visibility = "hidden"; gate.hidden = true; }
      if (shell) shell.style.visibility = "hidden";
      if (nav) nav.style.visibility = "hidden";
      if (success) success.hidden = true;
    } else {
      ov.classList.remove("show");
      // Khôi phục UI theo session
      var s = null;
      try { s = loadLocal(); } catch (e) {}
      if (s && s.key) {
        if (gate) { gate.hidden = true; gate.style.visibility = ""; }
        if (shell) shell.style.visibility = "";
        if (nav) nav.style.visibility = "";
      } else {
        if (gate) { gate.hidden = false; gate.style.visibility = ""; }
        if (shell) shell.style.visibility = "hidden";
        if (nav) nav.style.visibility = "hidden";
      }
    }
  }

  async function fetchAnnounce() {
    try {
      var r = await fetch(API_BASE + "/api/announce");
      var data = await r.json();
      if (!data || !data.ok) return;

      applyMaintenance(data.maintenance);

      // Nếu đang bảo trì thì không cần hiện bảng thông báo bên dưới
      if (data.maintenance && data.maintenance.enabled) return;

      var gateBoard = ensureAnnounceBoard("gate");
      var appBoard = ensureAnnounceBoard("app");
      renderAnnounceBoard(gateBoard, data.announce);
      renderAnnounceBoard(appBoard, data.announce);
    } catch (e) {}
  }

  (async function init() {
    fetchAnnounce();
    setInterval(fetchAnnounce, 20000);
    window.ALM10Key = {
      updateHome: updateHomeKeyInfo,
      clear: function () { clearLocal(); lockUI(); },
      session: loadLocal,
      apiBase: API_BASE
    };

    const local = loadLocal();
    if (local && local.key) {
      const data = await validateDevice();
      if (data.valid && data.session) {
        saveLocal(data.session);
        unlockUI();
        updateHomeKeyInfo();
        startTick();
        fetchAnnounce();
      } else {
        clearLocal();
        lockUI();
      }
    } else {
      lockUI();
    }

    if (submitBtn) {
      const neo = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(neo, submitBtn);
      neo.addEventListener("click", activate);
    }
    if (passInput) {
      passInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") activate();
      });
    }
    if (ksEnter) {
      ksEnter.addEventListener("click", function () {
        const s = loadLocal();
        if (s && s.key) { enterApp(); startTick(); }
        else {
          if (success) success.hidden = true;
          lockUI();
          showError("Key đã hết hạn.");
        }
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindLogout);
    } else {
      setTimeout(bindLogout, 200);
    }
  })();
})();
