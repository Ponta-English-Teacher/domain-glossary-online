// app.js — Domain Glossary (Online)
// Keeps: search/results exactly as before
// Adds: Glossary "DataBox" editor (Compact · Edit · Save · Undo · Redo) above the table

// -------------------------------
// DOM refs
// -------------------------------
const el = {
  input: document.getElementById("wordInput"),
  btnSearch: document.getElementById("btnSearch"),
  results: document.getElementById("results"),
  netBadge: document.getElementById("netBadge"),
  btnDownloadTSV: document.getElementById("btnDownloadTSV"),
  btnClearAll: document.getElementById("btnClearAll"),
  filterText: document.getElementById("filterText"),
  filterDomain: document.getElementById("filterDomain"),
  btnResetFilters: document.getElementById("btnResetFilters"),
  table: document.getElementById("glossaryTable"),
  topActions: document.querySelector(".top-actions"),
};

// Wrap the glossary table once so it can scroll horizontally on small screens
(function setupGlossaryScroll(){
  const t = el.table;
  if (!t) return;
  const parent = t.parentElement;
  if (!parent) return;
  if (parent.classList.contains("table-scroll")) return; // already wrapped

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  parent.replaceChild(wrap, t);
  wrap.appendChild(t);
})();

const STORAGE_KEY = "domainGlossary.v1";

// -------------------------------
// State
// -------------------------------
let glossary = loadGlossary();

// -------------------------------
// Wire events FIRST (so Search always works), then render
// -------------------------------
el.btnSearch.addEventListener("click", onSearch);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSearch();
});
document.querySelector("form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  onSearch();
});

el.btnDownloadTSV.addEventListener("click", downloadTSV);
el.btnClearAll.addEventListener("click", () => {
  if (!confirm("Delete all saved glossary items on this device?")) return;
  glossary = [];
  saveGlossary(glossary);
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  DataBox.refreshAfterExternalChange();
});

el.filterText.addEventListener("input", () => renderGlossaryTable(glossary));
el.filterDomain.addEventListener("change", () => renderGlossaryTable(glossary));
el.btnResetFilters.addEventListener("click", () => {
  el.filterText.value = "";
  el.filterDomain.value = "";
  renderGlossaryTable(glossary);
});

// Initial renders (safe-guarded)
try {
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  setOnlineBadge();
} catch (e) {
  console.error("Initial render error (Search wired anyway):", e);
}

// -------------------------------
// Network badge (unchanged)
// -------------------------------
function setOnlineBadge() {
  if (navigator.onLine) {
    el.netBadge.textContent = "Online";
    el.netBadge.classList.remove("offline");
  } else {
    el.netBadge.textContent = "Offline";
    el.netBadge.classList.add("offline");
  }
}
window.addEventListener("online", setOnlineBadge);
window.addEventListener("offline", setOnlineBadge);

