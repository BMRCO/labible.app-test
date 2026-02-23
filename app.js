/* LaBible — Lecture + Recherche + Marque-pages + Plan 365 (local-first)
   - Sans offline: aucun SW / aucun manifest
   - Défaut: data/ls1910.json (LSG 1910)
*/

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const LS = {
  THEME: "labible.theme",
  UI: "labible.ui",
  BIBLE_CUSTOM: "labible.bible.custom",
  BIBLE_LABEL: "labible.bible.label",
  LAST_POS: "labible.lastpos",
  RECENTS: "labible.recents",
  BOOKMARKS: "labible.bookmarks",
  PLAN_DONE: "labible.plan.done",
  PLAN_START: "labible.plan.startDate"
};

const state = {
  bible: null,
  bibleLabel: "LSG 1910",
  mode: "chapters", // "chapters" | "verses"
  bookIndex: 0,
  chapterIndex: 0,
  selectedVerse: null,
  recents: [],
  bookmarks: [],
  plan: [],
  doneDays: new Set(),
  planStart: null,
  ui: { font: 20, pageWidth: 920, columns: 2 }
};

/* ---------- utils ---------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-show");
  setTimeout(() => t.classList.remove("is-show"), 1600);
}

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function diffDays(aISO, bISO) {
  const a = new Date(aISO + "T00:00:00").getTime();
  const b = new Date(bISO + "T00:00:00").getTime();
  return Math.floor((b - a) / 86400000);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

/* ---------- thème / UI ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  saveLS(LS.THEME, theme);
  $("#btnTheme").textContent = theme === "light" ? "☾" : "☼";
}
function applyUI() {
  document.documentElement.style.setProperty("--readerFont", `${state.ui.font}px`);
  document.documentElement.style.setProperty("--pageWidth", `${state.ui.pageWidth}px`);
  document.documentElement.style.setProperty("--columns", `${state.ui.columns}`);
  saveLS(LS.UI, state.ui);
  $("#fontRange").value = String(state.ui.font);
  $("#pageWidth").value = String(state.ui.pageWidth);
}

/* ---------- normalisation Bible (robuste) ---------- */
function normalizeBible(json) {
  // A) Format LaBible: { books:[{id,name,chapters:[[...]]}] }
  if (json && Array.isArray(json.books) && json.books.length) {
    const b0 = json.books[0];
    if (Array.isArray(b0.chapters)) return { mode: "chapters", data: json };
  }

  // B) Format verses: { books:[...], verses:[{bookId,chapter,verse,text}] }
  if (json && Array.isArray(json.books) && Array.isArray(json.verses)) {
    return { mode: "verses", data: json };
  }

  // C) { verses:[...] }
  if (json && Array.isArray(json.verses) && json.verses.length) {
    return { mode: "verses", data: buildVersesBible(json.verses) };
  }

  // D) [ {book_name/book/bookId, chapter, verse, text}, ... ]
  if (Array.isArray(json) && json.length && typeof json[0] === "object") {
    const v0 = json[0];
    const looks = ("text" in v0 || "t" in v0 || "content" in v0) &&
      ("book_name" in v0 || "book" in v0 || "bookId" in v0 || "book_id" in v0 || "bookName" in v0);
    if (looks) return { mode: "verses", data: buildVersesBible(json) };
  }

  // E) objet imbriqué: { "Genèse": { "1": { "1":"..." } } }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const candidate = (json.books && !Array.isArray(json.books)) ? json.books : json;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const keys = Object.keys(candidate);
      if (keys.length && typeof candidate[keys[0]] === "object") {
        return { mode: "chapters", data: buildChaptersBibleFromNested(candidate) };
      }
    }
  }

  throw new Error("Format JSON non reconnu. Montre-moi le début du fichier (premières lignes).");
}

