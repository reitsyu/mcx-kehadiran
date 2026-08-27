/* ======================================================
   Media Center X Kepenulisan — Kehadiran
   app.js
   ====================================================== */

// >>> GANTI DENGAN URL WEB APP GOOGLE APPS SCRIPT ANDA <<<
const API_URL = "https://script.google.com/macros/s/AKfycbydQI_Wwu1b_Sja0kqgdPWyOfGKK_6ZD3dAD0U9HmQ6TLU6kQbUjrukftW29h8i_kQsag/exec";

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll("#app > div").forEach(el => el.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function getDeviceId() {
  let id = localStorage.getItem("mcx_device_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem("mcx_device_id", id);
  }
  return id;
}

async function callApi(action, payload) {
  const body = JSON.stringify({ action, ...payload });
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || "Terjadi kesalahan");
  return data;
}

/* ---------------- STATE ---------------- */
let currentRole = null;   // 'admin' | 'petugas'
let currentPassword = null;
let currentSessionId = null;
let countdownTimer = null;
let dashboardPollTimer = null;

/* ======================================================
   ROUTER — jalan pertama kali
   ====================================================== */
window.addEventListener("DOMContentLoaded", init);

function init() {
  const params = new URLSearchParams(location.search);
  const sessionParam = params.get("session");

  if (sessionParam) {
    currentSessionId = sessionParam;
    initAnggotaFlow(sessionParam);
    return;
  }

  const savedRole = localStorage.getItem("mcx_role");
  const savedPass = localStorage.getItem("mcx_pass");
  if (savedRole && savedPass) {
    currentRole = savedRole;
    currentPassword = savedPass;
    enterDashboard();
    return;
  }

  show("screen-role");
  bindRolePicker();
}

/* ======================================================
   ROLE PICKER + LOGIN
   ====================================================== */
