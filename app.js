// ============================================================
// Mis lecturas — lógica de la app
// ============================================================

const SUBJECT_ORDER = [
  "Antropología",
  "Historia económica internacional",
  "Historia de las ideas políticas",
  "Europa en el siglo XX",
];

const DAY_NAMES = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

const PROJECT_START = "2026-08-17";
const PROJECT_END_HINT = "2026-09-21"; // sólo se usa como valor por defecto del selector

// ---------------- Supabase init ----------------
const { createClient } = supabase;
const sb = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

let READINGS = [];      // cache local de todas las lecturas
let currentView = "today";
let adminSearch = "";
let adminSubjectFilter = "";

// ---------------- Utilidades de fecha ----------------
function todayISO() {
  const d = new Date();
  return isoFromDate(d);
}
function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dateFromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function formatLong(iso) {
  const d = dateFromISO(iso);
  const dayName = DAY_NAMES[d.getDay()];
  return `${dayName} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function nextFridayAfter(iso) {
  const d = dateFromISO(iso);
  // avanzar al menos un día, hasta caer en viernes (5)
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 5);
  return isoFromDate(d);
}
function addDays(iso, n) {
  const d = dateFromISO(iso);
  d.setDate(d.getDate() + n);
  return isoFromDate(d);
}

// ---------------- Carga de datos ----------------
async function loadReadings() {
  const { data, error } = await sb
    .from("readings")
    .select("*")
    .order("scheduled_date", { ascending: true })
    .order("seq", { ascending: true });
  if (error) {
    console.error(error);
    setSyncDot(false);
    return;
  }
  READINGS = data;
  setSyncDot(true);
  renderCurrentView();
}

function setSyncDot(ok) {
  const dot = document.getElementById("sync-dot");
  dot.classList.toggle("is-live", !!ok);
  dot.title = ok ? "Sincronizado" : "Sin conexión con Supabase";
}

// ---------------- Realtime: mantiene todos los dispositivos al día ----------------
function subscribeRealtime() {
  sb.channel("readings-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "readings" }, () => {
      loadReadings();
    })
    .subscribe();
}

// ---------------- Acciones ----------------
async function toggleDone(reading) {
  const newStatus = reading.status === "done" ? "pending" : "done";
  const patch = {
    status: newStatus,
    completed_at: newStatus === "done" ? new Date().toISOString() : null,
  };
  // actualización optimista
  Object.assign(reading, patch);
  renderCurrentView();
  const { error } = await sb.from("readings").update(patch).eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
}

async function postpone(reading) {
  const newDate = nextFridayAfter(reading.scheduled_date);
  reading.scheduled_date = newDate;
  renderCurrentView();
  const { error } = await sb
    .from("readings")
    .update({ scheduled_date: newDate })
    .eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
}

async function updateReadingDate(reading, newDate) {
  if (!newDate || newDate === reading.scheduled_date) return;
  reading.scheduled_date = newDate;
  renderCurrentView();
  const { error } = await sb
    .from("readings")
    .update({ scheduled_date: newDate })
    .eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
}

async function swapDates(dateA, dateB) {
  if (!dateA || !dateB || dateA === dateB) return;
  const idsA = READINGS.filter((r) => r.scheduled_date === dateA).map((r) => r.id);
  const idsB = READINGS.filter((r) => r.scheduled_date === dateB).map((r) => r.id);
  if (idsA.length === 0 && idsB.length === 0) {
    alert("No hay lecturas programadas en ninguna de las dos fechas.");
    return;
  }
  // actualización optimista local
  READINGS.forEach((r) => {
    if (r.scheduled_date === dateA) r.scheduled_date = dateB;
    else if (r.scheduled_date === dateB) r.scheduled_date = dateA;
  });
  renderCurrentView();
  if (idsA.length) await sb.from("readings").update({ scheduled_date: dateB }).in("id", idsA);
  if (idsB.length) await sb.from("readings").update({ scheduled_date: dateA }).in("id", idsB);
  loadReadings();
}

// ---------------- Render: fila de lectura ----------------
function buildReadingRow(reading) {
  const tpl = document.getElementById("tpl-reading-row");
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.subject = reading.subject;
  node.classList.toggle("is-done", reading.status === "done");

  node.querySelector(".reading__subject").textContent = reading.subject;
  node.querySelector(".reading__nro").textContent = `n.º ${reading.nro}`;
  node.querySelector(".reading__title").textContent = reading.title;
  const pagesTxt = reading.partial
    ? `${reading.pages} pág. (texto ya iniciado)`
    : `${reading.pages} pág.`;
  node.querySelector(".reading__pages").textContent = pagesTxt;

  node.querySelector(".btn-tick").addEventListener("click", () => toggleDone(reading));
  node.querySelector(".btn-postpone").addEventListener("click", () => postpone(reading));

  return node;
}

function renderList(container, readings, emptyMsg) {
  container.innerHTML = "";
  if (readings.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = emptyMsg;
    container.appendChild(p);
    return;
  }
  // agrupar por materia, en el orden fijo del programa, dentro del mismo día
  const sorted = [...readings].sort((a, b) => {
    const ai = SUBJECT_ORDER.indexOf(a.subject);
    const bi = SUBJECT_ORDER.indexOf(b.subject);
    if (ai !== bi) return ai - bi;
    return a.seq - b.seq;
  });
  sorted.forEach((r) => container.appendChild(buildReadingRow(r)));
}

// ---------------- Vista: HOY (navegable con flechas) ----------------
let viewedDate = todayISO();

function renderToday() {
  const iso = viewedDate;
  const isToday = iso === todayISO();
  const list = READINGS.filter((r) => r.scheduled_date === iso);

  const label = formatLong(iso) + (isToday ? " · hoy" : "");
  document.getElementById("today-label").textContent = label;

  const done = list.filter((r) => r.status === "done").length;
  const pages = list.reduce((s, r) => s + r.pages, 0);
  document.getElementById("today-sub").textContent =
    list.length === 0
      ? "sin lecturas programadas este día"
      : `${list.length} lectura${list.length===1?"":"s"} · ${pages} páginas · ${done}/${list.length} leídas`;

  document.getElementById("today-jump").hidden = isToday;

  renderList(
    document.getElementById("today-list"),
    list,
    "No hay lecturas programadas para este día."
  );
}

function initTodayNav() {
  // flecha izquierda: días pasados — flecha derecha: días futuros
  document.getElementById("today-next").addEventListener("click", () => {
    viewedDate = addDays(viewedDate, -1);
    renderToday();
  });
  document.getElementById("today-prev").addEventListener("click", () => {
    viewedDate = addDays(viewedDate, 1);
    renderToday();
  });
  document.getElementById("today-jump").addEventListener("click", () => {
    viewedDate = todayISO();
    renderToday();
  });
}

// ---------------- Vista: PROGRESO GLOBAL ----------------
function renderProgress() {
  const totalCount = READINGS.length;
  const doneCount = READINGS.filter((r) => r.status === "done").length;
  const totalPages = READINGS.reduce((s, r) => s + r.pages, 0);
  const donePages = READINGS.filter((r) => r.status === "done").reduce((s, r) => s + r.pages, 0);
  const pct = totalPages ? Math.round((donePages / totalPages) * 100) : 0;

  const totalsEl = document.getElementById("progress-totals");
  totalsEl.innerHTML = "";
  const stats = [
    { value: `${pct}%`, label: "avance (páginas)" },
    { value: `${doneCount}/${totalCount}`, label: "lecturas leídas" },
    { value: `${donePages}/${totalPages}`, label: "páginas leídas" },
  ];
  stats.forEach((s) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<div class="stat__value">${s.value}</div><div class="stat__label">${s.label}</div>`;
    totalsEl.appendChild(div);
  });

  const subjectsEl = document.getElementById("progress-subjects");
  subjectsEl.innerHTML = "";
  const tpl = document.getElementById("tpl-subject-block");

  SUBJECT_ORDER.forEach((subject) => {
    const items = READINGS.filter((r) => r.subject === subject).sort((a, b) => a.seq - b.seq);
    if (items.length === 0) return;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = subject;
    const sDone = items.filter((r) => r.status === "done").length;
    const sPagesTotal = items.reduce((s, r) => s + r.pages, 0);
    const sPagesDone = items.filter((r) => r.status === "done").reduce((s, r) => s + r.pages, 0);
    node.querySelector(".stat-count").textContent = `${sDone}/${items.length} lecturas`;
    node.querySelector(".stat-pages").textContent = `${sPagesDone}/${sPagesTotal} pág.`;
    const fillPct = sPagesTotal ? (sPagesDone / sPagesTotal) * 100 : 0;
    node.querySelector(".subject-block__bar-fill").style.width = fillPct + "%";

    const grid = node.querySelector(".subject-block__grid");
    items.forEach((r) => {
      const tile = document.createElement("div");
      tile.className = "tile" + (r.status === "done" ? " is-done" : "");
      tile.dataset.tip = `n.º ${r.nro} · ${r.title} (${r.pages}p) · ${formatLong(r.scheduled_date)}`;
      tile.addEventListener("click", () => toggleDone(r));
      grid.appendChild(tile);
    });

    subjectsEl.appendChild(node);
  });
}