function buildVersesBible(versesArr) {
  const bookMap = new Map(); // nameKey -> {id,name}
  const outVerses = [];

  const makeId = (bookName) => {
    const n = normalizeName(bookName).toUpperCase();
    const short = (n.slice(0, 3) || "BIB");
    let id = short;
    let k = 2;
    while ([...bookMap.values()].some(b => b.id === id)) id = `${short}${k++}`;
    return id;
  };

  for (const v of versesArr) {
    const bookName =
      v.book_name || v.bookName || v.book || v.book_id || v.bookId || v.b || "Livre";
    const nameKey = String(bookName);

    if (!bookMap.has(nameKey)) {
      const forcedId = v.bookId || v.book_id;
      bookMap.set(nameKey, { id: forcedId ? String(forcedId) : makeId(nameKey), name: nameKey });
    }
    const b = bookMap.get(nameKey);

    const chapter = Number(v.chapter ?? v.c);
    const verse = Number(v.verse ?? v.v);
    const text = String(v.text ?? v.t ?? v.content ?? v.verse_text ?? "");

    if (!Number.isFinite(chapter) || !Number.isFinite(verse) || !text) continue;
    outVerses.push({ bookId: b.id, chapter, verse, text });
  }

  const books = [...bookMap.values()].map(x => ({ id: x.id, name: x.name }));
  const bookOrder = new Map();
  books.forEach((b, i) => bookOrder.set(b.id, i));

  outVerses.sort((a, b) =>
    (bookOrder.get(a.bookId) ?? 9999) - (bookOrder.get(b.bookId) ?? 9999) ||
    a.chapter - b.chapter ||
    a.verse - b.verse
  );

  return { books, verses: outVerses };
}

function buildChaptersBibleFromNested(nested) {
  const books = [];
  const names = Object.keys(nested);

  const makeId = (name, idx) => {
    const base = normalizeName(name).toUpperCase();
    const short = (base.slice(0, 3) || "BIB");
    return idx ? `${short}${idx + 1}` : short;
  };

  for (let i = 0; i < names.length; i++) {
    const bookName = names[i];
    const chaptersObj = nested[bookName] || {};
    const chapNums = Object.keys(chaptersObj)
      .map(k => Number(k))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    const chapters = [];
    for (const c of chapNums) {
      const versesObj = chaptersObj[String(c)] || {};
      const verseNums = Object.keys(versesObj)
        .map(k => Number(k))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      const verses = verseNums.map(vn => String(versesObj[String(vn)] ?? ""));
      chapters.push(verses);
    }

    books.push({ id: makeId(bookName, i), name: bookName, chapters });
  }

  return { books };
}

/* ---------- accès chapitres ---------- */
function findBookIndexById(bookId) {
  return (state.bible.books || []).findIndex(b => String(b.id) === String(bookId));
}
function inferChapterCountFromVerses(bookId) {
  let m = 0;
  for (const v of (state.bible.verses || [])) {
    if (String(v.bookId) === String(bookId)) m = Math.max(m, Number(v.chapter) || 0);
  }
  return m || 1;
}
function getChapterCount(bookIndex) {
  const book = state.bible.books[bookIndex];
  if (!book) return 0;
  if (state.mode === "chapters") return book.chapters?.length || 0;
  return inferChapterCountFromVerses(book.id);
}
function getChapterVerses(bookIndex, chapterNumber) {
  const book = state.bible.books[bookIndex];
  if (!book) return [];
  const chap = chapterNumber;

  if (state.mode === "chapters") {
    const arr = book.chapters?.[chap - 1] || [];
    return arr.map((text, i) => ({ verse: i + 1, text }));
  }

  const verses = state.bible.verses || [];
  return verses
    .filter(v => String(v.bookId) === String(book.id) && Number(v.chapter) === chap)
    .sort((a, b) => Number(a.verse) - Number(b.verse))
    .map(v => ({ verse: Number(v.verse), text: String(v.text || "") }));
}

/* ---------- set Bible ---------- */
function setBible(bibleObj, label) {
  state.bible = bibleObj.data;
  state.mode = bibleObj.mode;
  state.bibleLabel = label || "Bible";

  $("#currentBibleLabel").textContent = state.bibleLabel;
  saveLS(LS.BIBLE_LABEL, state.bibleLabel);

  fillBookSelect();
  fillSearchSelects();

  const last = loadLS(LS.LAST_POS, null);
  if (last?.bookId) {
    const bi = findBookIndexById(last.bookId);
    if (bi >= 0) {
      state.bookIndex = bi;
      state.chapterIndex = clamp((last.chapter || 1) - 1, 0, getChapterCount(bi) - 1);
    }
  } else {
    state.bookIndex = 0;
    state.chapterIndex = 0;
  }

  renderReader();
  renderRecents();
  renderBookmarks();

  buildPlan365();
  renderPlan();
  renderDataStatus();
  renderDiagnostic();
}

