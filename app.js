/* =========================================================
   KONFIGURASI — ganti URL ini setelah deploy Apps Script
   ========================================================= */
const API_URL = "https://script.google.com/macros/s/AKfycbydQI_Wwu1b_Sja0kqgdPWyOfGKK_6ZD3dAD0U9HmQ6TLU6kQbUjrukftW29h8i_kQsag/exec";

/* =========================================================
   UTIL
   ========================================================= */
const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const nav = $("#nav");

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(action, payload = {}) {
  const body = { action, ...payload };
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Gagal");
  return data;
}

function getDeviceId() {
  let id = localStorage.getItem("mcx_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("mcx_device_id", id);
  }
  return id;
}

function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function sessionToken() { return sessionStorage.getItem("mcx_token") || ""; }
function sessionRole() { return sessionStorage.getItem("mcx_role") || ""; }

/* =========================================================
   ROUTING
   ========================================================= */
function route() {
  const hash = location.hash || "#home";
  nav.innerHTML = "";

  if (hash === "#home") return viewHome();
  if (hash === "#admin") return viewAdminLogin();
  if (hash === "#petugas") return viewPetugasLogin();
  if (hash === "#dashboard") return viewDashboard();
  if (hash.startsWith("#s/")) return viewMember(hash.slice(3));

  viewHome();
}
window.addEventListener("hashchange", route);

/* =========================================================
   NAV HELPER
   ========================================================= */
function renderNav(role) {
  nav.innerHTML = "";
  const home = document.createElement("a");
  home.href = "#home"; home.textContent = "Beranda";
  nav.appendChild(home);

  if (role === "admin" || role === "petugas") {
    const dash = document.createElement("a");
    dash.href = "#dashboard"; dash.textContent = "Dashboard";
    nav.appendChild(dash);
    const out = document.createElement("button");
    out.textContent = "Keluar";
    out.onclick = () => {
      sessionStorage.clear();
      toast("Sesi berakhir");
      location.hash = "#home";
    };
    nav.appendChild(out);
  } else {
    const adm = document.createElement("a");
    adm.href = "#admin"; adm.textContent = "Admin";
    const pet = document.createElement("a");
    pet.href = "#petugas"; pet.textContent = "Petugas";
    nav.appendChild(adm); nav.appendChild(pet);
  }
}

/* =========================================================
   HOME
   ========================================================= */
function viewHome() {
  renderNav();
  app.innerHTML = `
    <div style="text-align:center; padding:40px 0;">
      <h2 style="font-size:28px;">Absensi Ekstrakurikular</h2>
      <p class="lead">Media Center X Kepenulisan</p>
      <p>Scan QR dari Petugas/Admin untuk melakukan presensi.</p>
      <div style="margin-top:24px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
        <a href="#admin" class="ghost" style="padding:9px 16px; border:1px solid var(--line); border-radius:var(--radius); text-decoration:none; color:var(--ink);">Login Admin</a>
        <a href="#petugas" class="ghost" style="padding:9px 16px; border:1px solid var(--line); border-radius:var(--radius); text-decoration:none; color:var(--ink);">Login Petugas</a>
      </div>
    </div>
  `;
}

/* =========================================================
   LOGIN ADMIN / PETUGAS
   ========================================================= */
function loginView(role) {
  renderNav();
  const title = role === "admin" ? "Login Admin" : "Login Petugas";
  app.innerHTML = `
    <div class="card" style="max-width:400px; margin:40px auto;">
      <h2>${title}</h2>
      <p class="lead">Masukkan password untuk melanjutkan.</p>
      <form id="loginForm">
        <label>Password</label>
        <input type="password" id="pwd" autocomplete="current-password" required />
        <button class="primary" type="submit" style="width:100%;">Masuk</button>
      </form>
    </div>
  `;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const pwd = $("#pwd").value;
    try {
      const res = await api("login", { role, password: pwd });
      sessionStorage.setItem("mcx_token", res.token);
      sessionStorage.setItem("mcx_role", role);
      toast("Berhasil masuk");
      location.hash = "#dashboard";
    } catch (err) {
      toast(err.message, true);
    }
  };
}
function viewAdminLogin() { loginView("admin"); }
function viewPetugasLogin() { loginView("petugas"); }

