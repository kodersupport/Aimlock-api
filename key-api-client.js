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


  // ===== THÔNG BÁO ADMIN =====
  function ensureAnnounceBanner() {
    var el = document.getElementById("almAnnounceBanner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "almAnnounceBanner";
    el.style.cssText = "display:none;position:relative;z-index:15;margin:0 0 12px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,108,124,0.35);background:linear-gradient(180deg,rgba(255,59,82,0.22),rgba(255,59,82,0.08));color:#fff4f5;font-size:12.5px;line-height:1.5;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.25)";
    var shell = document.querySelector(".app-shell") || document.body;
    var header = shell.querySelector(".app-header");
    if (header && header.parentNode) {
      header.parentNode.insertBefore(el, header.nextSibling);
    } else {
      shell.insertBefore(el, shell.firstChild);
    }
    return el;
  }

  async function fetchAnnounce() {
    try {
      var r = await fetch(API_BASE + "/api/announce");
      var data = await r.json();
      var el = ensureAnnounceBanner();
      if (data.ok && data.announce && data.announce.enabled && data.announce.text) {
        el.textContent = data.announce.text;
        el.style.display = "block";
      } else {
        el.style.display = "none";
        el.textContent = "";
      }
    } catch (e) {}
  }

  (async function init() {
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