// -------------------------------
// Search + Render (unchanged behavior)
// -------------------------------
async function onSearch() {
  const term = (el.input.value || "").trim();
  clearResults();
  if (!term) {
    showError("Please type a word or short phrase.");
    return;
  }
  try {
    const resp = await fetch("/api/define", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API error ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    renderResults(term, data);
  } catch (err) {
    console.error(err);
    showError(String(err?.message || err));
  }
}

function clearResults() {
  el.results.innerHTML = "";
}

function showError(msg) {
  const div = document.createElement("div");
  div.className = "card error";
  div.textContent = `Error: ${msg}`;
  el.results.appendChild(div);
}

// -------------------------------
// Results rendering (view + save to localStorage only)
// -------------------------------
function renderResults(typedTerm, data) {
  // Notices
  const notices = document.createElement("div");
  notices.className = "notices";

  if (data.corrected_to && data.corrected_to !== typedTerm) {
    const tip = document.createElement("div");
    tip.className = "notice";
    tip.textContent = `Interpreted as “${data.corrected_to}”.`;
    notices.appendChild(tip);
  }

  if (Array.isArray(data.did_you_mean) && data.did_you_mean.length) {
    const tip = document.createElement("div");
    tip.className = "notice subtle";
    tip.innerHTML = `Did you mean: ${data.did_you_mean
      .map((w) => `<button class="chip chip-suggest" data-suggest="${escapeHtml(w)}">${escapeHtml(w)}</button>`)
      .join(" ")}`;
    notices.appendChild(tip);
  }

  if (notices.children.length) {
    el.results.appendChild(notices);
    notices.addEventListener("click", (e) => {
      const b = e.target.closest(".chip-suggest");
      if (!b) return;
      const t = b.getAttribute("data-suggest");
      el.input.value = t || "";
      onSearch();
    });
  }

  // General card
  const genCard = document.createElement("section");
  genCard.className = "card";
  const head = document.createElement("h2");
  head.textContent = `${data.headword || typedTerm} · General`;
  genCard.appendChild(head);

  genCard.appendChild(kv("Definition (EN)", data?.general?.definition_en || "—"));
  genCard.appendChild(kv("Translation (JA)", data?.general?.translation_ja || "—"));

  if (data?.general?.example_en) genCard.appendChild(kv("Example", data.general.example_en));
  if (data?.general?.note) genCard.appendChild(kv("Note", data.general.note));

  // Optional view-only synonyms/antonyms
  if (Array.isArray(data.synonyms) && data.synonyms.length) {
    genCard.appendChild(kv("Synonyms", data.synonyms.join(", ")));
  }
  if (Array.isArray(data.antonyms) && data.antonyms.length) {
    genCard.appendChild(kv("Antonyms", data.antonyms.join(", ")));
  }

  // Related forms (safe if missing)
  renderRelatedForms(genCard, data.related_forms);

  // Actions
  genCard.appendChild(
    actionRow({
      label: "Send to My Glossary",
      onClick: () => {
        addToGlossary({
          word: data.headword || typedTerm,
          sense: "General",
          definition_en: data?.general?.definition_en || "",
          translation_ja: data?.general?.translation_ja || "",
          example_en: data?.general?.example_en || "",
          note: data?.general?.note || "",
        });
      },
    })
  );

  genCard.appendChild(
    copyRow(() =>
      textBlock({
        word: data.headword || typedTerm,
        sense: "General",
        def: data?.general?.definition_en,
        ja: data?.general?.translation_ja,
        ex: data?.general?.example_en,
      })
    )
  );

  el.results.appendChild(genCard);

  // Domain cards
  (data.domains || []).forEach((d) => {
    const card = document.createElement("section");
    card.className = "card";
    const h = document.createElement("h2");
    h.textContent = `${data.headword || typedTerm} · ${d.domain}`;
    card.appendChild(h);

    card.appendChild(kv("Definition (EN)", d.definition_en || "—"));
    card.appendChild(kv("Translation (JA)", d.translation_ja || "—"));
    if (d.example_en) card.appendChild(kv("Example", d.example_en));
    if (d.note) card.appendChild(kv("Note", d.note));

    card.appendChild(
      actionRow({
        label: "Send to My Glossary",
        onClick: () => {
          addToGlossary({
            word: data.headword || typedTerm,
            sense: d.domain,
            definition_en: d.definition_en || "",
            translation_ja: d.translation_ja || "",
            example_en: d.example_en || "",
            note: d.note || "",
          });
        },
      })
    );

    card.appendChild(
      copyRow(() =>
        textBlock({
          word: data.headword || typedTerm,
          sense: d.domain,
          def: d.definition_en,
          ja: d.translation_ja,
          ex: d.example_en,
        })
      )
    );

    el.results.appendChild(card);
  });
}

function renderRelatedForms(parentEl, related) {
  if (!Array.isArray(related) || related.length === 0) return;
  const wrap = document.createElement("div");
  wrap.className = "related-forms";
  const h = document.createElement("h3");
  h.textContent = "Related forms";
  wrap.appendChild(h);
  const ul = document.createElement("ul");
  related.forEach((r) => {
    const li = document.createElement("li");
    const pos = r.pos ? ` (${r.pos})` : "";
    const ja = r.ja_gloss ? ` = ${r.ja_gloss}` : "";
    li.textContent = `${r.form}${pos}${ja}`;
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  parentEl.appendChild(wrap);
}

// -------------------------------
// Glossary (localStorage) — unchanged schema
// -------------------------------
function loadGlossary() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveGlossary(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function addToGlossary(item) {
  glossary.push({
    ...item,
    createdAt: new Date().toISOString(),
  });
  saveGlossary(glossary);
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  DataBox.refreshAfterExternalChange();
}

// -------------------------------
// Table rendering (read-only; DataBox layers editing)
// -------------------------------
const FIELDS = ["word", "sense", "definition_en", "translation_ja", "example_en", "note"];

function renderGlossaryTable(data) {
  const tbody = el.table.querySelector("tbody");
  tbody.innerHTML = "";

  const ft = (el.filterText.value || "").toLowerCase();
  const fd = el.filterDomain.value || "";

  const rows = data
    .map((row, idx) => ({ ...row, __idx: idx }))
    .filter((row) => {
      const hay = `${row.word} ${row.sense} ${row.definition_en} ${row.translation_ja} ${row.example_en} ${row.note}`.toLowerCase();
      const passText = !ft || hay.includes(ft);
      const passDomain = !fd || row.sense === fd;
      return passText && passDomain;
    });

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    // visible cells
    FIELDS.forEach((field) => {
      const cell = document.createElement("td");
      cell.textContent = row[field] ?? "";
      tr.appendChild(cell);
    });

    // CreatedAt (read-only, used as stable id)
    const created = document.createElement("td");
    created.textContent = row.createdAt || "";
    tr.appendChild(created);

    tbody.appendChild(tr);
  });

  // Let DataBox layer editing behaviors after we render
  DataBox.wireTable();
}

// -------------------------------
// Domain filter options
// -------------------------------
function updateDomainFilterOptions(data) {
  const sel = el.filterDomain;
  const keep = sel.value;
  const domains = [...new Set(data.map((r) => r.sense).filter(Boolean))].sort();

  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All domains";
  sel.appendChild(optAll);

  domains.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });

  sel.value = keep || "";
}