// ---------------- Vista: ADMINISTRAR ----------------
function renderAdmin() {
  const container = document.getElementById("admin-table");
  const q = adminSearch.trim().toLowerCase();
  let items = [...READINGS];
  if (adminSubjectFilter) items = items.filter((r) => r.subject === adminSubjectFilter);
  if (q) items = items.filter((r) => r.title.toLowerCase().includes(q));
  items.sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1;
    const ai = SUBJECT_ORDER.indexOf(a.subject);
    const bi = SUBJECT_ORDER.indexOf(b.subject);
    if (ai !== bi) return ai - bi;
    return a.seq - b.seq;
  });

  container.innerHTML = "";
  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Ninguna lectura coincide con el filtro.";
    container.appendChild(p);
    return;
  }

  const tpl = document.getElementById("tpl-admin-row");
  items.forEach((r) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.subject = r.subject;
    node.classList.toggle("is-done", r.status === "done");

    const dateInput = node.querySelector(".admin-row__date");
    dateInput.value = r.scheduled_date;
    dateInput.addEventListener("change", () => {
      updateReadingDate(r, dateInput.value);
      node.classList.add("is-flash");
      setTimeout(() => node.classList.remove("is-flash"), 600);
    });

    node.querySelector(".admin-row__subject").textContent = r.subject;
    node.querySelector(".admin-row__nro").textContent = `n.º ${r.nro}`;
    node.querySelector(".admin-row__title").textContent = r.title;
    node.querySelector(".admin-row__pages").textContent = `${r.pages}p`;
    node.querySelector(".admin-row__status").addEventListener("click", () => toggleDone(r));

    container.appendChild(node);
  });
}