/* =========================================================
   DASHBOARD
   ========================================================= */
async function viewDashboard() {
  const role = sessionRole();
  const token = sessionToken();
  if (!token) { location.hash = "#home"; return; }
  renderNav(role);

  app.innerHTML = `<div class="empty">Memuat…</div>`;

  try {
    const data = await api("dashboard", { token, role });
    renderDashboard(data, role);
  } catch (err) {
    toast(err.message, true);
    if (err.message.includes("token") || err.message.includes("Otorisasi")) {
      sessionStorage.clear();
      location.hash = "#home";
    }
  }
}

function renderDashboard(data, role) {
  const session = data.session;
  const today = data.today;
  const history = data.history;

  const sessionCard = session
    ? `
      <div class="card">
        <div class="flex-between">
          <div>
            <h3 style="margin:0;">Sesi Aktif</h3>
            <small style="color:var(--muted);">ID: ${session.session_id}</small>
          </div>
          <span class="status-pill open">BUKA</span>
        </div>
        <div class="countdown" id="countdown">--:--</div>
        <div class="qr-wrap"><div id="qr"></div></div>
        <p style="text-align:center; font-size:12px; color:var(--muted); margin-top:8px;">
          Scan QR di atas untuk presensi
        </p>
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
          <button class="danger" id="closeSession">Tutup Sesi</button>
        </div>
      </div>`
    : `
      <div class="card">
        <div class="flex-between">
          <div>
            <h3 style="margin:0;">Sesi Presensi</h3>
            <small style="color:var(--muted);">Belum ada sesi aktif</small>
          </div>
          <span class="status-pill closed">TUTUP</span>
        </div>
        <button class="primary" id="openSession" style="margin-top:12px;">Buka Sesi Presensi (5 menit)</button>
      </div>`;

  const todayList = today.length
    ? `
      <table>
        <thead><tr>
          <th>Waktu</th><th>Nama</th><th>Kelas</th>
          ${role === "admin" ? "<th>Aksi</th>" : ""}
        </tr></thead>
        <tbody>
          ${today.map((r, i) => `
            <tr>
              <td>${fmtTime(r.waktu)}</td>
              <td>${r.nama}</td>
              <td>${r.tingkat}-${r.rombel}</td>
              ${role === "admin" ? `<td><button class="danger" data-del="${r.row_index}">Hapus</button></td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>`
    : `<div class="empty">Belum ada yang hadir hari ini.</div>`;

  const historyHtml = history.length
    ? history.map(day => `
        <div class="card">
          <div class="flex-between">
            <h3 style="margin:0;">Pertemuan — ${fmtDateShort(day.tanggal).toUpperCase()}</h3>
            <button class="ghost" data-export="${day.tanggal}">Export DOCX</button>
          </div>
          <table style="margin-top:12px;">
            <thead><tr><th>Waktu</th><th>Nama</th><th>Kelas</th></tr></thead>
            <tbody>
              ${day.records.map(r => `
                <tr>
                  <td>${fmtTime(r.waktu)}</td>
                  <td>${r.nama}</td>
                  <td>${r.tingkat}-${r.rombel}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `).join("")
    : `<div class="empty">Belum ada riwayat pertemuan.</div>`;

  app.innerHTML = `
    <div class="flex-between" style="margin-bottom:16px;">
      <div>
        <h2>Dashboard</h2>
        <p class="lead" style="margin:0;">Login sebagai <strong>${role.toUpperCase()}</strong></p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="ghost" id="refresh">↻ Segarkan</button>
        <button class="ghost" data-export="${new Date().toISOString().slice(0,10)}">Export Hari Ini</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="stat"><span class="num">${today.length}</span><span class="lbl">Hadir hari ini</span></div>
      <div class="stat"><span class="num">${session ? "AKTIF" : "TIDAK AKTIF"}</span><span class="lbl">Status sesi</span></div>
    </div>

    ${sessionCard}

    <h3>Hari Ini — ${fmtDateShort(new Date().toISOString()).toUpperCase()}</h3>
    <div class="card">${todayList}</div>

    <h3>Riwayat Pertemuan</h3>
    ${historyHtml}
  `;

  // Bind events
  const openBtn = $("#openSession");
  if (openBtn) openBtn.onclick = openSession;
  const closeBtn = $("#closeSession");
  if (closeBtn) closeBtn.onclick = closeSession;
  $("#refresh").onclick = () => viewDashboard();

  document.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Hapus data kehadiran ini?")) return;
      try {
        await api("deleteAttendance", { token, role, rowIndex: parseInt(b.dataset.del) });
        toast("Data dihapus");
        viewDashboard();
      } catch (err) { toast(err.message, true); }
    };
  });

  document.querySelectorAll("[data-export]").forEach(b => {
    b.onclick = () => exportDocx(b.dataset.export);
  });

  // Render QR + countdown
  if (session) {
    const url = `${location.origin}${location.pathname}#s/${session.session_id}`;
    new QRCode(document.getElementById("qr"), {
      text: url, width: 220, height: 220,
      colorDark: "#2a2a2a", colorLight: "#ffffff",
    });
    startCountdown(session.expires_at);
  }
}

let countdownTimer = null;
function startCountdown(expiresAt) {
  if (countdownTimer) clearInterval(countdownTimer);
  const el = $("#countdown");
  if (!el) return;
  const tick = () => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      el.textContent = "00:00";
      clearInterval(countdownTimer);
      toast("Sesi berakhir");
      setTimeout(viewDashboard, 1500);
      return;
    }
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function openSession() {
  try {
    await api("openSession", { token: sessionToken(), role: sessionRole() });
    toast("Sesi dibuka");
    viewDashboard();
  } catch (err) { toast(err.message, true); }
}
async function closeSession() {
  if (!confirm("Tutup sesi presensi?")) return;
  try {
    await api("closeSession", { token: sessionToken(), role: sessionRole() });
    toast("Sesi ditutup");
    viewDashboard();
  } catch (err) { toast(err.message, true); }
}

/* =========================================================
   ANGGOTA — SCAN QR
   ========================================================= */
async function viewMember(sessionId) {
  renderNav();
  app.innerHTML = `<div class="empty">Memeriksa sesi…</div>`;

  try {
    const res = await api("checkSession", { session_id: sessionId });
    if (!res.valid) {
      app.innerHTML = `
        <div class="card" style="text-align:center; padding:40px 20px;">
          <h2>Sesi Tidak Valid</h2>
          <p class="lead">Sesi presensi ini sudah berakhir atau ditutup.</p>
          <a href="#home" class="ghost" style="padding:9px 16px; border:1px solid var(--line); border-radius:var(--radius); text-decoration:none; color:var(--ink);">Kembali</a>
        </div>`;
      return;
    }
    renderMemberForm(sessionId);
  } catch (err) {
    app.innerHTML = `
      <div class="card" style="text-align:center;">
        <h2>Gagal Memuat</h2>
        <p class="lead">${err.message}</p>
      </div>`;
  }
}

function renderMemberForm(sessionId) {
  app.innerHTML = `
    <div class="card" style="max-width:520px; margin:20px auto;">
      <h2>Form Kehadiran</h2>
      <p class="lead">Isi data diri Anda dengan benar.</p>

      <div class="notice">
        <strong>WAJIB MASUKKAN NAMA LENGKAP, TANPA SINGKATAN.</strong><br/>
        Contoh: <code>RADEN PRATAMA</code>, bukan <code>RADEN P.</code> atau nama panggilan.
      </div>

      <form id="attendForm">
        <label>Nama Lengkap</label>
        <input type="text" id="nama" required autocomplete="off" placeholder="RADEN PRATAMA" />

        <div class="grid-2">
          <div>
            <label>Tingkat</label>
            <select id="tingkat" required>
              <option value="">Pilih…</option>
              <option>X</option><option>XI</option><option>XII</option>
            </select>
          </div>
          <div>
            <label>Rombel</label>
            <select id="rombel" required>
              <option value="">Pilih…</option>
              ${"ABCDEFGHIJ".split("").map(l => `<option>${l}</option>`).join("")}
            </select>
          </div>
        </div>

        <button class="primary" type="submit" style="width:100%; margin-top:8px;">HADIR</button>
      </form>
    </div>
  `;

  $("#attendForm").onsubmit = async (e) => {
    e.preventDefault();
    const nama = $("#nama").value.trim().toUpperCase();
    const tingkat = $("#tingkat").value;
    const rombel = $("#rombel").value;

    if (nama.length < 3 || /\./.test(nama)) {
      toast("Gunakan nama lengkap tanpa singkatan", true);
      return;
    }

    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Mengirim…";

    try {
      await api("submitAttendance", {
        session_id: sessionId,
        device_id: getDeviceId(),
        nama, tingkat, rombel,
      });
      renderMemberSuccess(nama, tingkat, rombel);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = "HADIR";
    }
  };
}

function renderMemberSuccess(nama, tingkat, rombel) {
  app.innerHTML = `
    <div class="card success-box" style="max-width:520px; margin:20px auto;">
      <div class="check">✓</div>
      <h2>Terima Kasih</h2>
      <p class="lead">Kehadiran Anda telah tercatat.</p>
      <div style="text-align:left; background:var(--bg); padding:14px; border-radius:var(--radius); margin-top:16px;">
        <div><small style="color:var(--muted);">Nama</small><br/><strong>${nama}</strong></div>
        <div style="margin-top:8px;"><small style="color:var(--muted);">Kelas</small><br/><strong>${tingkat}-${rombel}</strong></div>
        <div style="margin-top:8px;"><small style="color:var(--muted);">Waktu</small><br/><strong>${new Date().toLocaleTimeString("id-ID")}</strong></div>
      </div>
    </div>
  `;
}

/* =========================================================
   EXPORT DOCX
   ========================================================= */
async function exportDocx(dateStr) {
  try {
    const res = await api("getMeeting", { token: sessionToken(), role: sessionRole(), tanggal: dateStr });
    const records = res.records;
    if (!records.length) { toast("Tidak ada data untuk tanggal ini", true); return; }

    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
            WidthType, AlignmentType, BorderStyle } = docx;

    const rows = [
      new TableRow({
        children: ["No", "Nama Lengkap", "Kelas", "Waktu", "Tanda Tangan"].map(t =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 22 })] })],
            width: { size: t === "Nama Lengkap" ? 4000 : t === "Tanda Tangan" ? 2500 : 1200, type: WidthType.DXA },
          })
        ),
      }),
      ...records.map((r, i) =>
        new TableRow({
          children: [
            String(i + 1),
            r.nama,
            `${r.tingkat}-${r.rombel}`,
            fmtTime(r.waktu),
            "",
          ].map(t =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: t, size: 22 })] })],
            })
          ),
        })
      ),
    ];

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: "MEDIA CENTER X KEPENULISAN", bold: true, size: 28 }),
          ]}),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [
            new TextRun({ text: "DAFTAR KEHADIRAN", bold: true, size: 26 }),
          ]}),
          new Paragraph({ children: [new TextRun({ text: `Pertemuan: ${fmtDateShort(dateStr)}`, size: 22 })] }),
          new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: `Tanggal: ${fmtDate(dateStr)}`, size: 22 })] }),
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          new Paragraph({ spacing: { before: 600 }, children: [new TextRun({ text: "Mengetahui,", size: 22 })] }),
          new Paragraph({ spacing: { before: 1200 }, children: [new TextRun({ text: "Guru Pembina", size: 22 })] }),
          new Paragraph({ spacing: { before: 600 }, children: [
            new TextRun({ text: "________________________", size: 22 }),
          ]}),
          new Paragraph({ children: [new TextRun({ text: "Nama / Tanda Tangan", size: 22 })] }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Kehadiran_${dateStr}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    toast("File DOCX diunduh");
  } catch (err) {
    toast(err.message, true);
  }
}

/* =========================================================
   INIT
   ========================================================= */
route();