// -------------------------------
// TSV Export
// -------------------------------
function downloadTSV() {
  if (!glossary.length) {
    alert("No items in glossary.");
    return;
  }
  const header = [
    "Word",
    "Sense",
    "Definition (EN)",
    "Translation (JA)",
    "Example",
    "Note",
    "CreatedAt",
  ];

  const rows = glossary.map((r) => [
    r.word,
    r.sense,
    r.definition_en,
    r.translation_ja,
    r.example_en || "",
    r.note || "",
    r.createdAt || "",
  ]);

  const tsv = [header, ...rows].map((arr) => arr.map(safeTSV).join("\t")).join("\n");
  const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `glossary_${new Date().toISOString().slice(0, 10)}.tsv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// -------------------------------
// Small helpers
// -------------------------------
function kv(label, value) {
  const row = document.createElement("div");
  row.className = "kv-row";

  const k = document.createElement("div");
  k.className = "k";
  k.textContent = label;

  const v = document.createElement("div");
  v.className = "v";
  v.textContent = value ?? "—";

  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function actionRow({ label, onClick }) {
  const row = document.createElement("div");
  row.className = "actions";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  row.appendChild(btn);
  return row;
}

function copyRow(getText) {
  const row = document.createElement("div");
  row.className = "actions";
  const btn = document.createElement("button");
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    const t = getText();
    try {
      await navigator.clipboard.writeText(t);
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    } catch {
      alert("Copy failed");
    }
  });
  row.appendChild(btn);
  return row;
}

function textBlock({ word, sense, def, ja, ex }) {
  const lines = [
    `${word} · ${sense}`,
    `Definition (EN): ${def || ""}`,
    `Translation (JA): ${ja || ""}`,
    ...(ex ? [`Example: ${ex}`] : []),
  ];
  return lines.join("\n");
}

function safeTSV(s) {
  if (s == null) return "";
  const str = String(s);
  return str.replace(/\t/g, " ").replace(/\r?\n/g, " / ");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* =======================================================================
   DataBox — Decoupled glossary editor (LOCAL ONLY)
   - Controls live INSIDE the Glossary box (above the table)
   - Compact toggle (shrinks rows, hides CreatedAt)
   - Edit toggles contentEditable (except CreatedAt).
   - Edits are STAGED; "Save" commits them as one snapshot.
   - Undo/Redo restore previous saved snapshots (local only).
   ======================================================================= */
const DataBox = (() => {
  const HISTORY_KEY = "domainGlossary.history.v2";
  const MAX_HISTORY = 50;

  let editing = false;              // edit mode toggle
  let staged = Object.create(null); // { rowId: { field: value, ... } }
  let history = loadHistory();      // { undo: [snapshot], redo: [snapshot] }

  // Controls
  injectControls();
  updateButtons();

  function injectControls() {
    // Place controls above the table (outside the scroll area)
    const table = el.table;
    if (!table) return;

    const wrap = table.parentElement;                                   // .table-scroll (from Step 1)
    const box  = wrap?.parentElement || (table.closest(".card") ?? document.body);

    // Reuse if already present
    let host = box.querySelector("#glossaryControls");
    if (!host) {
      host = document.createElement("div");
      host.id = "glossaryControls";
      host.className = "glossary-controls";
      box.insertBefore(host, wrap);                                      // insert before the scroll wrapper
    }

    // Avoid duplicates on hot-reload
    if (host.querySelector("#btnEditMode")) return;

    // --- NEW: Compact toggle ---
    const btnCompact = document.createElement("button");
    btnCompact.id = "btnCompact";
    btnCompact.textContent = "Compact";
    btnCompact.title = "Toggle compact layout";
    btnCompact.addEventListener("click", () => {
      const scrollWrap = el.table?.parentElement;                        // .table-scroll
      if (scrollWrap) scrollWrap.classList.toggle("compact");
    });

    // Existing buttons
    const btnEdit = document.createElement("button");
    btnEdit.id = "btnEditMode";
    btnEdit.textContent = "Edit";
    btnEdit.title = "Toggle edit mode";
    btnEdit.addEventListener("click", () => {
      editing = !editing;
      btnEdit.textContent = editing ? "Done" : "Edit";
      wireTable();
      renderEditChip();
    });

    const btnSave = document.createElement("button");
    btnSave.id = "btnSave";
    btnSave.textContent = "Save";
    btnSave.title = "Save staged changes to the data box";
    btnSave.disabled = true;

    const btnUndo = document.createElement("button");
    btnUndo.id = "btnUndo";
    btnUndo.textContent = "Undo";
    btnUndo.title = "Undo last saved change";
    btnUndo.disabled = history.undo.length === 0;

    const btnRedo = document.createElement("button");
    btnRedo.id = "btnRedo";
    btnRedo.textContent = "Redo";
    btnRedo.title = "Redo last undone change";
    btnRedo.disabled = history.redo.length === 0;

    btnSave.addEventListener("click", onSave);
    btnUndo.addEventListener("click", onUndo);
    btnRedo.addEventListener("click", onRedo);

    // Order: Compact | Edit | Save | Undo | Redo
    host.appendChild(btnCompact);
    host.appendChild(btnEdit);
    host.appendChild(btnSave);
    host.appendChild(btnUndo);
    host.appendChild(btnRedo);
  }

  function updateButtons() {
    const btnSave = document.getElementById("btnSave");
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    if (btnSave) btnSave.disabled = Object.keys(staged).length === 0;
    if (btnUndo) btnUndo.disabled = history.undo.length === 0;
    if (btnRedo) btnRedo.disabled = history.redo.length === 0;
  }

  // Build a stable row id from visible row (word|sense|createdAt)
  function rowIdFromTr(tr) {
    const tds = [...tr.cells];
    const word = (tds[0]?.textContent || "").trim();
    const sense = (tds[1]?.textContent || "").trim();
    const createdAt = (tds[6]?.textContent || "").trim();
    return `${word}|||${sense}|||${createdAt}`;
  }

  function findGlossaryIndexById(id) {
    const [word, sense, createdAt] = id.split("|||");
    for (let i = 0; i < glossary.length; i++) {
      const r = glossary[i] || {};
      if ((r.word || "") === word && (r.sense || "") === sense && (r.createdAt || "") === createdAt) {
        return i;
      }
    }
    return -1;
  }

  // Validation (light & friendly; allows mnemonics)
  function validate(field, raw) {
    const trimmed = (raw || "").replace(/\s+/g, " ").trim();

    const required = {
      word: true,
      sense: false,
      definition_en: true,
      translation_ja: true,
      example_en: false,
      note: false,
    };

    if (required[field] && trimmed.length === 0) {
      return { ok: false, value: "", message: "Required" };
    }

    switch (field) {
      case "word":
      case "sense":
        if (trimmed.length > 80) return { ok: false, value: "", message: "≤ 80 chars" };
        return { ok: true, value: trimmed };

      case "definition_en":
        if (trimmed.length > 300) return { ok: false, value: "", message: "≤ 300 chars" };
        return { ok: true, value: trimmed };

      case "translation_ja":
        if (trimmed.length > 200) return { ok: false, value: "", message: "≤ 200 chars" };
        return { ok: true, value: trimmed };

      case "example_en": {
        if (!trimmed) return { ok: true, value: "" }; // allow blank
        // Allow mnemonics/collocations: up to 3 items, semicolon-separated, each ≤ 40 chars, one line
        const normalized = trimmed.replace(/\s*;\s*/g, ";");
        const parts = normalized.split(";").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 3) return { ok: false, value: "", message: "≤ 3 items separated by ';'" };
        if (parts.some((p) => p.length > 40)) return { ok: false, value: "", message: "Each ≤ 40 chars" };
        if (/\r|\n/.test(normalized)) return { ok: false, value: "", message: "One line only" };
        return { ok: true, value: parts.join("; ") };
      }

      case "note":
        if (!trimmed) return { ok: true, value: "" };
        if (trimmed.length > 160) return { ok: false, value: "", message: "≤ 160 chars" };
        if (/\r|\n/.test(trimmed)) return { ok: false, value: "", message: "One line only" };
        return { ok: true, value: trimmed };

      default:
        return { ok: true, value: trimmed };
    }
  }

  // Turn current table into editors (no save on blur — just stage)
  function wireTable() {
    const table = el.table;
    const tbody = table?.querySelector("tbody");
    if (!tbody) return;

    // Ensure controls are present even after initial render
    if (!document.getElementById("glossaryControls")) injectControls();

    // Clean any previous staging markers
    [...tbody.querySelectorAll("td")].forEach((td) => {
      td.removeAttribute("data-databox-field");
      td.removeAttribute("data-databox-id");
      td.removeAttribute("title");
      td.classList.remove("cell-error");
      td.classList.remove("staged");
    });

    [...tbody.rows].forEach((tr) => {
      const id = rowIdFromTr(tr);
      const cells = [...tr.cells];

      // 0 Word | 1 Sense | 2 Def | 3 JA | 4 Example | 5 Note | 6 CreatedAt (read-only)
      cells.forEach((td, idx) => {
        const field =
          idx === 0 ? "word" :
          idx === 1 ? "sense" :
          idx === 2 ? "definition_en" :
          idx === 3 ? "translation_ja" :
          idx === 4 ? "example_en" :
          idx === 5 ? "note" :
          idx === 6 ? "createdAt" : null;

        if (!field) return;

        // Only columns 0..5 are editable and only in edit mode
        const editable = editing && field !== "createdAt";
        td.contentEditable = editable ? "true" : "false";
        td.spellcheck = false;

        // Tag the cell so we know what to stage
        td.dataset.databoxField = field;
        td.dataset.databoxId = id;

        if (!editable) {
          td.onfocus = null;
          td.onblur = null;
          td.onkeydown = null;
          return;
        }

        let originalText = td.textContent || "";

        td.onfocus = () => {
          originalText = td.textContent || "";
          td.classList.remove("cell-error");
          td.removeAttribute("title");
        };

        td.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            td.blur(); // stage change
          }
          if (e.key === "Escape") {
            e.preventDefault();
            td.textContent = originalText; // discard this edit
            td.blur();
          }
        };

        td.onblur = () => {
          const raw = (td.textContent || "").trim();
          const { ok, value, message } = validate(field, raw);
          if (!ok) {
            td.classList.add("cell-error");
            td.title = message || "Invalid value";
            td.textContent = originalText; // revert visual
            return;
          }

          // Stage if changed
          if (value !== originalText) {
            if (!staged[id]) staged[id] = {};
            staged[id][field] = value;
            td.classList.add("staged");
            updateButtons();
          } else {
            // If unchanged, clear any staged value for this cell
            if (staged[id]) {
              delete staged[id][field];
              if (Object.keys(staged[id]).length === 0) delete staged[id];
              td.classList.remove("staged");
              updateButtons();
            }
          }
        };
      });
    });

    // Hint under controls
    renderEditChip();
  }

  function renderEditChip() {
    const table = el.table;
    if (!table) return;

    const wrap = table.parentElement; // .table-scroll
    const box  = wrap?.parentElement || (table.closest(".card") ?? document.body);
    const host = box.querySelector("#glossaryControls") || box;

    let chip = document.getElementById("editModeChip");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "editModeChip";
      chip.className = "hint";
      host.appendChild(chip);
    }
    chip.textContent = editing
      ? "Edit mode: ON (Enter=stage, Save=commit, Esc=cancel cell)"
      : "";
  }

  function onSave() {
    if (Object.keys(staged).length === 0) return;
    // Snapshot BEFORE saving for Undo
    const before = JSON.parse(JSON.stringify(glossary));

    // Apply staged diffs
    const after = JSON.parse(JSON.stringify(glossary));
    for (const id of Object.keys(staged)) {
      const idx = findGlossaryIndexById(id);
      if (idx < 0) continue;
      const fields = staged[id];
      for (const f of Object.keys(fields)) {
        after[idx][f] = fields[f];
      }
    }

    // Commit to localStorage (no network)
    glossary = after;
    saveGlossary(glossary);

    // Push snapshot to history
    history.undo.push(before);
    if (history.undo.length > MAX_HISTORY) history.undo = history.undo.slice(-(MAX_HISTORY));
    history.redo = [];
    persistHistory();

    // Clear staged marks & rewire
    staged = Object.create(null);
    renderGlossaryTable(glossary);
    wireTable();
    updateButtons();
  }

  function onUndo() {
    if (history.undo.length === 0) return;
    const before = JSON.parse(JSON.stringify(glossary));
    const snapshot = history.undo.pop();
    history.redo.push(before);
    glossary = JSON.parse(JSON.stringify(snapshot));
    saveGlossary(glossary);
    persistHistory();
    staged = Object.create(null);
    renderGlossaryTable(glossary);
    wireTable();
    updateButtons();
    updateDomainFilterOptions(glossary);
  }

  function onRedo() {
    if (history.redo.length === 0) return;
    const before = JSON.parse(JSON.stringify(glossary));
    const snapshot = history.redo.pop();
    history.undo.push(before);
    glossary = JSON.parse(JSON.stringify(snapshot));
    saveGlossary(glossary);
    persistHistory();
    staged = Object.create(null);
    renderGlossaryTable(glossary);
    wireTable();
    updateButtons();
    updateDomainFilterOptions(glossary);
  }

  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
      return {
        undo: Array.isArray(h.undo) ? h.undo : [],
        redo: Array.isArray(h.redo) ? h.redo : [],
      };
    } catch {
      return { undo: [], redo: [] };
    }
  }
  function persistHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    updateButtons();
  }

  // Public API used by outer app
  return {
    wireTable,              // call after table render
    refreshAfterExternalChange() {
      // Called after addToGlossary / clear-all, etc.
      staged = Object.create(null);
      renderGlossaryTable(glossary);
      wireTable();
      updateButtons();
    },
  };
})();

// Make sure DataBox wiring runs once after initial render
DataBox.wireTable();