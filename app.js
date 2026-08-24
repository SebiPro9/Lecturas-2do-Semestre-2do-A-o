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
  Object.assign(reading, patch);
  renderCurrentView();
  if (newStatus === "done") {
    showToast("¡Leída! 🌿", "done");
  }
  const { error } = await sb.from("readings").update(patch).eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
}

async function moveReading(reading, newDate, originEl) {
  if (!newDate || newDate === reading.scheduled_date) return;
  const isAdvance = newDate < reading.original_date;
  const isPostpone = newDate > reading.scheduled_date;
  reading.scheduled_date = newDate;
  renderCurrentView();

  if (isAdvance) {
    showToast("¡Vas adelantado! 🌱", "advance");
    if (originEl) burstConfetti(originEl, ["#E0A736", "#2E6B4C", "#8A9A2E"]);
  } else if (isPostpone) {
    showToast("Reprogramado. Sin drama.", "postpone");
  } else {
    showToast("Movido.", "postpone");
  }

  const { error } = await sb
    .from("readings")
    .update({ scheduled_date: newDate })
    .eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
}

async function updateReadingDate(reading, newDate) {
  // usado desde Administrar: cambio directo, sin popover ni celebracion grande
  if (!newDate || newDate === reading.scheduled_date) return;
  const isAdvance = newDate < reading.original_date;
  reading.scheduled_date = newDate;
  renderCurrentView();
  if (isAdvance) showToast("¡Vas adelantado! 🌱", "advance");
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

// ---------------- Efectos: confetti y toasts ----------------
function burstConfetti(originEl, colors) {
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const wrap = document.createElement("div");
  wrap.className = "confetti-burst";
  wrap.style.left = cx + "px";
  wrap.style.top = cy + "px";
  const n = 16;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    p.style.setProperty("--rot", Math.round(Math.random() * 360) + "deg");
    p.style.background = colors[i % colors.length];
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 950);
}

let toastTimer = null;
function showToast(text, kind) {
  let el = document.getElementById("app-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "app-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
}

// ---------------- Popover de fecha ----------------
function closeAllDatePopovers(except) {
  document.querySelectorAll(".date-popover.is-open").forEach((p) => {
    if (p !== except) p.classList.remove("is-open");
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".reading__actions")) closeAllDatePopovers(null);
});

function wireDatePopover(node, reading) {
  const btn = node.querySelector(".btn-date");
  const pop = node.querySelector(".date-popover");
  const input = node.querySelector(".date-popover__input");
  input.value = reading.scheduled_date;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !pop.classList.contains("is-open");
    closeAllDatePopovers(pop);
    pop.classList.toggle("is-open", willOpen);
  });

  node.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const quick = chip.dataset.quick;
      let d;
      if (quick === "hoy") d = todayISO();
      else if (quick === "manana") d = addDays(todayISO(), 1);
      else if (quick === "viernes") d = nextFridayAfter(reading.scheduled_date);
      input.value = d;
    });
  });

  node.querySelector(".date-popover__apply").addEventListener("click", (e) => {
    e.stopPropagation();
    moveReading(reading, input.value, btn);
    pop.classList.remove("is-open");
  });
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

  node.querySelector(".btn-tick").addEventListener("click", (e) => {
    if (reading.status !== "done") burstConfetti(e.currentTarget, [
      getComputedStyle(document.documentElement).getPropertyValue("--" + subjectColorVar(reading.subject)).trim() || "#2E6B4C",
      "#E0A736", "#8FB2AE"
    ]);
    toggleDone(reading);
  });
  wireDatePopover(node, reading);

  return node;
}