function bindRolePicker() {
  document.querySelectorAll('[data-role]').forEach(btn => {
    btn.onclick = () => {
      currentRole = btn.dataset.role;
      $("login-title").textContent = currentRole === "admin" ? "Login Admin" : "Login Petugas";
      $("login-password").value = "";
      $("login-error").classList.add("hidden");
      show("screen-login");
    };
  });

  $("btn-back-role").onclick = () => show("screen-role");

  $("btn-do-login").onclick = doLogin;
  $("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
}

async function doLogin() {
  const pass = $("login-password").value.trim();
  if (!pass) return;
  $("btn-do-login").disabled = true;
  try {
    await callApi("login", { role: currentRole, password: pass });
    currentPassword = pass;
    localStorage.setItem("mcx_role", currentRole);
    localStorage.setItem("mcx_pass", currentPassword);
    enterDashboard();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("hidden");
  } finally {
    $("btn-do-login").disabled = false;
  }
}

function logout() {
  localStorage.removeItem("mcx_role");
  localStorage.removeItem("mcx_pass");
  currentRole = null;
  currentPassword = null;
  clearInterval(countdownTimer);
  clearInterval(dashboardPollTimer);
  location.href = location.pathname;
}

/* ======================================================
   ANGGOTA FLOW
   ====================================================== */
async function initAnggotaFlow(sessionId) {
  show("screen-loading");
  try {
    const res = await callApi("getSessionStatus", { sessionId });
    if (res.status !== "OPEN") {
      showBlocked(res.status === "EXPIRED" ? "Sesi presensi ini sudah berakhir (lebih dari 5 menit)." : "Sesi presensi ini sudah ditutup.");
      return;
    }
    show("screen-anggota-form");
    bindAnggotaForm(sessionId);
  } catch (err) {
    showBlocked("Sesi presensi tidak ditemukan atau tidak valid.");
  }
}

function showBlocked(msg) {
  $("blocked-msg").textContent = msg;
  show("screen-anggota-blocked");
}

function bindAnggotaForm(sessionId) {
  $("f-nama").addEventListener("input", () => {
    const cursor = $("f-nama").selectionStart;
    $("f-nama").value = $("f-nama").value.toUpperCase();
    $("f-nama").setSelectionRange(cursor, cursor);
  });

  $("btn-submit-hadir").onclick = async () => {
    const nama = $("f-nama").value.trim().toUpperCase();
    const tingkat = $("f-tingkat").value;
    const rombel = $("f-rombel").value;
    $("anggota-error").classList.add("hidden");

    if (!nama || nama.split(" ").length < 1) {
      return anggotaError("Nama lengkap wajib diisi.");
    }
    if (nama.length < 3) {
      return anggotaError("Nama terlalu pendek. Masukkan nama lengkap.");
    }
    if (!tingkat) return anggotaError("Pilih tingkat.");
    if (!rombel) return anggotaError("Pilih rombel.");

    $("btn-submit-hadir").disabled = true;
    $("btn-submit-hadir").textContent = "Memproses...";

    try {
      const res = await callApi("submitAttendance", {
        sessionId,
        nama, tingkat, rombel,
        deviceId: getDeviceId()
      });
      $("success-msg").textContent = `Kehadiran atas nama ${res.nama} (${res.tingkat}-${res.rombel}) berhasil dicatat pukul ${res.waktu}.`;
      show("screen-anggota-success");
    } catch (err) {
      anggotaError(err.message);
      $("btn-submit-hadir").disabled = false;
      $("btn-submit-hadir").textContent = "HADIR";
    }
  };
}

function anggotaError(msg) {
  $("anggota-error").textContent = msg;
  $("anggota-error").classList.remove("hidden");
}

/* ======================================================
   DASHBOARD (ADMIN / PETUGAS)
   ====================================================== */
function enterDashboard() {
  show("screen-dashboard");
  $("dash-role-tag").textContent = currentRole === "admin" ? "ADMIN" : "PETUGAS";
  $("card-kelola-petugas").classList.toggle("hidden", currentRole !== "admin");
  $("card-riwayat").classList.toggle("hidden", currentRole !== "admin");

  $("btn-logout").onclick = logout;
  $("btn-open-session").onclick = openSession;
  $("btn-close-session").onclick = closeSession;
  $("btn-export-today").onclick = () => exportDocx(todayLabelISO());
  if (currentRole === "admin") {
    $("btn-save-petugas-pass").onclick = savePetugasPassword;
  }

  loadDashboard();
  dashboardPollTimer = setInterval(loadDashboard, 8000);
}

async function loadDashboard() {
  try {
    const res = await callApi("getDashboard", { role: currentRole, password: currentPassword });
    renderSession(res.session);
    renderToday(res.todayAttendance || []);
    $("stat-hadir").textContent = (res.todayAttendance || []).length;

    if (currentRole === "admin" && res.history) {
      renderRiwayat(res.history);
    }
  } catch (err) {
    if (/password|auth|login/i.test(err.message)) {
      logout();
    }
  }
}

function renderSession(session) {
  clearInterval(countdownTimer);
  if (session && session.status === "OPEN") {
    currentSessionId = session.sessionId;
    $("session-badge").textContent = "TERBUKA";
    $("session-badge").className = "status-badge status-open";
    $("btn-open-session").classList.add("hidden");
    $("btn-close-session").classList.remove("hidden");
    $("qr-area").classList.remove("hidden");

    $("qrcode").innerHTML = "";
    const link = `${location.origin}${location.pathname}?session=${session.sessionId}`;
    new QRCode($("qrcode"), { text: link, width: 200, height: 200 });

    startCountdown(session.expireTime);
  } else {
    $("session-badge").textContent = "TERTUTUP";
    $("session-badge").className = "status-badge status-closed";
    $("btn-open-session").classList.remove("hidden");
    $("btn-close-session").classList.add("hidden");
    $("qr-area").classList.add("hidden");
  }
}

function startCountdown(expireTimeISO) {
  const expireTime = new Date(expireTimeISO).getTime();
  function tick() {
    const remaining = Math.max(0, Math.floor((expireTime - Date.now()) / 1000));
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    $("countdown-text").textContent = `${m}:${s}`;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      loadDashboard();
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderToday(list) {
  const tbody = $("today-table").querySelector("tbody");
  tbody.innerHTML = "";
  list.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.waktu}</td>
      <td>${row.nama}</td>
      <td>${row.tingkat}-${row.rombel}</td>
      <td>${currentRole === "admin" ? rowActionsHtml(row.id) : ""}</td>
    `;
    tbody.appendChild(tr);
  });
  if (currentRole === "admin") bindRowActions();
}

function rowActionsHtml(id) {
  return `<div class="row-actions">
    <button class="btn-outline btn-sm" data-edit="${id}">Edit</button>
    <button class="btn-danger btn-sm" data-del="${id}">Hapus</button>
  </div>`;
}

function bindRowActions() {
  document.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => editAttendance(btn.dataset.edit);
  });
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => deleteAttendance(btn.dataset.del);
  });
}

async function editAttendance(id) {
  const nama = prompt("Nama lengkap baru:");
  if (nama === null) return;
  const tingkat = prompt("Tingkat baru (X/XI/XII):");
  if (tingkat === null) return;
  const rombel = prompt("Rombel baru (A-J):");
  if (rombel === null) return;
  try {
    await callApi("editAttendance", {
      role: currentRole, password: currentPassword,
      id, nama: nama.trim().toUpperCase(), tingkat: tingkat.trim().toUpperCase(), rombel: rombel.trim().toUpperCase()
    });
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteAttendance(id) {
  if (!confirm("Hapus data kehadiran ini?")) return;
  try {
    await callApi("deleteAttendance", { role: currentRole, password: currentPassword, id });
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function renderRiwayat(history) {
  const container = $("riwayat-container");
  container.innerHTML = "";
  history.forEach(meeting => {
    const block = document.createElement("div");
    block.className = "meeting-block";
    block.innerHTML = `
      <div class="meeting-title">
        <span>PERTEMUAN — ${meeting.tanggalLabel}</span>
        <button class="btn-outline btn-sm" data-export="${meeting.tanggal}">Export DOCX</button>
      </div>
      <table class="attendance-table">
        <thead><tr><th>Waktu</th><th>Nama</th><th>Kelas</th></tr></thead>
        <tbody>
          ${meeting.rows.map(r => `<tr><td>${r.waktu}</td><td>${r.nama}</td><td>${r.tingkat}-${r.rombel}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    container.appendChild(block);
  });
  container.querySelectorAll("[data-export]").forEach(btn => {
    btn.onclick = () => exportDocx(btn.dataset.export);
  });
}

/* ---------------- SESSION CONTROL ---------------- */
async function openSession() {
  $("btn-open-session").disabled = true;
  try {
    await callApi("openSession", { role: currentRole, password: currentPassword });
    loadDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    $("btn-open-session").disabled = false;
  }
}

async function closeSession() {
  if (!currentSessionId) return;
  try {
    await callApi("closeSession", { role: currentRole, password: currentPassword, sessionId: currentSessionId });
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

/* ---------------- PETUGAS PASSWORD ---------------- */
async function savePetugasPassword() {
  const newPass = $("new-petugas-pass").value.trim();
  if (!newPass) return;
  try {
    await callApi("setPetugasPassword", { role: currentRole, password: currentPassword, newPassword: newPass });
    $("petugas-pass-msg").innerHTML = `<div class="success-box">Password Petugas berhasil diperbarui.</div>`;
    $("new-petugas-pass").value = "";
  } catch (err) {
    $("petugas-pass-msg").innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}

/* ---------------- EXPORT DOCX ---------------- */
async function exportDocx(tanggal) {
  try {
    const res = await callApi("exportDocx", { role: currentRole, password: currentPassword, tanggal });
    const byteChars = atob(res.base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

/* ---------------- UTIL ---------------- */
function todayLabelISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
