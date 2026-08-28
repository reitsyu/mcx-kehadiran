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
let lastDashboard = null; // cache respons getDashboard terakhir, dipakai untuk export DOCX

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
    setupTtdPad();
  } catch (err) {
    showBlocked("Sesi presensi tidak ditemukan atau tidak valid.");
  }
}

function showBlocked(msg) {
  $("blocked-msg").textContent = msg;
  show("screen-anggota-blocked");
}

/* ---------------- STEP 1: FORM DATA ---------------- */
let pendingAnggota = null; // { nama, tingkat, rombel }

function bindAnggotaForm(sessionId) {
  $("f-nama").addEventListener("input", () => {
    const cursor = $("f-nama").selectionStart;
    $("f-nama").value = $("f-nama").value.toUpperCase();
    $("f-nama").setSelectionRange(cursor, cursor);
  });

  $("btn-lanjut-ttd").onclick = () => {
    const nama = $("f-nama").value.trim().toUpperCase();
    const tingkat = $("f-tingkat").value;
    const rombel = $("f-rombel").value;
    $("anggota-error").classList.add("hidden");

    if (!nama) return anggotaError("Nama lengkap wajib diisi.");
    if (nama.length < 3) return anggotaError("Nama terlalu pendek. Masukkan nama lengkap.");
    if (!tingkat) return anggotaError("Pilih tingkat.");
    if (!rombel) return anggotaError("Pilih rombel.");

    pendingAnggota = { nama, tingkat, rombel };
    show("screen-anggota-ttd");

  };

  $("btn-ttd-kembali").onclick = () => show("screen-anggota-form");
  $("btn-ttd-undo").onclick = () => ttdUndo();
  $("btn-ttd-clear").onclick = () => ttdClear();

  $("btn-ttd-confirm").onclick = async () => {
    $("ttd-error").classList.add("hidden");
    if (ttdIsEmpty()) return ttdError("Tanda tangan belum diisi.");
    if (!pendingAnggota) { show("screen-anggota-form"); return; }

    $("btn-ttd-confirm").disabled = true;
    $("btn-ttd-confirm").textContent = "Memproses...";

    try {
      const res = await callApi("submitAttendance", {
        sessionId,
        nama: pendingAnggota.nama,
        tingkat: pendingAnggota.tingkat,
        rombel: pendingAnggota.rombel,
        deviceId: getDeviceId(),
        ttd: ttdToBase64Png()
      });
      $("success-msg").textContent = `Kehadiran atas nama ${res.nama} (${res.tingkat}-${res.rombel}) berhasil dicatat pukul ${res.waktu}.`;
      show("screen-anggota-success");
    } catch (err) {
      ttdError(err.message);
      $("btn-ttd-confirm").disabled = false;
      $("btn-ttd-confirm").textContent = "Konfirmasi Kehadiran";
    }
  };
}

function anggotaError(msg) {
  $("anggota-error").textContent = msg;
  $("anggota-error").classList.remove("hidden");
}
function ttdError(msg) {
  $("ttd-error").textContent = msg;
  $("ttd-error").classList.remove("hidden");
}

/* ---------------- STEP 2: SIGNATURE PAD ---------------- */
/* Kanvas resolusi TETAP 600x220 (pendekatan lama yang andal) agar ukuran
   tanda tangan konsisten dan tidak membesar, namun garis tetap digambar
   halus (quadratic curve) dengan dukungan sentuhan (Pointer Events +
   setPointerCapture + touch-action:none). Tidak ada resize/DPR yang bisa
   menghapus atau memperbesar gambar secara tak terduga. */
const TTD_W = 600;
const TTD_H = 220;

let ttdCanvas = null;
let ttdCtx = null;
let ttdStrokes = [];   // kumpulan stroke tanda tangan, tiap stroke = array {x,y}
let ttdPadReady = false;