/* ---------- lecture UI ---------- */
function fillBookSelect() {
  const sel = $("#bookSelect");
  sel.innerHTML = "";
  (state.bible.books || []).forEach((b, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = b.name;
    sel.appendChild(o);
  });
  sel.value = String(state.bookIndex);
  fillChapterSelect();
}
function fillChapterSelect() {
  const sel = $("#chapterSelect");
  sel.innerHTML = "";
  const count = getChapterCount(state.bookIndex);
  for (let i = 1; i <= count; i++) {
    const o = document.createElement("option");
    o.value = String(i - 1);
    o.textContent = `Chapitre ${i}`;
    sel.appendChild(o);
  }
  sel.value = String(clamp(state.chapterIndex, 0, Math.max(0, count - 1)));
}

function saveLastPos() {
  const book = state.bible.books[state.bookIndex];
  if (!book) return;
  const last = { bookId: book.id, chapter: state.chapterIndex + 1, verse: state.selectedVerse?.verse || 1 };
  saveLS(LS.LAST_POS, last);
}

function addRecent(bookId, chapter) {
  const key = `${bookId}:${chapter}`;
  state.recents = state.recents.filter(x => x !== key);
  state.recents.unshift(key);
  state.recents = state.recents.slice(0, 10);
  saveLS(LS.RECENTS, state.recents);
  renderRecents();
}
function renderRecents() {
  const wrap = $("#recentChips");
  wrap.innerHTML = "";
  state.recents.forEach(key => {
    const [bookId, chapStr] = key.split(":");
    const bi = findBookIndexById(bookId);
    if (bi < 0) return;
    const b = state.bible.books[bi];
    const chap = Number(chapStr);
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = `${b.name} ${chap}`;
    btn.onclick = () => {
      state.bookIndex = bi;
      state.chapterIndex = clamp(chap - 1, 0, getChapterCount(bi) - 1);
      $("#bookSelect").value = String(state.bookIndex);
      fillChapterSelect();
      renderReader();
      switchTab("read");
    };
    wrap.appendChild(btn);
  });
}