function subjectColorVar(subject) {
  if (subject === "Antropología") return "antro";
  if (subject === "Historia económica internacional") return "econ";
  if (subject === "Historia de las ideas políticas") return "ideas";
  return "europa";
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
  const subEl = document.getElementById("today-sub");

  if (list.length === 0) {
    subEl.textContent = isToday ? "nada programado por ahora" : "sin lecturas programadas este día";
  } else if (isToday) {
    // en Hoy no lideramos con el total de páginas: se ve, pero no es lo primero que pesa
    if (done === list.length) {
      subEl.textContent = `listo — ${list.length} de ${list.length} hecha${list.length===1?"":"s"}`;
    } else {
      const restantes = list.length - done;
      subEl.textContent = `${restantes} lectura${restantes===1?"":"s"} por hacer hoy, nada más`;
    }
  } else {
    // en otros días (planificación) sí mostramos el detalle completo
    subEl.textContent = `${list.length} lectura${list.length===1?"":"s"} · ${pages} páginas · ${done}/${list.length} leídas`;
  }

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

// ============================================================
// CENTRO DE RELAJACIÓN — lógica de TIERRA
// Guarda todo en la tabla "checkins" (Supabase), separado de
// las lecturas: esto no administra el atraso académico, sólo
// la relación con él.
// ============================================================

let CHECKINS = [];
let favoritePhrases = new Set();
let selectedEstado = null;

const NO_EMERGENCIA_PHRASES = [
  "Estoy atrasado. No estoy en peligro.",
  "No necesito recuperar todo ahora.",
  "No tengo que sentirme motivado para empezar.",
  "Puedo hacer poco.",
  "Puedo descansar sin escapar.",
  "Puedo estar incómodo sin huir.",
  "El celular me ofrece alivio, no solución.",
  "El hecho de que algo sea importante no significa que deba resolverlo inmediatamente.",
  "Mañana no necesita ser perfecto. Necesita ser habitable.",
];

async function loadCheckins() {
  const since = addDays(todayISO(), -30);
  const { data, error } = await sb
    .from("checkins")
    .select("*")
    .gte("created_at", since + "T00:00:00")
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  CHECKINS = data || [];
  const favRow = CHECKINS.find((c) => c.kind === "favoritos");
  favoritePhrases = new Set(favRow?.payload?.phrases || []);
  if (currentView === "relax") renderRelax();
}

async function logCheckin(kind, payload) {
  const row = { kind, payload: payload || {} };
  CHECKINS.unshift({ ...row, created_at: new Date().toISOString() });
  if (currentView === "relax") renderRelax();
  const { error } = await sb.from("checkins").insert(row);
  if (error) console.error(error);
}

function startOfWeekISO() {
  const d = dateFromISO(todayISO());
  const day = d.getDay(); // 0 domingo
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return isoFromDate(d);
}

function renderRelax() {
  const todayIso = todayISO();
  const weekStart = startOfWeekISO();

  const retornosHoy = CHECKINS.filter(
    (c) => c.kind === "retorno" && c.created_at.slice(0, 10) === todayIso
  ).length;
  const retornosSemana = CHECKINS.filter(
    (c) => c.kind === "retorno" && c.created_at.slice(0, 10) >= weekStart
  ).length;
  document.getElementById("retornos-hoy").textContent = retornosHoy;
  document.getElementById("retornos-semana").textContent = retornosSemana;

  // tira de la semana: hoja si hubo retorno ese día, circulo vacio si no
  const weekEl = document.getElementById("tierra-week");
  weekEl.innerHTML = "";
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(todayIso, -i);
    const hasReturn = CHECKINS.some((c) => c.kind === "retorno" && c.created_at.slice(0, 10) === iso);
    const wrap = document.createElement("div");
    wrap.className = "tierra-week__day";
    const label = document.createElement("div");
    label.className = "tierra-week__label";
    label.textContent = DAY_NAMES[dateFromISO(iso).getDay()].slice(0, 2);
    wrap.appendChild(iconLeafOrCircle(hasReturn));
    wrap.appendChild(label);
    weekEl.appendChild(wrap);
  }

  // frases "no es una emergencia"
  const phrasesEl = document.getElementById("tierra-phrases");
  phrasesEl.innerHTML = "";
  NO_EMERGENCIA_PHRASES.forEach((text) => {
    const row = document.createElement("div");
    row.className = "tierra-phrase";
    const span = document.createElement("span");
    span.textContent = text;
    const star = document.createElement("button");
    star.className = "tierra-phrase__star" + (favoritePhrases.has(text) ? " is-fav" : "");
    star.textContent = favoritePhrases.has(text) ? "★" : "☆";
    star.addEventListener("click", () => toggleFavoritePhrase(text));
    row.appendChild(span);
    row.appendChild(star);
    phrasesEl.appendChild(row);
  });

  document.querySelectorAll(".tierra-state-btn").forEach((b) => {
    b.classList.toggle("is-selected", b.dataset.estado === selectedEstado);
  });
}

