(function () {
  "use strict";

  const LICENSE_STORAGE_KEY = "atg_license_state";
  const PROGRAM_SESSION_KEY = "atg_program_session";
  const LOGIN_MESSAGE_KEY = "atg_login_message";
  const form = document.getElementById("loginForm");
  const input = document.getElementById("licenseSerialInput");
  const button = document.getElementById("loginBtn");
  const errorBox = document.getElementById("loginError");

  function setError(message) {
    errorBox.textContent = String(message || "");
  }

  function programUrl() {
    return `/app${window.location.search || ""}`;
  }

  async function validateSerial(serial) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/license/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Serial ไม่ถูกต้องหรือหมดอายุแล้ว");
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("เชื่อมต่อ License Server ช้าเกินไป กรุณาลองใหม่");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resizeForProgram() {
    try {
      if (window.pywebview?.api?.open_program) {
        await window.pywebview.api.open_program();
        return;
      }
      window.resizeTo(1220, 720);
      window.moveTo(Math.max(0, (screen.availWidth - 1220) / 2), Math.max(0, (screen.availHeight - 720) / 2));
    } catch (_) {
      // Browser mode may not permit scripted resizing; navigation still works.
    }
  }

  async function ensureLoginWindowSize() {
    if (new URLSearchParams(window.location.search).get("desktop") !== "1") return;
    try {
      if (window.pywebview?.api?.open_login) {
        await window.pywebview.api.open_login();
        return;
      }
      window.resizeTo(450, 800);
      window.moveTo(Math.max(0, (screen.availWidth - 450) / 2), Math.max(0, (screen.availHeight - 800) / 2));
    } catch (_) {
      // Browser app mode may ignore scripted window sizing.
    }
  }

  const message = sessionStorage.getItem(LOGIN_MESSAGE_KEY) || "";
  if (message) {
    sessionStorage.removeItem(LOGIN_MESSAGE_KEY);
    setError(message);
  }
  sessionStorage.removeItem(PROGRAM_SESSION_KEY);
  ensureLoginWindowSize();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const serial = input.value.trim();
    if (!serial) {
      setError("กรุณากรอก Serial ก่อนเข้าสู่โปรแกรม");
      input.focus();
      return;
    }

    const label = button.querySelector(".login-btn-label");
    button.disabled = true;
    label.textContent = "กำลังตรวจสอบ...";
    setError("");
    try {
      const result = await validateSerial(serial);
      localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(result.state || { serial }));
      sessionStorage.setItem(PROGRAM_SESSION_KEY, "1");
      label.textContent = "กำลังเปิดโปรแกรม...";
      await resizeForProgram();
      window.location.replace(programUrl());
    } catch (error) {
      localStorage.removeItem(LICENSE_STORAGE_KEY);
      sessionStorage.removeItem(PROGRAM_SESSION_KEY);
      setError(error?.message || "Login ไม่สำเร็จ");
      input.select();
    } finally {
      button.disabled = false;
      label.textContent = "เข้าสู่โปรแกรม";
    }
  });
})();