function populateAdminSubjectFilter() {
  const select = document.getElementById("admin-subject-filter");
  SUBJECT_ORDER.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    adminSubjectFilter = select.value;
    renderAdmin();
  });
}

function initAdminControls() {
  populateAdminSubjectFilter();
  document.getElementById("admin-search").addEventListener("input", (e) => {
    adminSearch = e.target.value;
    renderAdmin();
  });
  document.getElementById("swap-btn").addEventListener("click", () => {
    const a = document.getElementById("swap-date-a").value;
    const b = document.getElementById("swap-date-b").value;
    if (!a || !b) { alert("Elegí las dos fechas a intercambiar."); return; }
    if (confirm(`¿Intercambiar todas las lecturas entre ${formatLong(a)} y ${formatLong(b)}?`)) {
      swapDates(a, b);
    }
  });
}

// ---------------- Router de vistas ----------------
function renderCurrentView() {
  if (currentView === "today") renderToday();
  else if (currentView === "progress") renderProgress();
  else if (currentView === "admin") renderAdmin();
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("is-active", t.dataset.view === view)
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("is-active", v.id === `view-${view}`)
  );
  renderCurrentView();
}

// ---------------- Reloj del encabezado ----------------
function tickClock() {
  const el = document.getElementById("masthead-clock");
  const iso = todayISO();
  el.textContent = formatLong(iso);
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
  initTodayNav();
  initAdminControls();
  tickClock();
  loadReadings();
  subscribeRealtime();
});