function iconLeafOrCircle(filled) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "leaf-icon");
  if (filled) {
    svg.innerHTML = `<path d="M4 20c8-1 14-7 15-15C11 6 5 12 4 20Z" fill="#6B7F5E"/>`;
  } else {
    svg.innerHTML = `<circle cx="12" cy="12" r="7" fill="none" stroke="#C9C3B2" stroke-width="1.5"/>`;
  }
  return svg;
}

function toggleFavoritePhrase(text) {
  if (favoritePhrases.has(text)) favoritePhrases.delete(text);
  else favoritePhrases.add(text);
  renderRelax();
  logCheckin("favoritos", { phrases: Array.from(favoritePhrases) });
}

function initRelaxControls() {
  document.querySelectorAll(".tierra-state-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedEstado = btn.dataset.estado;
      renderRelax();
      logCheckin("estado", { estado: selectedEstado });
    });
  });

  document.getElementById("btn-volver-tierra").addEventListener("click", openRitual);
  document.getElementById("btn-registrar-retorno").addEventListener("click", openRetornoManual);
  document.getElementById("retorno-close").addEventListener("click", closeRetornoManual);
  document.querySelectorAll("#retorno-options .ritual-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      logCheckin("retorno", { tipo: chip.textContent });
      showToast("Volviste. Eso ya es todo. 🌿", "advance");
      closeRetornoManual();
    });
  });

  // --- ritual VOLVER A TIERRA ---
  const overlay = document.getElementById("ritual-overlay");
  document.getElementById("ritual-close").addEventListener("click", closeRitual);
  overlay.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => ritualGoToStep(currentRitualStep() + 1));
  });
  overlay.querySelectorAll("#ritual-body-options .ritual-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      overlay.querySelectorAll("#ritual-body-options .ritual-chip").forEach((c) => c.classList.remove("is-selected"));
      chip.classList.add("is-selected");
    });
  });
  document.querySelector("[data-finish-yes]").addEventListener("click", () => {
    finishRitual(true);
  });
  document.querySelector("[data-finish-no]").addEventListener("click", () => {
    finishRitual(false);
  });
  document.getElementById("ritual-done-btn").addEventListener("click", closeRitual);
}

function currentRitualStep() {
  const active = document.querySelector(".ritual-step.is-active");
  return active ? Number(active.dataset.step) : 1;
}
function ritualGoToStep(n) {
  document.querySelectorAll(".ritual-step").forEach((s) => {
    s.classList.toggle("is-active", Number(s.dataset.step) === n);
  });
}
function openRitual() {
  ritualGoToStep(1);
  document.getElementById("ritual-nombrar").value = "";
  document.getElementById("ritual-overlay").classList.add("is-open");
}
function closeRitual() {
  document.getElementById("ritual-overlay").classList.remove("is-open");
}
function finishRitual(permitted) {
  const nombrar = document.getElementById("ritual-nombrar").value.trim();
  if (nombrar) logCheckin("nombrar", { texto: nombrar, permitido: permitted });
  logCheckin("retorno", { tipo: "ritual volver a tierra" });
  ritualGoToStep(5);
  if (!permitted) {
    // igual mostramos el cierre calido, sin marcar esto como un "no" fallido
    document.querySelector('[data-step="5"] .ritual-text').textContent = "Está bien. No hace falta conseguir calma. Ya volviste.";
  } else {
    document.querySelector('[data-step="5"] .ritual-text').textContent = "Ya estás acá.";
  }
}
function openRetornoManual() {
  document.getElementById("retorno-overlay").classList.add("is-open");
}
function closeRetornoManual() {
  document.getElementById("retorno-overlay").classList.remove("is-open");
}

// ---------------- Router de vistas ----------------
function renderCurrentView() {
  if (currentView === "today") renderToday();
  else if (currentView === "progress") renderProgress();
  else if (currentView === "admin") renderAdmin();
  else if (currentView === "relax") renderRelax();
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
  initRelaxControls();
  tickClock();
  loadReadings();
  loadCheckins();
  subscribeRealtime();
});