function setupTtdPad() {
  if (ttdPadReady) return;
  ttdPadReady = true;

  const canvas = $("ttd-canvas");
  canvas.width = TTD_W;
  canvas.height = TTD_H;
  ttdCanvas = canvas;
  ttdCtx = canvas.getContext("2d");
  clearCanvasBg();

  let drawing = false;
  let currentStroke = null;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = TTD_W / rect.width;
    const sy = TTD_H / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function startDraw(e) {
    e.preventDefault();
    if (e.pointerId !== undefined && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
    drawing = true;
    const pos = getPos(e);
    currentStroke = [pos];
    ttdCtx.beginPath();
    ttdCtx.moveTo(pos.x, pos.y);
    ttdCtx.lineTo(pos.x + 0.01, pos.y + 0.01);
    ttdCtx.stroke();
  }

  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.push(pos);
    drawSmoothSegment(currentStroke);
  }

  function endDraw() {
    if (!drawing) return;
    drawing = false;
    if (currentStroke && currentStroke.length >= 1) ttdStrokes.push(currentStroke);
    currentStroke = null;
  }

  if (window.PointerEvent) {
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", moveDraw);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
  } else {
    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);
    canvas.addEventListener("touchstart", function(e){ startDraw(touchToPointerLike(e)); }, { passive: false });
    canvas.addEventListener("touchmove", function(e){ moveDraw(touchToPointerLike(e)); }, { passive: false });
    canvas.addEventListener("touchend", endDraw);
  }
}

function touchToPointerLike(e) {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  return {
    clientX: t ? t.clientX : 0,
    clientY: t ? t.clientY : 0,
    preventDefault: function(){ e.preventDefault(); }
  };
}

function clearCanvasBg() {
  ttdCtx.fillStyle = "#ffffff";
  ttdCtx.fillRect(0, 0, TTD_W, TTD_H);
  ttdCtx.strokeStyle = "#2b2622";
  ttdCtx.lineWidth = 3;
  ttdCtx.lineJoin = "round";
  ttdCtx.lineCap = "round";
}

function drawSmoothSegment(stroke) {
  const n = stroke.length;
  if (n < 2) return;
  if (n === 2) {
    ttdCtx.beginPath();
    ttdCtx.moveTo(stroke[0].x, stroke[0].y);
    ttdCtx.lineTo(stroke[1].x, stroke[1].y);
    ttdCtx.stroke();
    return;
  }
  const p1 = stroke[n - 2];
  const p2 = stroke[n - 1];
  const mid1 = { x: (stroke[n - 3].x + p1.x) / 2, y: (stroke[n - 3].y + p1.y) / 2 };
  const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  ttdCtx.beginPath();
  ttdCtx.moveTo(mid1.x, mid1.y);
  ttdCtx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
  ttdCtx.stroke();
}

function redrawTtd() {
  clearCanvasBg();
  ttdStrokes.forEach(function(stroke) {
    if (stroke.length === 1) {
      ttdCtx.beginPath();
      ttdCtx.moveTo(stroke[0].x, stroke[0].y);
      ttdCtx.lineTo(stroke[0].x + 0.01, stroke[0].y + 0.01);
      ttdCtx.stroke();
      return;
    }
    ttdCtx.beginPath();
    ttdCtx.moveTo(stroke[0].x, stroke[0].y);
    for (var i = 1; i < stroke.length - 1; i++) {
      var mid = { x: (stroke[i].x + stroke[i + 1].x) / 2, y: (stroke[i].y + stroke[i + 1].y) / 2 };
      ttdCtx.quadraticCurveTo(stroke[i].x, stroke[i].y, mid.x, mid.y);
    }
    ttdCtx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
    ttdCtx.stroke();
  });
}

function ttdUndo() {
  ttdStrokes.pop();
  redrawTtd();
}
function ttdClear() {
  ttdStrokes = [];
  redrawTtd();
}
function ttdIsEmpty() {
  return ttdStrokes.length === 0;
}
function ttdToBase64Png() {
  return ttdCanvas.toDataURL("image/png").split(",")[1];
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
    lastDashboard = res;
    renderSession(res.session);
    renderToday(res.todayAttendance || []);
    $("stat-hadir").textContent = (res.todayAttendance || []).length;

    if (currentRole === "admin" && res.history) {
      renderRiwayat(res.history);
    }
    checkBackendVersionOnce();
  } catch (err) {
    if (/password|auth|login/i.test(err.message)) {
      logout();
    }
  }
}