function selectVerse(verseNumber) {
  state.selectedVerse = {
    bookId: state.bible.books[state.bookIndex].id,
    chapter: state.chapterIndex + 1,
    verse: verseNumber
  };

  $$("#verses .v").forEach(el => el.classList.remove("is-selected"));
  const el = $(`#verses .v[data-verse="${verseNumber}"]`);
  if (el) {
    el.classList.add("is-selected");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  $("#statusHint").textContent = `Sélectionné : ${state.bible.books[state.bookIndex].name} ${state.chapterIndex + 1}:${verseNumber}`;
  saveLastPos();
}

function renderReader(afterRender) {
  const book = state.bible.books[state.bookIndex];
  if (!book) return;

  fillChapterSelect();
  const chapNo = state.chapterIndex + 1;
  const verses = getChapterVerses(state.bookIndex, chapNo);

  $("#crumb").textContent = `${book.name} — Chapitre ${chapNo}`;

  const wrap = $("#verses");
  wrap.innerHTML = "";
  verses.forEach(v => {
    const p = document.createElement("p");
    p.className = "v";
    p.dataset.verse = String(v.verse);
    p.innerHTML = `<span class="vnum">${v.verse}</span><span class="vtxt">${escapeHTML(v.text)}</span>`;
    p.querySelector(".vtxt").onclick = () => selectVerse(v.verse);
    wrap.appendChild(p);
  });

  state.selectedVerse = null;
  $("#statusHint").textContent = `Total : ${verses.length} versets`;

  addRecent(book.id, chapNo);
  saveLastPos();

  setTimeout(() => wrap.focus(), 30);
  if (typeof afterRender === "function") setTimeout(afterRender, 60);
}

/* ---------- marque-pages ---------- */
function bookmarkCurrent() {
  const book = state.bible.books[state.bookIndex];
  if (!book) return;
  const chap = state.chapterIndex + 1;
  const verse = state.selectedVerse?.verse || 1;
  const id = `${book.id}:${chap}:${verse}`;
  if (state.bookmarks.some(b => b.id === id)) { toast("Déjà dans les marque-pages."); return; }

  const item = { id, bookId: book.id, bookName: book.name, chapter: chap, verse, createdAt: Date.now() };
  state.bookmarks.unshift(item);
  state.bookmarks = state.bookmarks.slice(0, 200);
  saveLS(LS.BOOKMARKS, state.bookmarks);
  renderBookmarks();
  toast("Marque-page ajouté ★");
}
function removeBookmark(id) {
  state.bookmarks = state.bookmarks.filter(b => b.id !== id);
  saveLS(LS.BOOKMARKS, state.bookmarks);
  renderBookmarks();
}
function renderBookmarks() {
  const list = $("#bookmarkList");
  list.innerHTML = "";
  if (!state.bookmarks.length) {
    list.innerHTML = `<div class="muted">Aucun marque-page.</div>`;
    return;
  }
  state.bookmarks.slice(0, 25).forEach(bm => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__title">${bm.bookName} ${bm.chapter}:${bm.verse}</div>
      <div class="item__sub">${new Date(bm.createdAt).toLocaleString()}</div>
      <div class="item__actions">
        <button class="linkbtn" data-open>Ouvrir</button>
        <button class="linkbtn" data-del>Supprimer</button>
      </div>
    `;
    div.querySelector("[data-open]").onclick = () => {
      const bi = findBookIndexById(bm.bookId);
      if (bi < 0) return;
      state.bookIndex = bi;
      state.chapterIndex = clamp(bm.chapter - 1, 0, getChapterCount(bi) - 1);
      $("#bookSelect").value = String(state.bookIndex);
      fillChapterSelect();
      renderReader(() => selectVerse(bm.verse));
      switchTab("read");
    };
    div.querySelector("[data-del]").onclick = () => removeBookmark(bm.id);
    list.appendChild(div);
  });
}

/* ---------- tabs ---------- */
function switchTab(name) {
  $$(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  $$(".panel").forEach(p => p.classList.toggle("is-active", p.id === `tab-${name}`));
}

/* ---------- recherche ---------- */
function fillSearchSelects() {
  const selBook = $("#searchBook");
  selBook.innerHTML = `<option value="">Tous</option>`;
  (state.bible.books || []).forEach(b => {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    selBook.appendChild(o);
  });
  $("#searchChapter").innerHTML = `<option value="">Tous</option>`;
  $("#searchChapter").disabled = true;
}
function updateSearchChapters() {
  const bookId = $("#searchBook").value;
  const chapSel = $("#searchChapter");
  chapSel.innerHTML = `<option value="">Tous</option>`;
  if (!bookId) { chapSel.disabled = true; return; }
  const bi = findBookIndexById(bookId);
  if (bi < 0) return;
  const count = getChapterCount(bi);
  for (let c = 1; c <= count; c++) {
    const o = document.createElement("option");
    o.value = String(c);
    o.textContent = `Chapitre ${c}`;
    chapSel.appendChild(o);
  }
  chapSel.disabled = false;
}

function searchBible(term, bookId, chapterStr) {
  term = (term || "").trim();
  if (term.length < 2) return [];
  const t = term.toLowerCase();
  const chapter = chapterStr ? Number(chapterStr) : null;

  const results = [];

  if (state.mode === "verses") {
    for (const v of (state.bible.verses || [])) {
      if (bookId && String(v.bookId) !== String(bookId)) continue;
      if (chapter && Number(v.chapter) !== chapter) continue;
      const txt = String(v.text || "");
      if (txt.toLowerCase().includes(t)) {
        results.push({ bookId: v.bookId, chapter: Number(v.chapter), verse: Number(v.verse), text: txt });
      }
    }
    return results.slice(0, 300);
  }

  for (const b of (state.bible.books || [])) {
    if (bookId && String(b.id) !== String(bookId)) continue;
    const chs = b.chapters || [];
    for (let c = 1; c <= chs.length; c++) {
      if (chapter && c !== chapter) continue;
      const verses = chs[c - 1] || [];
      for (let i = 0; i < verses.length; i++) {
        const txt = String(verses[i] || "");
        if (txt.toLowerCase().includes(t)) {
          results.push({ bookId: b.id, chapter: c, verse: i + 1, text: txt });
        }
      }
    }
  }
  return results.slice(0, 300);
}

function renderResults(items, term) {
  const wrap = $("#results");
  wrap.innerHTML = "";
  if (!items.length) { wrap.innerHTML = `<div class="muted">Aucun résultat.</div>`; return; }

  const re = new RegExp(escapeRegExp(term.trim()), "ig");
  items.forEach(r => {
    const bi = findBookIndexById(r.bookId);
    const bname = bi >= 0 ? state.bible.books[bi].name : r.bookId;
    const div = document.createElement("div");
    div.className = "result";
    const safe = escapeHTML(r.text).replace(re, (m) => `<mark>${m}</mark>`);
    div.innerHTML = `
      <div class="result__ref">${bname} ${r.chapter}:${r.verse}</div>
      <div class="result__txt">${safe}</div>
      <div class="row gap" style="margin-top:10px">
        <button class="linkbtn" data-open>Ouvrir</button>
        <button class="linkbtn" data-mark>★</button>
      </div>
    `;
    div.querySelector("[data-open]").onclick = () => {
      if (bi < 0) return;
      state.bookIndex = bi;
      state.chapterIndex = clamp(r.chapter - 1, 0, getChapterCount(bi) - 1);
      $("#bookSelect").value = String(state.bookIndex);
      fillChapterSelect();
      renderReader(() => selectVerse(r.verse));
      switchTab("read");
    };
    div.querySelector("[data-mark]").onclick = () => {
      const id = `${r.bookId}:${r.chapter}:${r.verse}`;
      if (state.bookmarks.some(b => b.id === id)) { toast("Déjà enregistré."); return; }
      state.bookmarks.unshift({ id, bookId: r.bookId, bookName: bname, chapter: r.chapter, verse: r.verse, createdAt: Date.now() });
      saveLS(LS.BOOKMARKS, state.bookmarks);
      renderBookmarks();
      toast("Marque-page ajouté ★");
    };
    wrap.appendChild(div);
  });
}

/* ---------- plan 365 ---------- */
function loadPlanState() {
  state.doneDays = new Set(loadLS(LS.PLAN_DONE, []));
  state.planStart = loadLS(LS.PLAN_START, null);
  if (!state.planStart) {
    state.planStart = todayISO();
    saveLS(LS.PLAN_START, state.planStart);
  }
}
function planIndexForDate(iso) { return clamp(diffDays(state.planStart, iso), 0, 364); }
function isDone(dayIndex) { return state.doneDays.has(String(dayIndex + 1)); }
function setDone(dayIndex, done) {
  const key = String(dayIndex + 1);
  if (done) state.doneDays.add(key); else state.doneDays.delete(key);
  saveLS(LS.PLAN_DONE, Array.from(state.doneDays));
  renderPlan();
}
function computeStreak() {
  const todayIdx = planIndexForDate(todayISO());
  let s = 0;
  for (let i = todayIdx; i >= 0; i--) { if (isDone(i)) s++; else break; }
  return s;
}

function parseRef(ref) {
  const s = String(ref).trim();
  const m = s.match(/^(.*)\s+(\d+)(?::(\d+))?$/);
  if (!m) return null;
  return { book: m[1].trim(), chapter: Number(m[2]), verse: m[3] ? Number(m[3]) : null };
}

function gotoRef(bookNameOrId, chapter, verse) {
  const target = normalizeName(bookNameOrId);
  let bi = state.bible.books.findIndex(b => normalizeName(b.id) === target);
  if (bi < 0) bi = state.bible.books.findIndex(b => normalizeName(b.name) === target);
  if (bi < 0) bi = state.bible.books.findIndex(b => normalizeName(b.name).startsWith(target));
  if (bi < 0) { toast(`Livre introuvable : ${bookNameOrId}`); return; }

  state.bookIndex = bi;
  state.chapterIndex = clamp((chapter || 1) - 1, 0, getChapterCount(bi) - 1);
  $("#bookSelect").value = String(state.bookIndex);
  fillChapterSelect();
  renderReader(() => verse ? selectVerse(verse) : null);
}

function openRefs(refs) {
  if (!refs?.length) { toast("Aucune référence."); return; }
  const first = parseRef(refs[0]);
  if (!first) { toast("Référence invalide."); return; }
  gotoRef(first.book, first.chapter, first.verse || 1);
  switchTab("read");
  toast("Lecture ouverte.");
}

function buildPlan365() {
  const books = state.bible.books || [];
  const all = [];

  for (const b of books) {
    const count = (state.mode === "chapters")
      ? (b.chapters?.length || 0)
      : inferChapterCountFromVerses(b.id);
    for (let c = 1; c <= count; c++) all.push({ bookName: b.name, bookId: b.id, chapter: c });
  }

  const total = all.length || 1;
  const days = [];
  let i = 0;

  for (let d = 0; d < 365; d++) {
    const refs = [];
    const remaining = total - i;
    const daysLeft = 365 - d;
    const ideal = Math.ceil(remaining / daysLeft);
    const take = clamp(ideal, 1, 4);

    for (let k = 0; k < take && i < total; k++, i++) {
      const x = all[i];
      refs.push(`${x.bookName} ${x.chapter}`);
    }

    days.push({
      refs,
      note: refs.length ? "Lis attentivement, puis valide ta lecture." : "—"
    });
  }

  state.plan = days;
}

function renderCalendar(todayIdx) {
  const cal = $("#calendar");
  cal.innerHTML = "";

  const focus = todayIdx;
  const start = clamp(focus - 42, 0, 364);
  const end = clamp(focus + 42, 0, 364);
  const span = end - start + 1;

  const padLeft = (7 - (start % 7)) % 7;
  for (let p = 0; p < padLeft; p++) {
    const ph = document.createElement("div");
    ph.className = "day";
    ph.style.opacity = "0.25";
    ph.style.pointerEvents = "none";
    cal.appendChild(ph);
  }

  for (let j = 0; j < span; j++) {
    const idx = start + j;
    const iso = addDaysISO(state.planStart, idx);
    const el = document.createElement("div");
    el.className = "day";
    el.classList.toggle("is-done", isDone(idx));
    el.classList.toggle("is-today", idx === focus);
    el.innerHTML = `<div class="day__n">${idx + 1}</div><div class="day__dot"></div>`;
    el.title = `Jour ${idx + 1} — ${iso}\n${(state.plan[idx]?.refs || []).join(" / ")}`;
    el.onclick = () => openPlanDay(idx);
    cal.appendChild(el);
  }
}

function openPlanDay(dayIndex) {
  const iso = addDaysISO(state.planStart, dayIndex);
  const day = state.plan[dayIndex] || { refs: [] };

  $("#todayTitle").textContent = `Jour ${dayIndex + 1} — ${iso}`;
  $("#todayRefs").textContent = (day.refs || []).join(" • ") || "—";
  $("#todayNote").textContent = day.note || "—";

  const done = isDone(dayIndex);
  $("#btnToggleDone").textContent = done ? "✓ Fait" : "✓ Marquer";
  $("#btnToggleDone").onclick = () => setDone(dayIndex, !done);
  $("#btnOpenRefs").onclick = () => openRefs(day.refs || []);
  toast(`Jour ${dayIndex + 1}`);
}

function renderPlan() {
  if (!state.plan.length) return;

  const doneCount = Array.from(state.doneDays).length;
  const pct = Math.round((doneCount / 365) * 100);

  $("#planBar").style.width = `${pct}%`;
  $("#planStats").textContent = `${doneCount}/365 (${pct}%)`;
  $("#planStreak").textContent = `Série : ${computeStreak()} jour(s)`;

  const iso = todayISO();
  const idx = planIndexForDate(iso);
  const day = state.plan[idx] || { refs: [] };

  $("#todayTitle").textContent = `Jour ${idx + 1} — ${iso}`;
  $("#todayRefs").textContent = (day.refs || []).join(" • ") || "—";
  $("#todayNote").textContent = day.note || "—";

  const done = isDone(idx);
  $("#btnToggleDone").textContent = done ? "✓ Fait" : "✓ Marquer";
  $("#btnToggleDone").onclick = () => setDone(idx, !done);
  $("#btnOpenRefs").onclick = () => openRefs(day.refs || []);

  renderCalendar(idx);
}

/* ---------- bibliothèque (défaut + import) ---------- */
async function loadDefaultBible() {
  const res = await fetch("data/ls1910.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger data/ls1910.json (vérifie le fichier dans le repo).");
  const json = await res.json();
  setBible(normalizeBible(json), "LSG 1910");
}

async function loadCustomBibleFromLS() {
  const custom = loadLS(LS.BIBLE_CUSTOM, null);
  const label = loadLS(LS.BIBLE_LABEL, "Import");
  if (!custom) return false;
  try {
    setBible(normalizeBible(custom), label);
    return true;
  } catch (e) {
    console.warn(e);
    return false;
  }
}

function forgetCustomBible() {
  localStorage.removeItem(LS.BIBLE_CUSTOM);
  localStorage.removeItem(LS.BIBLE_LABEL);
  toast("Import supprimé. Retour au défaut.");
  loadDefaultBible();
}

/* ---------- données ---------- */
function renderDataStatus() {
  const last = loadLS(LS.LAST_POS, null);
  $("#dataStatus").textContent =
    `Bible : ${state.bibleLabel} • Marque-pages : ${state.bookmarks.length} • Récents : ${state.recents.length} • Position : ${
      last ? `${last.bookId} ${last.chapter}:${last.verse}` : "—"
    }`;
}

function exportData() {
  const payload = {
    v: 1,
    exportedAt: new Date().toISOString(),
    theme: loadLS(LS.THEME, "dark"),
    ui: state.ui,
    lastPos: loadLS(LS.LAST_POS, null),
    recents: state.recents,
    bookmarks: state.bookmarks,
    planStart: state.planStart,
    planDone: Array.from(state.doneDays),
    bibleLabel: loadLS(LS.BIBLE_LABEL, null),
    bibleCustom: loadLS(LS.BIBLE_CUSTOM, null)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `labible-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Export terminé.");
}

async function importData(file) {
  const txt = await file.text();
  const p = JSON.parse(txt);
  if (!p || p.v !== 1) throw new Error("Sauvegarde invalide.");

  if (p.theme) applyTheme(p.theme);
  if (p.ui) { state.ui = p.ui; applyUI(); }
  if (p.lastPos) saveLS(LS.LAST_POS, p.lastPos);

  state.recents = p.recents || [];
  saveLS(LS.RECENTS, state.recents);

  state.bookmarks = p.bookmarks || [];
  saveLS(LS.BOOKMARKS, state.bookmarks);

  if (p.planStart) { state.planStart = p.planStart; saveLS(LS.PLAN_START, p.planStart); }
  state.doneDays = new Set(p.planDone || []);
  saveLS(LS.PLAN_DONE, Array.from(state.doneDays));

  if (p.bibleCustom) {
    saveLS(LS.BIBLE_CUSTOM, p.bibleCustom);
    if (p.bibleLabel) saveLS(LS.BIBLE_LABEL, p.bibleLabel);
    await loadCustomBibleFromLS();
  } else {
    await loadDefaultBible();
  }

  state.recents = loadLS(LS.RECENTS, []);
  state.bookmarks = loadLS(LS.BOOKMARKS, []);
  renderRecents();
  renderBookmarks();
  buildPlan365();
  renderPlan();
  renderDataStatus();
  toast("Import terminé.");
}

function wipeAll() {
  if (!confirm("Tout effacer (position, marque-pages, plan, import) ?")) return;
  Object.values(LS).forEach(k => localStorage.removeItem(k));
  location.reload();
}

function renderDiagnostic() {
  const books = state.bible?.books?.length || 0;
  const mode = state.mode;
  const totalCh = books
    ? state.bible.books.reduce((a, b) => a + ((mode === "chapters") ? (b.chapters?.length || 0) : inferChapterCountFromVerses(b.id)), 0)
    : 0;

  $("#diagnostic").innerHTML =
    `<div><strong>Mode :</strong> ${mode}</div>
     <div><strong>Livres :</strong> ${books}</div>
     <div><strong>Total chapitres :</strong> ${totalCh}</div>
     <div class="muted" style="margin-top:8px">Le plan 365 est généré automatiquement à partir des chapitres.</div>`;
}

/* ---------- events ---------- */
function initEvents() {
  // Tabs
  $$(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  // Lecture nav
  $("#bookSelect").addEventListener("change", (e) => {
    state.bookIndex = Number(e.target.value);
    state.chapterIndex = 0;
    fillChapterSelect();
    renderReader();
  });
  $("#chapterSelect").addEventListener("change", (e) => {
    state.chapterIndex = Number(e.target.value);
    renderReader();
  });

  $("#btnPrev").onclick = () => {
    const max = getChapterCount(state.bookIndex) - 1;
    state.chapterIndex = clamp(state.chapterIndex - 1, 0, max);
    $("#chapterSelect").value = String(state.chapterIndex);
    renderReader();
  };
  $("#btnNext").onclick = () => {
    const max = getChapterCount(state.bookIndex) - 1;
    state.chapterIndex = clamp(state.chapterIndex + 1, 0, max);
    $("#chapterSelect").value = String(state.chapterIndex);
    renderReader();
  };

  // Actions
  $("#btnBookmark").onclick = bookmarkCurrent;
  $("#btnTheme").onclick = () => applyTheme((loadLS(LS.THEME, "dark") === "light") ? "dark" : "light");

  // Tools
  $("#btnFontMinus").onclick = () => { state.ui.font = clamp(state.ui.font - 1, 16, 28); applyUI(); };
  $("#btnFontPlus").onclick = () => { state.ui.font = clamp(state.ui.font + 1, 16, 28); applyUI(); };
  $("#btnColumns").onclick = () => { state.ui.columns = (state.ui.columns === 2 ? 1 : 2); applyUI(); toast(`Colonnes : ${state.ui.columns}`); };

  // Plan
  $("#btnGoToday").onclick = () => openPlanDay(planIndexForDate(todayISO()));
  $("#btnMarkToday").onclick = () => {
    const idx = planIndexForDate(todayISO());
    setDone(idx, true);
    toast("Aujourd’hui : fait ✓");
  };
  $("#btnResetPlan").onclick = () => {
    if (!confirm("Réinitialiser la progression du plan ?")) return;
    state.doneDays = new Set();
    saveLS(LS.PLAN_DONE, []);
    state.planStart = todayISO();
    saveLS(LS.PLAN_START, state.planStart);
    renderPlan();
    toast("Plan réinitialisé.");
  };

  // Recherche
  $("#searchBook").addEventListener("change", updateSearchChapters);
  $("#btnSearch").onclick = () => {
    const term = $("#searchInput").value;
    const bookId = $("#searchBook").value || "";
    const chap = $("#searchChapter").value || "";
    const results = searchBible(term, bookId, chap);
    renderResults(results, term);
  };
  $("#searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnSearch").click(); });
  $("#btnClearSearch").onclick = () => { $("#searchInput").value = ""; $("#results").innerHTML = ""; toast("Recherche effacée."); };

  // Bibliothèque
  $("#btnUseDefault").onclick = () => {
    localStorage.removeItem(LS.BIBLE_CUSTOM);
    localStorage.removeItem(LS.BIBLE_LABEL);
    loadDefaultBible();
    toast("Bible par défaut : LSG 1910");
  };
  $("#btnForgetBible").onclick = forgetCustomBible;

  $("#bibleFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const json = JSON.parse(txt);
      const normalized = normalizeBible(json);
      saveLS(LS.BIBLE_CUSTOM, json);
      const label = file.name.replace(".json", "");
      saveLS(LS.BIBLE_LABEL, label);
      setBible(normalized, label);
      toast("Bible importée.");
    } catch (err) {
      console.error(err);
      alert(String(err.message || err));
    } finally {
      e.target.value = "";
    }
  });

  // Réglages
  $("#btnLight").onclick = () => applyTheme("light");
  $("#btnDark").onclick = () => applyTheme("dark");
  $("#fontRange").addEventListener("input", (e) => { state.ui.font = Number(e.target.value); applyUI(); });
  $("#pageWidth").addEventListener("input", (e) => { state.ui.pageWidth = Number(e.target.value); applyUI(); });
  $("#btnResetUi").onclick = () => {
    state.ui = { font: 20, pageWidth: 920, columns: 2 };
    applyUI();
    toast("Réglages d’affichage réinitialisés.");
  };

  // Données
  $("#btnExport").onclick = exportData;
  $("#btnImport").onclick = () => $("#importFile").click();
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { await importData(file); }
    catch (err) { alert(String(err.message || err)); }
    finally { e.target.value = ""; }
  });
  $("#btnWipe").onclick = wipeAll;
}

/* ---------- boot ---------- */
async function boot() {
  applyTheme(loadLS(LS.THEME, "dark"));
  state.ui = loadLS(LS.UI, state.ui);
  applyUI();

  state.recents = loadLS(LS.RECENTS, []);
  state.bookmarks = loadLS(LS.BOOKMARKS, []);
  loadPlanState();

  initEvents();

  const loadedCustom = await loadCustomBibleFromLS();
  if (!loadedCustom) await loadDefaultBible();

  renderPlan();
}

boot();