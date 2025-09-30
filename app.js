// app.js — Domain Glossary (Online)
// Clean build with Related Forms + suggestions + glossary (localStorage)

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
};

const STORAGE_KEY = "domainGlossary.v1";

let glossary = loadGlossary();
renderGlossaryTable(glossary);
updateDomainFilterOptions(glossary);

// -------------------------------
// Network badge
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
setOnlineBadge();
window.addEventListener("online", setOnlineBadge);
window.addEventListener("offline", setOnlineBadge);

// -------------------------------
// Events
// -------------------------------
el.btnSearch.addEventListener("click", onSearch);
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSearch();
});

el.btnDownloadTSV.addEventListener("click", downloadTSV);
el.btnClearAll.addEventListener("click", () => {
  if (!confirm("Delete all saved glossary items on this device?")) return;
  glossary = [];
  saveGlossary(glossary);
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
});

el.filterText.addEventListener("input", () => renderGlossaryTable(glossary));
el.filterDomain.addEventListener("change", () => renderGlossaryTable(glossary));
el.btnResetFilters.addEventListener("click", () => {
  el.filterText.value = "";
  el.filterDomain.value = "";
  renderGlossaryTable(glossary);
});

// -------------------------------
// Search + Render
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
// Results rendering
// -------------------------------
function renderResults(typedTerm, data) {
  // Header notices (misspelling / suggestions)
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
    // attach click handlers for chips
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
  genCard.appendChild(kv("Example", data?.general?.example_en || "—"));

  // Related forms (inside General card)
  renderRelatedForms(genCard, data.related_forms);

  // Actions
  genCard.appendChild(actionRow({
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
    }
  }));

  genCard.appendChild(copyRow(() =>
    textBlock({
      word: data.headword || typedTerm,
      sense: "General",
      def: data?.general?.definition_en,
      ja: data?.general?.translation_ja,
      ex: data?.general?.example_en
    })
  ));

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
    card.appendChild(kv("Example", d.example_en || "—"));
    if (d.note) card.appendChild(kv("Note", d.note));

    card.appendChild(actionRow({
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
      }
    }));

    card.appendChild(copyRow(() =>
      textBlock({
        word: data.headword || typedTerm,
        sense: d.domain,
        def: d.definition_en,
        ja: d.translation_ja,
        ex: d.example_en
      })
    ));

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
// Glossary (localStorage)
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
}

function renderGlossaryTable(data) {
  const tbody = el.table.querySelector("tbody");
  tbody.innerHTML = "";

  const ft = (el.filterText.value || "").toLowerCase();
  const fd = el.filterDomain.value || "";

  data
    .filter((row) => {
      const hay = `${row.word} ${row.sense} ${row.definition_en} ${row.translation_ja} ${row.example_en}`.toLowerCase();
      const passText = !ft || hay.includes(ft);
      const passDomain = !fd || row.sense === fd;
      return passText && passDomain;
    })
    .forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(td(row.word));
      tr.appendChild(td(row.sense));
      tr.appendChild(td(row.definition_en));
      tr.appendChild(td(row.translation_ja));
      tr.appendChild(td(row.example_en || ""));
      tr.appendChild(td(row.note || ""));
      tbody.appendChild(tr);
    });
}

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
    `Example: ${ex || ""}`,
  ];
  return lines.join("\n");
}

function td(text) {
  const cell = document.createElement("td");
  cell.textContent = text ?? "";
  return cell;
}

function safeTSV(s) {
  if (s == null) return "";
  const str = String(s);
  // Replace newlines and tabs to keep cells intact
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
