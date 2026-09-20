/**
 * AIMLOCK MODE 10 — Key API Client
 * Thay thế hoàn toàn hệ thống key localStorage cũ.
 *
 * Cách dùng:
 * 1. Đặt <script src="https://YOUR-API-HOST/key-api-client.js"></script>
 *    HOẶC copy nội dung này vào cuối file HTML (trước </body>)
 * 2. Đặt window.ALM10_API_BASE = "https://YOUR-API-HOST"; trước khi load script
 *    (mặc định: cùng origin hoặc http://localhost:3000)
 */
(function () {
  "use strict";

  const API_BASE =
    (typeof window !== "undefined" && window.ALM10_API_BASE) ||
    (location.protocol === "file:" ? "http://localhost:3000" : location.origin.replace(/:\d+$/, ":3000"));

  const STORAGE = "alm10_session_v3"; // session cache local (chỉ lưu user + token info từ server)

  const gate = document.getElementById("keyGate");
  const success = document.getElementById("keySuccess");
  const userInput = document.getElementById("kgUser");
  const passInput = document.getElementById("kgPass");
  const submitBtn = document.getElementById("kgSubmit");
  const errEl = document.getElementById("kgError");
  const ksMsg = document.getElementById("ksMsg");
  const ksTime = document.getElementById("ksTime");
  const ksEnter = document.getElementById("ksEnter");

  function normalizeUser(raw) {
    return String(raw || "").trim();
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
    } catch {
      return null;
    }
  }

  function saveLocal(s) {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(s));
    } catch {}
  }

  function clearLocal() {
    try {
      localStorage.removeItem(STORAGE);
      localStorage.removeItem("alm10_session_v2");
      localStorage.removeItem("alm10_session_v1");
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
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      "Kích hoạt thiết bị cho <b>" +
      escapeHtml(s.user) +
      "</b><br/>" +
      "Key: <b>" +
      escapeHtml(s.key) +
      "</b> (" +
      escapeHtml(s.label || "") +
      ")<br/>" +
      "Thiết bị: <b>" +
      escapeHtml(s.device || "") +
      "</b>";

    ksTime.innerHTML =
      "Bắt đầu: <b>" +
      escapeHtml(s.startText || "") +
      "</b><br/>" +
      "Hết hạn: <b>" +
      escapeHtml(s.expireText || "") +
      "</b><br/>" +
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
    const user = normalizeUser(userInput && userInput.value);
    const key = (passInput && passInput.value || "").trim();

    if (!user) {
      showError("Vui lòng nhập tài khoản.");
      return;
    }
    if (!key) {
      showError("Vui lòng nhập mật khẩu / key.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "ĐANG KÍCH HOẠT...";
    }

    try {
      const data = await apiPost("/api/activate", {
        user,
        key,
        device: deviceName()
      });

      if (!data.ok || !data.session) {
        showError(data.error || "Kích hoạt thất bại");
        return;
      }

      saveLocal(data.session);
      showSuccess(data.session);
      startTick(data.session.user);
    } catch (e) {
      showError("Không kết nối được API. Kiểm tra server.");
      console.error(e);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "KÍCH HOẠT";
      }
    }
  }

  async function validateUser(user) {
    try {
      const data = await apiPost("/api/validate", { user });
      return data;
    } catch {
      return { ok: false, valid: false };
    }
  }

  function enterApp() {
    unlockUI();
    updateHomeKeyInfo();
  }

  function bindLogout() {
    const btn = document.getElementById("settings-logout-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      const s = loadLocal();
      if (s && s.user) {
        apiPost("/api/logout", { user: s.user }).catch(function () {});
      }
      clearLocal();
      if (tickTimer) clearInterval(tickTimer);
      lockUI();
      if (userInput) userInput.value = "";
      if (passInput) passInput.value = "";
      showError("");
      if (success) success.hidden = true;
    });
  }

  let tickTimer = null;
  function startTick(user) {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(async function () {
      const data = await validateUser(user);
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
    }, 15000); // check mỗi 15s (không spam API)
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
    if (!elUser) return;

    const s = loadLocal();
    if (!s || !s.user) {
      elUser.textContent = "—";
      if (elKey) elKey.textContent = "—";
      if (elType) elType.textContent = "—";
      if (elDevice) elDevice.textContent = "—";
      if (elStart) elStart.textContent = "—";
      if (elExpire) elExpire.textContent = "—";
      if (elLeft) elLeft.textContent = "Hết hạn / Chưa kích hoạt";
      if (elStatus) {
        elStatus.textContent = "Hết hạn";
        elStatus.classList.add("is-expired");
      }
      return;
    }

    elUser.textContent = s.user || "—";
    if (elKey) elKey.textContent = s.key || "—";
    if (elType) elType.textContent = s.label || "—";
    if (elDevice) elDevice.textContent = s.device || "—";
    if (elStart) elStart.textContent = s.startText || "—";
    if (elExpire) elExpire.textContent = s.expireText || "—";
    if (elLeft) elLeft.textContent = s.remaining || "—";
    if (elStatus) {
      elStatus.textContent = "Đang hoạt động";
      elStatus.classList.remove("is-expired");
    }
  }

  // ---- INIT ----
  (async function init() {
    // Vô hiệu hóa script key cũ nếu còn chạy (tránh conflict)
    try {
      window.ALM10Key = {
        updateHome: updateHomeKeyInfo,
        clear: function () {
          clearLocal();
          lockUI();
        },
        session: loadLocal,
        apiBase: API_BASE
      };
    } catch {}

    const local = loadLocal();
    if (local && local.user) {
      const data = await validateUser(local.user);
      if (data.valid && data.session) {
        saveLocal(data.session);
        unlockUI();
        updateHomeKeyInfo();
        startTick(data.session.user);
      } else {
        clearLocal();
        lockUI();
      }
    } else {
      lockUI();
    }

    if (submitBtn) {
      // remove old listeners by cloning
      const neo = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(neo, submitBtn);
      neo.addEventListener("click", activate);
    }

    if (passInput) {
      passInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") activate();
      });
    }
    if (userInput) {
      userInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && passInput) passInput.focus();
      });
    }
    if (ksEnter) {
      ksEnter.addEventListener("click", function () {
        const s = loadLocal();
        if (s && s.user) {
          enterApp();
          startTick(s.user);
        } else {
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
