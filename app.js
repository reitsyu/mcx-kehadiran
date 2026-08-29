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
let ttdCanvas = null;
let ttdCtx = null;
let ttdStrokes = [];
let ttdPadReady = false;

function setupTtdPad() {
  if (ttdPadReady) return; // hanya inisialisasi sekali
  ttdPadReady = true;

  const canvas = $("ttd-canvas");
  canvas.width = 700;  // resolusi internal tetap, kecil & konsisten
  canvas.height = 260;
  ttdCanvas = canvas;
  ttdCtx = canvas.getContext("2d");
  clearCanvasBg();

  let drawing = false;
  let currentStroke = null;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches && e.touches[0];
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    const pos = getPos(e);
    currentStroke = [pos];
    ttdCtx.beginPath();
    ttdCtx.moveTo(pos.x, pos.y);
  }
  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.push(pos);
    // Smoothing: gambar kurva quadratic lewat titik tengah antar-titik,
    // bukan garis lurus antar titik mentah — hasilnya jauh lebih halus,
    // terutama saat gerakan jari cepat / sample rate rendah.
    const n = currentStroke.length;
    if (n < 3) {
      const p = currentStroke[n - 1];
      ttdCtx.lineTo(p.x, p.y);
      ttdCtx.stroke();
    } else {
      const p1 = currentStroke[n - 3];
      const p2 = currentStroke[n - 2];
      const p3 = currentStroke[n - 1];
      const midA = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const midB = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
      ttdCtx.beginPath();
      ttdCtx.moveTo(midA.x, midA.y);
      ttdCtx.quadraticCurveTo(p2.x, p2.y, midB.x, midB.y);
      ttdCtx.stroke();
    }
  }
  function endDraw(e) {
    if (!drawing) return;
    drawing = false;
    if (currentStroke && currentStroke.length > 1) ttdStrokes.push(currentStroke);
    else if (currentStroke && currentStroke.length === 1) ttdStrokes.push(currentStroke); // titik tunggal (ketukan)
    currentStroke = null;
  }

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", moveDraw, { passive: false });
  canvas.addEventListener("touchend", endDraw);
}

function clearCanvasBg() {
  ttdCtx.fillStyle = "#ffffff";
  ttdCtx.fillRect(0, 0, ttdCanvas.width, ttdCanvas.height);
  ttdCtx.strokeStyle = "#2b2622";
  ttdCtx.lineWidth = 3;
  ttdCtx.lineJoin = "round";
  ttdCtx.lineCap = "round";
}

