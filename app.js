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
    const contentBytes = strToBytes(f.content);
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
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr>${b}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function buildDocumentXml(tanggal, rows) {
  const borders = `
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="000000"/>
      <w:left w:val="single" w:sz="4" w:color="000000"/>
      <w:bottom w:val="single" w:sz="4" w:color="000000"/>
      <w:right w:val="single" w:sz="4" w:color="000000"/>
      <w:insideH w:val="single" w:sz="4" w:color="000000"/>
      <w:insideV w:val="single" w:sz="4" w:color="000000"/>
    </w:tblBorders>`;

  const headerRow = `<w:tr>${docxCell("No", { bold: true, width: 900, center: true })}${docxCell("Nama Lengkap", { bold: true, width: 7500 })}</w:tr>`;

  const bodyRows = rows.length === 0
    ? `<w:tr>${docxCell("", { width: 900, center: true })}${docxCell("(Tidak ada data kehadiran)", { width: 7500 })}</w:tr>`
    : rows.map((r, idx) => `<w:tr>${docxCell(String(idx + 1), { width: 900, center: true })}${docxCell(r.nama, { width: 7500 })}</w:tr>`).join("");

  const table = `
    <w:tbl>
      <w:tblPr>${borders}<w:tblW w:w="8400" w:type="dxa"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="7500"/></w:tblGrid>
      ${headerRow}
      ${bodyRows}
    </w:tbl>`;

  const header = [
    docxParagraph("PEMERINTAH DAERAH PROVINSI JAWA TIMUR", { bold: true, size: 24 }),
    docxParagraph("DINAS PENDIDIKAN", { bold: true, size: 24 }),
    docxParagraph("SMA NEGERI 1 LUMAJANG", { bold: true, size: 28 }),
    docxParagraph("Jl. Jendral Ahmad Yani No.07 Telp./Fax (0334) 881747. Lumajang 67316", { size: 18 }),
    docxParagraph("Website : www.sman1lmj.sch.id   e-mail : smanegerisatulumajang@gmail.com", { size: 18 }),
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr></w:pPr></w:p>`,
    docxParagraph("DAFTAR HADIR MEDIA CENTER", { bold: true, size: 26 }),
    `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t xml:space="preserve">Hari/Tanggal : ${xmlEscape(hariIndoJS(tanggal) + ", " + tanggalLabelJS(tanggal))}</w:t></w:r></w:p>`,
    `<w:p/>`
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${header}
    ${table}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
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
    const files = [
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "_rels/.rels", content: RELS_XML },
      { name: "word/document.xml", content: buildDocumentXml(tanggal, rows) }
    ];
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
