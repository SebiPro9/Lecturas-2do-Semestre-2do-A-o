// ============================================================
// Mis lecturas + ejercicio — lógica de la app
// ============================================================

const SUBJECT_ORDER = [
  "Antropología",
  "Historia económica internacional",
  "Historia de las ideas políticas",
  "Europa en el siglo XX",
];

const DAY_NAMES = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

// ---------------- Supabase init ----------------
const { createClient } = supabase;
const sb = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

let READINGS = [];      // cache local de todas las lecturas
let currentView = "today";

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

// ---------------- Carga de datos: lecturas ----------------
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

function subscribeRealtime() {
  sb.channel("readings-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "readings" }, () => loadReadings())
    .subscribe();
  sb.channel("workout-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "workout_log" }, () => loadWorkouts())
    .subscribe();
}

// ---------------- Acciones sobre lecturas ----------------
async function toggleDone(reading) {
  const newStatus = reading.status === "done" ? "pending" : "done";
  const patch = {
    status: newStatus,
    completed_at: newStatus === "done" ? new Date().toISOString() : null,
  };
  Object.assign(reading, patch);
  renderCurrentView();
  if (newStatus === "done") showToast("¡Leída! 🎉", "done");
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
    showToast("¡Vas adelantado! 🌟", "advance");
    if (originEl) burstConfetti(originEl, ["#FFC93C", "#FF6B6B", "#22C55E"]);
  } else if (isPostpone) {
    showToast("Reprogramado. Sin drama.", "postpone");
  } else {
    showToast("Movido.", "postpone");
  }

  const { error } = await sb.from("readings").update({ scheduled_date: newDate }).eq("id", reading.id);
  if (error) { console.error(error); loadReadings(); }
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
  const n = 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 45 + Math.random() * 55;
    p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    p.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    p.style.setProperty("--rot", Math.round(Math.random() * 360) + "deg");
    p.style.background = colors[i % colors.length];
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1000);
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

// ---------------- Popover de fecha (en flujo normal, sin recorte) ----------------
function closeAllDatePopovers(except) {
  document.querySelectorAll(".date-popover.is-open").forEach((p) => {
    if (p !== except) p.classList.remove("is-open");
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".reading")) closeAllDatePopovers(null);
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
    if (reading.status !== "done") {
      burstConfetti(e.currentTarget, [
        getComputedStyle(document.documentElement).getPropertyValue("--" + subjectColorVar(reading.subject)).trim() || "#22C55E",
        "#FFC93C", "#4C9CFF",
      ]);
    }
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

  subEl.textContent =
    list.length === 0
      ? (isToday ? "nada programado por ahora" : "sin lecturas programadas este día")
      : `${list.length} lectura${list.length===1?"":"s"} · ${pages} páginas · ${done}/${list.length} leídas`;

  document.getElementById("today-jump").hidden = isToday;

  renderList(document.getElementById("today-list"), list, "No hay lecturas programadas para este día.");
}

function keepScrollAnchored() {
  // evita el salto de scroll cuando el nuevo día tiene menos lecturas
  // (y por lo tanto la página se hace más corta): reancla la vista a la
  // tarjeta de arriba en vez de dejar que el navegador recorte el scroll.
  const anchor = document.getElementById("today-card");
  if (anchor) anchor.scrollIntoView({ block: "start", behavior: "auto" });
}

function initTodayNav() {
  document.getElementById("today-next").addEventListener("click", () => {
    viewedDate = addDays(viewedDate, -1);
    renderToday();
    keepScrollAnchored();
  });
  document.getElementById("today-prev").addEventListener("click", () => {
    viewedDate = addDays(viewedDate, 1);
    renderToday();
    keepScrollAnchored();
  });
  document.getElementById("today-jump").addEventListener("click", () => {
    viewedDate = todayISO();
    renderToday();
    keepScrollAnchored();
  });
}

// ---------------- Vista: PROGRESO ----------------
function renderProgress() {
  const totalCount = READINGS.length;
  const doneCount = READINGS.filter((r) => r.status === "done").length;
  const totalPages = READINGS.reduce((s, r) => s + r.pages, 0);
  const donePages = READINGS.filter((r) => r.status === "done").reduce((s, r) => s + r.pages, 0);
  const pct = totalPages ? Math.round((donePages / totalPages) * 100) : 0;

  const totalsEl = document.getElementById("progress-totals");
  totalsEl.innerHTML = "";
  [
    { value: `${pct}%`, label: "avance (páginas)" },
    { value: `${doneCount}/${totalCount}`, label: "lecturas leídas" },
    { value: `${donePages}/${totalPages}`, label: "páginas leídas" },
  ].forEach((s) => {
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
    node.dataset.subject = subject;
    node.querySelector("h3").textContent = subject;
    const sDone = items.filter((r) => r.status === "done").length;
    const sPagesTotal = items.reduce((s, r) => s + r.pages, 0);
    const sPagesDone = items.filter((r) => r.status === "done").reduce((s, r) => s + r.pages, 0);
    node.querySelector(".stat-count").textContent = `${sDone}/${items.length} lecturas`;
    node.querySelector(".stat-pages").textContent = `${sPagesDone}/${sPagesTotal} pág.`;
    node.querySelector(".subject-block__bar-fill").style.width = (sPagesTotal ? (sPagesDone / sPagesTotal) * 100 : 0) + "%";

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

// ============================================================
// EJERCICIO — rutina de fuerza en casa (Día A / Día B)
// Entrenador: recomposición corporal, sin gimnasio, 12-15 min/sesión,
// mancuernas de 5kg y 10kg. Lunes a viernes, alternando A/B. Fines de
// semana, descanso. Vigente hasta el 20/12/2026.
// ============================================================

const WORKOUT_ANCHOR = "2026-08-25"; // martes = Día A (primer día hábil de la nueva rotación)
const WORKOUT_END = "2026-12-20";
const WORKOUT_WEEKDAYS = [2, 4, 6, 0]; // martes, jueves, sábado, domingo — 4 sesiones/semana
// descanso: lunes, miércoles, viernes (siempre días de semana, nunca fin de semana)

const EXERCISES_A = [
  { key: "goblet-squat", name: "Sentadilla goblet", spec: "3×12 · 10kg",
    desc: "<b>Cómo hacerlo:</b> sostené la mancuerna en forma vertical contra el pecho con ambas manos, pies al ancho de los hombros. Bajá flexionando cadera y rodillas como si te sentaras en una silla, pecho arriba, peso en los talones, hasta donde te sea cómodo. Subí empujando el piso. <b>Para qué sirve:</b> es el ejercicio más completo para pierna entera (cuádriceps, glúteos, isquiotibiales) en poco tiempo, y exige que mantengas el torso erguido, lo que ayuda a la postura." },
  { key: "press-militar", name: "Press militar de pie", spec: "3×12 · 5kg",
    desc: "<b>Cómo hacerlo:</b> de pie, una mancuerna en cada mano a la altura de los hombros, palmas hacia adelante. Empujá ambas hacia arriba hasta extender los brazos, sin arquear la espalda baja, y bajá con control. <b>Para qué sirve:</b> desarrolla hombros y tríceps, y al hacerse de pie (no sentado) también exige estabilidad del core." },
  { key: "peso-muerto-rumano", name: "Peso muerto rumano", spec: "3×12 · 10kg",
    desc: "<b>Cómo hacerlo:</b> de pie, una mancuerna en cada mano por delante de los muslos. Empujá la cadera hacia atrás con las rodillas apenas flexionadas y la espalda recta, bajando las mancuernas cerca de las piernas hasta sentir el estiramiento en los isquiotibiales. Volvé llevando la cadera adelante. <b>Para qué sirve:</b> fortalece toda la cadena posterior (isquiotibiales, glúteos, lumbar), clave para la postura y para prevenir dolores de espalda." },
  { key: "plancha-toque", name: "Plancha con toque de hombro", spec: "3×30-40s",
    desc: "<b>Cómo hacerlo:</b> apoyate en manos y puntas de pie como al inicio de una flexión, cuerpo en línea recta. Sin mover la cadera, tocá el hombro contrario con una mano y volvé a apoyar, alternando lados. <b>Para qué sirve:</b> trabaja el core en un patrón \"anti-rotación\", más exigente que una plancha estática, y mejora la estabilidad de tronco." },
];

const EXERCISES_B = [
  { key: "zancada", name: "Zancada estática con mancuernas", spec: "3×10-12 c/pierna · 10kg",
    desc: "<b>Cómo hacerlo:</b> una mancuerna en cada mano a los costados, dá un paso largo hacia adelante y bajá flexionando ambas rodillas a 90°, sin que la rodilla de adelante pase la punta del pie. Volvé empujando con la pierna de adelante. <b>Para qué sirve:</b> trabaja cuádriceps y glúteos de a una pierna por vez, lo que ayuda a corregir diferencias de fuerza entre ambas piernas." },
  { key: "remo-una-mano", name: "Remo a una mano", spec: "3×12 c/lado · 10kg",
    desc: "<b>Cómo hacerlo:</b> apoyá una rodilla y una mano sobre una silla, espalda paralela al piso, mancuerna en la otra mano colgando. Tirá la mancuerna hacia la cadera llevando el codo atrás y apretando el omóplato, bajá con control. <b>Para qué sirve:</b> fortalece la espalda media y el bíceps, y ayuda a contrarrestar la postura encorvada de pasar horas sentado." },
  { key: "press-pecho-piso", name: "Press de pecho en el piso", spec: "3×12 · 10kg",
    desc: "<b>Cómo hacerlo:</b> acostado boca arriba, rodillas flexionadas, una mancuerna en cada mano a la altura del pecho. Empujá hacia arriba hasta casi extender los brazos y bajá con control hasta que los codos casi toquen el piso. <b>Para qué sirve:</b> trabaja pecho, hombros y tríceps; hacerlo en el piso (no en un banco) protege el hombro al limitar el recorrido." },
  { key: "puente-gluteo", name: "Puente de glúteo", spec: "3×15",
    desc: "<b>Cómo hacerlo:</b> acostado boca arriba, rodillas flexionadas y pies apoyados, empujá la cadera hacia arriba apretando los glúteos hasta formar una línea recta de rodillas a hombros, bajá con control. <b>Para qué sirve:</b> activa directamente el glúteo, un músculo que se \"apaga\" con muchas horas sentado, y cuida la zona lumbar." },
];

const VARIATIONS_A = [
  "Sentadilla goblet → sentadilla sumo, o zancada búlgara con el pie de atrás apoyado en una silla.",
  "Press militar de pie → press Arnold (rotando la muñeca al subir), o press militar sentado.",
  "Peso muerto rumano → peso muerto a una pierna (unilateral), sosteniendo la mancuerna del lado contrario.",
  "Plancha con toque de hombro → plancha lateral, o mountain climbers.",
];
const VARIATIONS_B = [
  "Zancada estática → zancada caminando por la habitación, o step-up sobre un escalón o silla firme.",
  "Remo a una mano → remo renegado (en posición de plancha), o remo inclinado con las dos mancuernas.",
  "Press de pecho en el piso → flexiones de brazos clásicas, o pullover con una mancuerna.",
  "Puente de glúteo → hip thrust con la mancuerna apoyada sobre la cadera, o superman.",
];

function getWorkoutInfo(iso) {
  const d = dateFromISO(iso);
  const dow = d.getDay();
  if (!WORKOUT_WEEKDAYS.includes(dow)) return { type: "rest" };
  if (iso < WORKOUT_ANCHOR || iso > WORKOUT_END) return { type: "out" };
  let count = 0;
  const cur = dateFromISO(WORKOUT_ANCHOR);
  const target = dateFromISO(iso);
  while (cur <= target) {
    if (WORKOUT_WEEKDAYS.includes(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  const idx = count - 1;
  return { type: idx % 2 === 0 ? "A" : "B" };
}

let WORKOUTS = [];
async function loadWorkouts() {
  const { data, error } = await sb.from("workout_log").select("*");
  if (error) { console.error(error); return; }
  WORKOUTS = data || [];
  if (currentView === "exercise") renderExercise();
}

function getWorkoutRow(iso, key) {
  return WORKOUTS.find((w) => w.date === iso && w.exercise_key === key);
}

async function toggleExerciseDone(iso, key, originEl) {
  const existing = getWorkoutRow(iso, key);
  const newStatus = existing && existing.status === "done" ? "pending" : "done";
  if (existing) {
    existing.status = newStatus;
  } else {
    WORKOUTS.push({ date: iso, exercise_key: key, status: newStatus });
  }
  renderExercise();
  if (newStatus === "done") {
    showToast("¡Listo! 💪", "done");
    if (originEl) burstConfetti(originEl, ["#FF6B6B", "#FFC93C", "#12B3A6"]);
  }
  if (existing && existing.id) {
    await sb.from("workout_log").update({ status: newStatus }).eq("id", existing.id);
  } else {
    const { data, error } = await sb
      .from("workout_log")
      .insert({ date: iso, exercise_key: key, status: newStatus })
      .select();
    if (!error && data && data[0]) {
      const row = getWorkoutRow(iso, key);
      if (row) row.id = data[0].id;
    }
  }
}

function renderExercise() {
  const iso = todayISO();
  const info = getWorkoutInfo(iso);
  const dayLabel = document.getElementById("ex-day-label");
  const daySub = document.getElementById("ex-day-sub");
  const restMsg = document.getElementById("ex-rest-msg");
  const listEl = document.getElementById("ex-exercise-list");
  const variationsEl = document.getElementById("ex-variations");

  if (info.type === "rest" || info.type === "out") {
    dayLabel.textContent = formatLong(iso);
    daySub.textContent = info.type === "out" ? "fuera del período de rutina (17/08 – 20/12)" : "día de descanso";
    restMsg.hidden = false;
    listEl.innerHTML = "";
    variationsEl.innerHTML = "";
    renderExerciseWeek();
    return;
  }

  restMsg.hidden = true;
  const routine = info.type === "A" ? EXERCISES_A : EXERCISES_B;
  dayLabel.textContent = `Día ${info.type}`;
  daySub.textContent = `${formatLong(iso)} · ~12-15 min · descanso 45s entre series`;

  listEl.innerHTML = "";
  const tpl = document.getElementById("tpl-ex-card");
  routine.forEach((ex) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const row = getWorkoutRow(iso, ex.key);
    node.classList.toggle("is-done", !!(row && row.status === "done"));
    node.querySelector(".ex-card__name").textContent = ex.name;
    node.querySelector(".ex-card__spec").textContent = ex.spec;
    node.querySelector(".ex-card__desc").innerHTML = ex.desc;
    node.querySelector(".ex-card__tick").addEventListener("click", (e) => toggleExerciseDone(iso, ex.key, e.currentTarget));
    node.querySelector(".ex-card__plus").addEventListener("click", () => {
      node.querySelector(".ex-card__desc").classList.toggle("is-open");
    });
    listEl.appendChild(node);
  });

  variationsEl.innerHTML = "";
  (info.type === "A" ? VARIATIONS_A : VARIATIONS_B).forEach((v) => {
    const li = document.createElement("li");
    li.textContent = v;
    variationsEl.appendChild(li);
  });

  renderExerciseWeek();
}

function renderExerciseWeek() {
  const weekEl = document.getElementById("ex-week");
  weekEl.innerHTML = "";
  const todayIso = todayISO();
  const dow = dateFromISO(todayIso).getDay();
  const monday = addDays(todayIso, dow === 0 ? -6 : -(dow - 1));
  for (let i = 0; i < 7; i++) {
    const iso = addDays(monday, i);
    const info = getWorkoutInfo(iso);
    const wrap = document.createElement("div");
    wrap.className = "ex-week__day";
    const dot = document.createElement("div");
    dot.className = "ex-week__dot";
    if (info.type === "rest" || info.type === "out") {
      dot.classList.add("is-rest");
    } else {
      const routine = info.type === "A" ? EXERCISES_A : EXERCISES_B;
      const anyDone = routine.some((ex) => {
        const row = getWorkoutRow(iso, ex.key);
        return row && row.status === "done";
      });
      if (anyDone) dot.classList.add("is-done");
    }
    const label = document.createElement("div");
    label.className = "ex-week__label";
    label.textContent = DAY_NAMES[dateFromISO(iso).getDay()].slice(0, 2);
    wrap.appendChild(dot);
    wrap.appendChild(label);
    weekEl.appendChild(wrap);
  }
}

// ---------------- Router de vistas ----------------
function renderCurrentView() {
  if (currentView === "today") renderToday();
  else if (currentView === "progress") renderProgress();
  else if (currentView === "exercise") renderExercise();
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${view}`));
  renderCurrentView();
}

// ---------------- Reloj del encabezado ----------------
function tickClock() {
  document.getElementById("masthead-clock").textContent = formatLong(todayISO());
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });
  initTodayNav();
  tickClock();
  loadReadings();
  loadWorkouts();
  subscribeRealtime();
});