// Dipakai saat redraw (undo/clear) — merender ulang stroke yang sudah
// tersimpan dengan teknik smoothing yang sama seperti saat menggambar live,
// supaya hasil undo terlihat identik dengan gambar aslinya.
function drawStrokeSmooth(ctx, stroke) {
  if (stroke.length === 0) return;
  if (stroke.length === 1) {
    ctx.beginPath();
    ctx.arc(stroke[0].x, stroke[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(stroke[0].x, stroke[0].y);
  for (let i = 1; i < stroke.length - 1; i++) {
    const midX = (stroke[i].x + stroke[i + 1].x) / 2;
    const midY = (stroke[i].y + stroke[i + 1].y) / 2;
    ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
  }
  const secondLast = stroke[stroke.length - 2];
  const last = stroke[stroke.length - 1];
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  ctx.stroke();
}

function redrawTtd() {
  clearCanvasBg();
  ttdStrokes.forEach(stroke => drawStrokeSmooth(ttdCtx, stroke));
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

function docxParagraph(text, { bold = false, size = 22, center = true } = {}) {
  const jc = center ? '<w:jc w:val="center"/>' : "";
  const b = bold ? "<w:b/>" : "";
  return `<w:p><w:pPr>${jc}<w:spacing w:after="0"/></w:pPr><w:r><w:rPr>${b}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function docxCell(text, { bold = false, width = 2000, center = false } = {}) {
  const jc = center ? '<w:jc w:val="center"/>' : "";
  const b = bold ? "<w:b/>" : "";
  const margin = `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${margin}</w:tcPr><w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr>${b}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function docxCellImage(rId, width, { cx = 1080000, cy = 380000 } = {}) {
  const margin = `<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${margin}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${cx}" cy="${cy}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${rId}" name="TandaTangan${rId}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:nvPicPr>
              <pic:cNvPr id="${rId}" name="TandaTangan${rId}"/>
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
  </w:drawing></w:r></w:p></w:tc>`;
}

function base64ToBytes(b64) {
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

// Logo dipakai di kop surat export DOCX (base64 PNG, sudah dikompresi & di-crop).
// Ukuran asli logo sekolah 349x350px, logo Media Center 279x350px (rasio dipakai di docxLogoCell).
const LOGO_SMASA_B64 = "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wKKdZ62qloF+ggCi+TMzQl8AAIR3H8O7VAeAvnt5hlVVVQ8OIAAAfwB/AFUAVVVVAIJ9WQAAAP39/QCT4OYhKRsXGP71ARAJEfnrAAGR3SMaGuUbIywnF/7zLwOIzhknMP70T/72b+3n6OrYAisnKE5HEwd3s9THBBY3Sv33jpGHDG9nEEtHSLOoCDo0FdfW1sjHx8a5Bjk1NamnqAtllYmHiKaaCVlWVmtoaBJJaLi2t+QUHFtTEpiWlv35rBBUeEI8FGNbEXl2dk4ZHBsWFg1bhYR6DRocIrAeJBsWFxwXGJAcIRkYF9UgJxwXGBwXF3tyDpySCxsWF+pGTRRCW/fY2e5nbfjIyvGHi2kbHr2xBwltosceJt3RBOgzOvWmqva3ue90efOVmWBdXHgbIOtUWkE8Pek8Q+MNFvfrKiMeIIB9fTYAAOxcYvz7yvB9ghowPCALBKCengAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACmlEQwAAACAdFJOUwz//////////////////////wL/////A/8CAgMD/wD////+/////////////////////////////////////////////////////////////y//////UM//Ev+wjv//b/////////////////////////////////8F////////3ynxGAAAZfhJREFUeNrtvYl/GleyNoydjLMns9z7vt9qyc2Bpg0ZoIHLviMkFECWkBfZlmTJi2RZ3p14SWL/629VndP7abpbkp3M3NszP8dGiO5+qK56ao9d/PMdb2PW37di8L+t9fX1a3js7u7Sf+Hf61tbW/BT22/9Ce8k9ie7HON6Ygjo7u3bt25dV/yO69dv3b69i1ibKMf+B935l0Ko3roOoKpKmAPfBTAjyuJz3v4PurKD46qc6FAR41u3DYj/B10nsrskr6c/rv+JIP4zoLt17fYt5WyP67evbf0Puhe3QGZdj7iq2v4Kx5UrDx48v+E8nj9/cOXKFfqx7Re9CG/990Q3Rsheu31dCixCegUQvfrw5qV5x82HV6/e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";
const LOGO_MEDIACENTER_B64 = "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";

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

  const table = `
    <w:tbl>
      <w:tblPr>${borders}<w:tblW w:w="${W_NO + W_NAMA + W_KELAS + W_TTD}" w:type="dxa"/></w:tblPr>
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
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="80" w:after="140"/></w:pPr></w:p>`,
    docxParagraph("DAFTAR HADIR EKSTRAKURIKULER", { bold: true, size: 26 }),
    `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr></w:p>`,
    docxInfoLine("Nama Ekskul", "Media Center X Kepenulisan"),
    docxInfoLine("Hari/Tanggal", `${hariIndoJS(tanggal)}, ${tanggalLabelJS(tanggal)}`),
    docxInfoLine("Pembina", PEMBINA_NAME),
    docxInfoLineBlank("Pemateri"),        // diisi manual pakai pensil setelah dicetak
    docxInfoLineBlank("Materi/Kegiatan"), // baris kosong bergaris untuk ditulis tangan pakai pensil
    `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr></w:p>`
  ].join("");

  // ---- Heuristik: dorong blok tanda tangan Pembina supaya selalu jatuh di
  // dekat bagian bawah halaman, apa pun jumlah baris kehadirannya. Estimasi
  // kasar dalam twips (1 cm = 567 twips) berdasarkan tinggi rata-rata tiap
  // elemen; tidak pixel-perfect tapi cukup akurat untuk kelas ~10-40 siswa. ----
  const PAGE_USABLE_TWIPS = 16838 - 1134 * 2;   // tinggi A4 dikurangi margin atas+bawah
  const HEADER_FIXED_TWIPS = 4700;              // kop surat + judul + 6 baris info (dikalibrasi dari render nyata)
  const TABLE_HEADER_ROW_TWIPS = 420;
  const DATA_ROW_TWIPS = 720;                   // per baris (dipengaruhi tinggi gambar ttd)
  const FOOTER_BLOCK_TWIPS = 1900;              // blok Mengetahui/Pembina/nama
  const BLANK_LINE_TWIPS = 253;
  const SAFETY_BUFFER_TWIPS = 700;              // margin aman ekstra supaya tidak pernah overflow ke halaman 2
  const MAX_FILLER_LINES = 42;

  const fixedTwips = HEADER_FIXED_TWIPS + TABLE_HEADER_ROW_TWIPS + FOOTER_BLOCK_TWIPS;
  const dataTwips = rows.length * DATA_ROW_TWIPS;
  const remainingTwips = PAGE_USABLE_TWIPS - fixedTwips - dataTwips - SAFETY_BUFFER_TWIPS;
  const fillerLines = Math.max(0, Math.min(MAX_FILLER_LINES, Math.floor(remainingTwips / BLANK_LINE_TWIPS)));
  const fillerXml = "<w:p/>".repeat(fillerLines);

  const footer = [
    fillerXml,
    `<w:p/>`,
    `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Mengetahui,</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Pembina,</w:t></w:r></w:p>`,
    `<w:p/><w:p/><w:p/>`,
    `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${xmlEscape(PEMBINA_NAME)}</w:t></w:r></w:p>`
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
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="90"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r><w:r><w:t xml:space="preserve"> : ${xmlEscape(value)}</w:t></w:r></w:p>`;
}

function docxInfoLineBlank(label) {
  // Label diikuti garis panjang (karakter underscore) untuk diisi manual pakai pensil setelah dicetak.
  // Pakai karakter '_' literal (bukan spasi+underline) supaya PASTI tampak di semua penampil & saat dicetak.
  const blank = "_".repeat(46);
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="90"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r><w:r><w:t xml:space="preserve"> : ${blank}</w:t></w:r></w:p>`;
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