// Cek sekali saja per sesi: pastikan Apps Script yang live sudah menjalankan
// kode backend terbaru (bukan versi lama yang belum di-redeploy).
let backendVersionChecked = false;
async function checkBackendVersionOnce() {
  if (backendVersionChecked) return;
  backendVersionChecked = true;
  try {
    const res = await callApi("ping", {});
    console.log("[Backend] Versi aktif:", res.version, "| Waktu server:", res.serverTime);
  } catch (err) {
    console.warn("[Backend] Gagal cek versi (mungkin backend lama belum punya action 'ping'):", err.message);
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

/* ---------------- EXPORT DOCX (dibangun manual sebagai ZIP+XML, tanpa library eksternal) ---------------- */
/* File .docx sebenarnya adalah file ZIP berisi beberapa file XML.
   ZIP-nya dibangun manual di sini (metode STORE, tanpa kompresi) supaya
   TIDAK bergantung pada CDN pihak ketiga sama sekali — menghindari kegagalan
   akibat library eksternal gagal dimuat. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function strToBytes(str) {
  return new TextEncoder().encode(str);
}

function makeZip(files) {
  // files: [{ name: string, content: string }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const time = 0, date = 0x21; // tanggal dummy 1980-01-01, tidak berpengaruh ke isi dokumen

  files.forEach(f => {
    const nameBytes = strToBytes(f.name);
    const contentBytes = f.contentBytes ? f.contentBytes : strToBytes(f.content);
    const crc = crc32(contentBytes);
    const size = contentBytes.length;

    const localHeader = new ArrayBuffer(30);
    const lv = new DataView(localHeader);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);

    localParts.push(new Uint8Array(localHeader));
    localParts.push(nameBytes);
    localParts.push(contentBytes);

    const centralHeader = new ArrayBuffer(46);
    const cv = new DataView(centralHeader);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);

    centralParts.push(new Uint8Array(centralHeader));
    centralParts.push(nameBytes);

    offset += localHeader.byteLength + nameBytes.length + contentBytes.length;
  });

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;

  const endRecord = new ArrayBuffer(22);
  const ev = new DataView(endRecord);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...localParts, ...centralParts, new Uint8Array(endRecord)];
  const totalSize = allParts.reduce((a, b) => a + b.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  allParts.forEach(p => { result.set(p, pos); pos += p.length; });
  return result;
}

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function hariIndoJS(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return HARI_ID[d.getDay()];
}
function tanggalLabelJS(dateStr) {
  const parts = dateStr.split("-");
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10) - 1;
  const y = parts[0];
  return `${d} ${BULAN_ID[m]} ${y}`;
}

function getRowsForDate(tanggal) {
  if (!lastDashboard) return null;
  if (tanggal === todayLabelISO()) return lastDashboard.todayAttendance || [];
  if (lastDashboard.history) {
    const meeting = lastDashboard.history.find(m => m.tanggal === tanggal);
    if (meeting) return meeting.rows;
  }
  return null;
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Font resmi dokumen: Times New Roman, dipakai konsisten di seluruh teks
// (kop, tabel, footer) agar hasil cetak terlihat seperti dokumen resmi.
const DOCX_FONT = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`;

function docxParagraph(text, { bold = false, size = 22, center = true } = {}) {
  const jc = center ? '<w:jc w:val="center"/>' : "";
  const b = bold ? "<w:b/>" : "";
  return `<w:p><w:pPr>${jc}<w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${DOCX_FONT}${b}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function docxCell(text, { bold = false, width = 2000, center = false } = {}) {
  const jc = center ? '<w:jc w:val="center"/>' : "";
  const b = bold ? "<w:b/>" : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr>${jc}<w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${DOCX_FONT}${b}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function docxDrawing(rId, name, cx, cy) {
  return `<w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${cx}" cy="${cy}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${rId}" name="${name}${rId}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:nvPicPr>
              <pic:cNvPr id="${rId}" name="${name}${rId}"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="rId${rId}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing>`;
}

function docxCellImage(rId, width, { cx = 1080000, cy = 380000 } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r>${docxDrawing(rId, "TandaTangan", cx, cy)}</w:r></w:p></w:tc>`;
}

function base64ToBytes(b64) {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

const PEMBINA_NAME = "Eka Meilinda Fitriana, S.Pd.";
function buildDocumentPackage(tanggal, rows) {
  // Mengembalikan { documentXml, docRelsXml, mediaFiles: [{name, contentBytes}] }
  const mediaFiles = [];
  const docRelEntries = [];
  let rId = 1;

  const borders = `
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="000000"/>
      <w:left w:val="single" w:sz="4" w:color="000000"/>
      <w:bottom w:val="single" w:sz="4" w:color="000000"/>
      <w:right w:val="single" w:sz="4" w:color="000000"/>
      <w:insideH w:val="single" w:sz="4" w:color="000000"/>
      <w:insideV w:val="single" w:sz="4" w:color="000000"/>
    </w:tblBorders>`;

  const W_NO = 700, W_NAMA = 4200, W_KELAS = 1200, W_TTD = 2300;

  const headerRow = `<w:tr>${
    docxCell("No", { bold: true, width: W_NO, center: true })
  }${
    docxCell("Nama Lengkap", { bold: true, width: W_NAMA })
  }${
    docxCell("Kelas", { bold: true, width: W_KELAS, center: true })
  }${
    docxCell("Tanda Tangan", { bold: true, width: W_TTD, center: true })
  }</w:tr>`;

  let bodyRows;
  if (rows.length === 0) {
    bodyRows = `<w:tr>${docxCell("", { width: W_NO, center: true })}${docxCell("(Tidak ada data kehadiran)", { width: W_NAMA })}${docxCell("", { width: W_KELAS })}${docxCell("", { width: W_TTD })}</w:tr>`;
  } else {
    bodyRows = rows.map((r, idx) => {
      const kelas = `${r.tingkat || ""}-${r.rombel || ""}`;
      let ttdCell;
      if (r.ttd) {
        const thisRId = rId++;
        mediaFiles.push({ name: `word/media/image${thisRId}.png`, contentBytes: base64ToBytes(r.ttd) });
        docRelEntries.push(`<Relationship Id="rId${thisRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${thisRId}.png"/>`);
        ttdCell = docxCellImage(thisRId, W_TTD);
      } else {
        ttdCell = docxCell("-", { width: W_TTD, center: true });
      }
      return `<w:tr>${docxCell(String(idx + 1), { width: W_NO, center: true })}${docxCell(r.nama, { width: W_NAMA })}${docxCell(kelas, { width: W_KELAS, center: true })}${ttdCell}</w:tr>`;
    }).join("");
  }

  const cellMargins = `<w:tblCellMar>
      <w:top w:w="60" w:type="dxa"/>
      <w:left w:w="100" w:type="dxa"/>
      <w:bottom w:w="60" w:type="dxa"/>
      <w:right w:w="100" w:type="dxa"/>
    </w:tblCellMar>`;

  const table = `
    <w:tbl>
      <w:tblPr>${borders}${cellMargins}<w:tblW w:w="${W_NO + W_NAMA + W_KELAS + W_TTD}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="${W_NO}"/><w:gridCol w:w="${W_NAMA}"/><w:gridCol w:w="${W_KELAS}"/><w:gridCol w:w="${W_TTD}"/></w:tblGrid>
      ${headerRow}
      ${bodyRows}
    </w:tbl>`;

  const header = [
    docxParagraph("PEMERINTAH DAERAH PROVINSI JAWA TIMUR", { bold: true, size: 24 }),
    docxParagraph("DINAS PENDIDIKAN", { bold: true, size: 24 }),
    docxParagraph("SMA NEGERI 1 LUMAJANG", { bold: true, size: 28 }),
    docxParagraph("Jl. Jendral Ahmad Yani No.07 Telp./Fax (0334) 881747. Lumajang 67316", { size: 18 }),
    docxParagraph("Website : www.sman1lmj.sch.id   e-mail : smanegerisatulumajang@gmail.com", { size: 18 }),
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="80" w:after="120"/></w:pPr></w:p>`,
    docxParagraph("DAFTAR HADIR EKSTRAKURIKULER", { bold: true, size: 26 }),
    `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`,
    docxInfoLine("Nama Ekskul", "Media Center X Kepenulisan"),
    docxInfoLine("Hari/Tanggal", `${hariIndoJS(tanggal)}, ${tanggalLabelJS(tanggal)}`),
    docxInfoLine("Pembina", PEMBINA_NAME),
    docxInfoLineBlank("Pemateri"),        // ruang kosong bergaris, diisi manual pakai pensil setelah dicetak
    docxInfoLineBlank("Materi/Kegiatan"), // ruang kosong bergaris, diisi manual pakai pensil setelah dicetak
    `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>`
  ].join("");

  // Footer: "Mengetahui, Pembina," HARUS tetap menyatu (tidak terpisah halaman)
  // dengan nama & tanda tangan Pembina di bawahnya. w:keepNext dipasang pada
  // paragraf "Mengetahui,"/"Pembina," dan seluruh blok dibungkus dalam satu
  // <w:p> beruntun dengan spacing rapi (bukan baris kosong berlebihan) supaya
  // benar-benar berada di bagian paling bawah dokumen tanpa terpotong.
  const footer = [
    `<w:p><w:pPr><w:spacing w:before="240" w:after="0"/><w:jc w:val="right"/><w:keepNext/><w:keepLines/></w:pPr><w:r><w:rPr>${DOCX_FONT}</w:rPr><w:t>Mengetahui,</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/><w:keepNext/><w:keepLines/></w:pPr><w:r><w:rPr>${DOCX_FONT}</w:rPr><w:t>Pembina,</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/><w:keepNext/><w:keepLines/></w:pPr></w:p>`,
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/><w:keepNext/><w:keepLines/></w:pPr></w:p>`,
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/><w:keepLines/></w:pPr><w:r><w:rPr>${DOCX_FONT}<w:b/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${xmlEscape(PEMBINA_NAME)}</w:t></w:r></w:p>`
  ].join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${header}
    ${table}
    <w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>
    ${footer}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${docRelEntries.join("\n  ")}
</Relationships>`;

  return { documentXml, docRelsXml, mediaFiles, hasImages: mediaFiles.length > 0 };
}

function docxInfoLine(label, value) {
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="60"/></w:pPr><w:r><w:rPr>${DOCX_FONT}<w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r><w:r><w:rPr>${DOCX_FONT}</w:rPr><w:t xml:space="preserve"> : ${xmlEscape(value)}</w:t></w:r></w:p>`;
}

function docxInfoLineBlank(label) {
  // Label diikuti garis panjang (karakter underscore) untuk diisi manual pakai pensil setelah dicetak.
  // Pakai karakter '_' literal (bukan spasi+underline) supaya PASTI tampak di semua penampil & saat dicetak.
  // Baris kosong tambahan setelahnya (w:spacing w:after lebih besar) memberi
  // ruang tulis tangan yang cukup untuk Pemateri & Materi/Kegiatan.
  const blank = "_".repeat(48);
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="200"/></w:pPr><w:r><w:rPr>${DOCX_FONT}<w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r><w:r><w:rPr>${DOCX_FONT}</w:rPr><w:t xml:space="preserve"> : ${blank}</w:t></w:r></w:p>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

async function exportDocx(tanggal) {
  const rows = getRowsForDate(tanggal);
  if (rows === null) {
    alert("Data pertemuan tidak ditemukan. Coba muat ulang dashboard.");
    return;
  }

  try {
    const pkg = buildDocumentPackage(tanggal, rows);

    const files = [
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: RELS_XML },
      { name: "word/document.xml", content: pkg.documentXml }
    ];
    if (pkg.hasImages) {
      files.push({ name: "word/_rels/document.xml.rels", content: pkg.docRelsXml });
      files.push(...pkg.mediaFiles);
    }

    const zipBytes = makeZip(files);
    const blob = new Blob([zipBytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Absensi_Media_Center_${tanggal}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Gagal membuat file DOCX: " + err.message);
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
