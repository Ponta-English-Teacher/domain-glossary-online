// === Google API initialization ===
let googleToken = null;

window.initGoogle = async function initGoogle() {
  // Wait for gapi
  await new Promise(resolve => {
    if (window.gapi) return resolve();
    const t = setInterval(() => { if (window.gapi) { clearInterval(t); resolve(); } }, 200);
  });

  // Load client
  await new Promise(resolve => gapi.load('client', resolve));

  // Init discovery docs
  await gapi.client.init({
    discoveryDocs: [
      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
      'https://sheets.googleapis.com/$discovery/rest?version=v4',
    ],
  });

  // Google Identity Services (OAuth)
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: window.GS_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
    callback: (tokenResponse) => {
      googleToken = tokenResponse.access_token;
      gapi.client.setToken({ access_token: googleToken }); // important
      console.log('✅ Logged in with Google');
    },
  });

  // Ensure we have an access token before API calls
  window.ensureGoogleAuth = function ensureGoogleAuth() {
    return new Promise((resolve) => {
      if (googleToken) return resolve(googleToken);
      tokenClient.requestAccessToken();
      const t = setInterval(() => {
        if (googleToken) { clearInterval(t); resolve(googleToken); }
      }, 200);
    });
  };
};

window.addEventListener('load', () => setTimeout(initGoogle, 500));

// ======================================================================
// Domain Glossary App
// ======================================================================
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

// Make table horizontally scrollable on small screens
(function setupGlossaryScroll(){
  const t = el.table; if (!t) return;
  const p = t.parentElement; if (!p) return;
  if (p.classList.contains("table-scroll")) return;
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  p.replaceChild(wrap, t);
  wrap.appendChild(t);
})();

const STORAGE_KEY = "domainGlossary.v1";
let glossary = loadGlossary();

// Wire basic events
el.btnSearch?.addEventListener("click", onSearch);
el.input?.addEventListener("keydown", (e) => { if (e.key === "Enter") onSearch(); });
document.querySelector("form")?.addEventListener("submit", (e) => { e.preventDefault(); onSearch(); });

el.btnDownloadTSV?.addEventListener("click", downloadTSV);
el.btnClearAll?.addEventListener("click", () => {
  if (!confirm("Delete all saved glossary items on this device?")) return;
  glossary = [];
  saveGlossary(glossary);
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  DataBox.refreshAfterExternalChange();
});

el.filterText?.addEventListener("input", () => renderGlossaryTable(glossary));
el.filterDomain?.addEventListener("change", () => renderGlossaryTable(glossary));
el.btnResetFilters?.addEventListener("click", () => {
  if (el.filterText) el.filterText.value = "";
  if (el.filterDomain) el.filterDomain.value = "";
  renderGlossaryTable(glossary);
});

// First render
try {
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  setOnlineBadge();
} catch (e) {
  console.error("Initial render error:", e);
}

// Online badge
function setOnlineBadge() {
  if (!el.netBadge) return;
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
// Search (unchanged behavior)
// -------------------------------
async function onSearch() {
  const term = (el.input?.value || "").trim();
  clearResults();
  if (!term) return showError("Please type a word or short phrase.");
  try {
    const resp = await fetch("/api/define", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term }),
    });
    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    renderResults(term, data);
  } catch (err) {
    console.error(err);
    showError(String(err?.message || err));
  }
}

function clearResults() { if (el.results) el.results.innerHTML = ""; }
function showError(msg) {
  if (!el.results) return;
  const div = document.createElement("div");
  div.className = "card error";
  div.textContent = `Error: ${msg}`;
  el.results.appendChild(div);
}

// -------------------------------
// Results rendering (save to localStorage only)
// -------------------------------
function renderResults(typedTerm, data) {
  if (!el.results) return;

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
  if (Array.isArray(data.synonyms) && data.synonyms.length) genCard.appendChild(kv("Synonyms", data.synonyms.join(", ")));
  if (Array.isArray(data.antonyms) && data.antonyms.length) genCard.appendChild(kv("Antonyms", data.antonyms.join(", ")));
  renderRelatedForms(genCard, data.related_forms);

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
// localStorage Glossary
// -------------------------------
function loadGlossary() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveGlossary(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function addToGlossary(item) {
  glossary.push({ ...item, createdAt: new Date().toISOString() });
  saveGlossary(glossary);
  renderGlossaryTable(glossary);
  updateDomainFilterOptions(glossary);
  DataBox.refreshAfterExternalChange();
}

// -------------------------------
// Table rendering
// -------------------------------
const FIELDS = ["word", "sense", "definition_en", "translation_ja", "example_en", "note"];

function renderGlossaryTable(data) {
  const tbody = el.table?.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const ft = (el.filterText?.value || "").toLowerCase();
  const fd = el.filterDomain?.value || "";

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
    FIELDS.forEach((field) => {
      const cell = document.createElement("td");
      cell.textContent = row[field] ?? "";
      tr.appendChild(cell);
    });
    const created = document.createElement("td");
    created.textContent = row.createdAt || "";
    tr.appendChild(created);
    tbody.appendChild(tr);
  });

  DataBox.wireTable();
}

// -------------------------------
// Domain filter options
// -------------------------------
function updateDomainFilterOptions(data) {
  const sel = el.filterDomain; if (!sel) return;
  const keep = sel.value;
  const domains = [...new Set(data.map((r) => r.sense).filter(Boolean))].sort();

  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = ""; optAll.textContent = "All domains";
  sel.appendChild(optAll);

  domains.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  });

  sel.value = keep || "";
}

// -------------------------------
/* TSV Export */
// -------------------------------
function downloadTSV() {
  if (!glossary.length) return alert("No items in glossary.");
  const header = ["Word","Sense","Definition (EN)","Translation (JA)","Example","Note","CreatedAt"];
  const rows = glossary.map((r) => [
    r.word, r.sense, r.definition_en, r.translation_ja, r.example_en || "", r.note || "", r.createdAt || ""
  ]);
  const tsv = [header, ...rows].map((arr) => arr.map(safeTSV).join("\t")).join("\n");
  const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `glossary_${new Date().toISOString().slice(0, 10)}.tsv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ======================================================================
// Google Sheets integration
// ======================================================================

// Apply nicer design on new sheets
async function applySheetDesign(spreadsheetId, targetSheetId = 0) {
  await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        // Column widths A..G
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 140 }, fields: "pixelSize" }}, // A Word
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 120 }, fields: "pixelSize" }}, // B Sense
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 320 }, fields: "pixelSize" }}, // C Definition
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
            properties: { pixelSize: 240 }, fields: "pixelSize" }}, // D Translation
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 },
            properties: { pixelSize: 280 }, fields: "pixelSize" }}, // E Example
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 },
            properties: { pixelSize: 240 }, fields: "pixelSize" }}, // F Note
        { updateDimensionProperties: {
            range: { sheetId: targetSheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 },
            properties: { pixelSize: 180 }, fields: "pixelSize" }}, // G Created At

        // Wrap text in C..F for data rows
        { repeatCell: {
            range: { sheetId: targetSheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 6 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy"
        }},

        // Alternating row banding (includes header)
        { addBanding: {
            bandedRange: {
              range: { sheetId: targetSheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
              rowProperties: {
                headerColor: { red: 0.91, green: 0.94, blue: 0.99 },
                firstBandColor: { red: 0.98, green: 0.98, blue: 1.00 },
                secondBandColor: { red: 1.00, green: 1.00, blue: 1.00 }
              }
            }
        }},

        // Basic filter on header row
        { setBasicFilter: {
            filter: { range: { sheetId: targetSheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 } }
        }},
      ]
    }
  });
}

// Main send function (now with duplicate prevention)
async function sendGlossaryToGoogleSheets(className = "") {
  const glossaryRaw = localStorage.getItem("domainGlossary.v1");
  if (!glossaryRaw) return alert("No glossary data to send.");
  const list = JSON.parse(glossaryRaw);
  if (!list.length) return alert("Glossary is empty.");

  className = (className || "").trim();
  const spreadsheetTitle = className ? `Glossary Data – ${className}` : "Glossary Data";

  // 1) Find or create Spreadsheet
  const findRes = await gapi.client.drive.files.list({
    q: `name='${spreadsheetTitle}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  let spreadsheetId;
  let firstSheetId = 0;

  if (findRes.result.files && findRes.result.files.length > 0) {
    spreadsheetId = findRes.result.files[0].id;
  } else {
    // Create
    const createRes = await gapi.client.sheets.spreadsheets.create({
      properties: { title: spreadsheetTitle },
    });
    spreadsheetId = createRes.result.spreadsheetId;
    firstSheetId = createRes.result.sheets?.[0]?.properties?.sheetId ?? 0;

    // Rename first sheet to "Glossary"
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: firstSheetId, title: "Glossary" },
              fields: "title",
            },
          },
        ],
      },
    });

    // Header row
    const headers = [["Word","Sense","Definition (EN)","Translation (JA)","Example (EN)","Note","Created At"]];
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Glossary!A1:G1",
      valueInputOption: "RAW",
      resource: { values: headers },
    });

    // Style header + freeze + design
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: firstSheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.91, green: 0.94, blue: 0.99 }, textFormat: { bold: true } } },
              fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: firstSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      },
    });

    await applySheetDesign(spreadsheetId, firstSheetId);
  }

  // 2) Duplicate prevention — read existing Created At values
  const existingRes = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Glossary!G2:G",
  });
  const existingSet = new Set((existingRes.result.values || []).map(r => r[0]).filter(Boolean));

  // Build only NEW items
  const listWithIds = list.map(item => ({ ...item, createdAt: item.createdAt || new Date().toISOString() }));
  const newItems = listWithIds.filter(it => !existingSet.has(it.createdAt));

  if (newItems.length === 0) {
    alert("No new items to send (everything already in the Sheet).");
    return;
  }

  // 3) Append rows (chunked)
  const values = newItems.map(it => [
    it.word || "", it.sense || "", it.definition_en || "", it.translation_ja || "",
    it.example_en || "", it.note || "", it.createdAt
  ]);

  const CHUNK = 400;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Glossary!A2:G",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: chunk },
    });
  }

  alert(`✅ Sent ${values.length} new item(s) to “${spreadsheetTitle}”.`);
}

// -------------------------------
// Small helpers
// -------------------------------
function kv(label, value) {
  const row = document.createElement("div");
  row.className = "kv-row";
  const k = document.createElement("div"); k.className = "k"; k.textContent = label;
  const v = document.createElement("div"); v.className = "v"; v.textContent = value ?? "—";
  row.appendChild(k); row.appendChild(v);
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
    } catch { alert("Copy failed"); }
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
function safeTSV(s) { if (s == null) return ""; return String(s).replace(/\t/g, " ").replace(/\r?\n/g, " / "); }
function escapeHtml(s) { return String(s || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }

/* =======================================================================
   DataBox — inline editor for the glossary table (local only)
   ======================================================================= */
const DataBox = (() => {
  const HISTORY_KEY = "domainGlossary.history.v2";
  const MAX_HISTORY = 50;
  let editing = false;
  let staged = Object.create(null);
  let history = loadHistory();

  injectControls();
  updateButtons();

  function injectControls() {
    const table = el.table; if (!table) return;
    const wrap = table.parentElement;
    const box  = wrap?.parentElement || (table.closest(".card") ?? document.body);

    let host = box.querySelector("#glossaryControls");
    if (!host) {
      host = document.createElement("div");
      host.id = "glossaryControls";
      host.className = "glossary-controls";
      box.insertBefore(host, wrap);
    }
    if (host.querySelector("#btnEditMode")) return; // avoid duplicates

    // Compact
    const btnCompact = document.createElement("button");
    btnCompact.id = "btnCompact";
    btnCompact.textContent = "Compact";
    btnCompact.title = "Toggle compact layout";
    btnCompact.addEventListener("click", () => {
      const scrollWrap = el.table?.parentElement;
      if (scrollWrap) scrollWrap.classList.toggle("compact");
    });

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
    btnSave.title = "Save staged changes";
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

    host.appendChild(btnCompact);
    host.appendChild(btnEdit);
    host.appendChild(btnSave);
    host.appendChild(btnUndo);
    host.appendChild(btnRedo);

    // Class name input (persists)
    const classWrap = document.createElement("span");
    classWrap.style.marginLeft = "8px";
    const clsInput = document.createElement("input");
    clsInput.type = "text";
    clsInput.placeholder = "Class name (optional)";
    clsInput.value = localStorage.getItem("gs.className") || "";
    clsInput.style.minWidth = "14ch";
    clsInput.addEventListener("input", () => {
      localStorage.setItem("gs.className", clsInput.value.trim());
    });
    classWrap.appendChild(clsInput);
    host.appendChild(classWrap);

    // Send to Sheets button
    const btnSend = document.createElement("button");
    btnSend.id = "btnSendToSheets";
    btnSend.textContent = "Send to Google Spread.";
    btnSend.title = "Sign in and append your glossary to Google Sheets";
    btnSend.addEventListener("click", async () => {
      try {
        await ensureGoogleAuth();
        const className = (clsInput.value || "").trim();
        await sendGlossaryToGoogleSheets(className);
      } catch (err) {
        console.error(err);
        alert("Failed to send data to Google Sheets.");
      }
    });
    host.appendChild(btnSend);
  }

  function updateButtons() {
    const btnSave = document.getElementById("btnSave");
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    if (btnSave) btnSave.disabled = Object.keys(staged).length === 0;
    if (btnUndo) btnUndo.disabled = history.undo.length === 0;
    if (btnRedo) btnRedo.disabled = history.redo.length === 0;
  }

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
      if ((r.word || "") === word && (r.sense || "") === sense && (r.createdAt || "") === createdAt) return i;
    }
    return -1;
  }

  function validate(field, raw) {
    const trimmed = (raw || "").replace(/\s+/g, " ").trim();
    const required = { word: true, sense: false, definition_en: true, translation_ja: true, example_en: false, note: false };
    if (required[field] && trimmed.length === 0) return { ok: false, value: "", message: "Required" };

    switch (field) {
      case "word":
      case "sense": return trimmed.length > 80 ? { ok:false, value:"", message:"≤ 80 chars" } : { ok:true, value: trimmed };
      case "definition_en": return trimmed.length > 300 ? { ok:false, value:"", message:"≤ 300 chars" } : { ok:true, value: trimmed };
      case "translation_ja": return trimmed.length > 200 ? { ok:false, value:"", message:"≤ 200 chars" } : { ok:true, value: trimmed };
      case "example_en": {
        if (!trimmed) return { ok:true, value:"" };
        const normalized = trimmed.replace(/\s*;\s*/g, ";");
        const parts = normalized.split(";").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 3) return { ok:false, value:"", message:"≤ 3 items separated by ';'" };
        if (parts.some((p) => p.length > 40)) return { ok:false, value:"", message:"Each ≤ 40 chars" };
        if (/\r|\n/.test(normalized)) return { ok:false, value:"", message:"One line only" };
        return { ok:true, value: parts.join("; ") };
      }
      case "note":
        if (!trimmed) return { ok:true, value:"" };
        if (trimmed.length > 160) return { ok:false, value:"", message:"≤ 160 chars" };
        if (/\r|\n/.test(trimmed)) return { ok:false, value:"", message:"One line only" };
        return { ok:true, value: trimmed };
      default: return { ok:true, value: trimmed };
    }
  }

  function wireTable() {
    const table = el.table;
    const tbody = table?.querySelector("tbody");
    if (!tbody) return;

    if (!document.getElementById("glossaryControls")) injectControls();

    [...tbody.querySelectorAll("td")].forEach((td) => {
      td.removeAttribute("data-databox-field");
      td.removeAttribute("data-databox-id");
      td.removeAttribute("title");
      td.classList.remove("cell-error","staged");
    });

    [...tbody.rows].forEach((tr) => {
      const id = rowIdFromTr(tr);
      const cells = [...tr.cells];

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
        const editable = editing && field !== "createdAt";
        td.contentEditable = editable ? "true" : "false";
        td.spellcheck = false;
        td.dataset.databoxField = field;
        td.dataset.databoxId = id;

        if (!editable) { td.onfocus = td.onblur = td.onkeydown = null; return; }

        let originalText = td.textContent || "";
        td.onfocus = () => { originalText = td.textContent || ""; td.classList.remove("cell-error"); td.removeAttribute("title"); };
        td.onkeydown = (e) => {
          if (e.key === "Enter") { e.preventDefault(); td.blur(); }
          if (e.key === "Escape") { e.preventDefault(); td.textContent = originalText; td.blur(); }
        };
        td.onblur = () => {
          const raw = (td.textContent || "").trim();
          const { ok, value, message } = validate(field, raw);
          if (!ok) { td.classList.add("cell-error"); td.title = message || "Invalid value"; td.textContent = originalText; return; }
          if (value !== originalText) {
            if (!staged[id]) staged[id] = {};
            staged[id][field] = value;
            td.classList.add("staged");
            updateButtons();
          } else {
            if (staged[id]) { delete staged[id][field]; if (Object.keys(staged[id]).length === 0) delete staged[id]; td.classList.remove("staged"); updateButtons(); }
          }
        };
      });
    });

    renderEditChip();
  }

  function renderEditChip() {
    const table = el.table; if (!table) return;
    const wrap = table.parentElement;
    const box  = wrap?.parentElement || (table.closest(".card") ?? document.body);
    const host = box.querySelector("#glossaryControls") || box;

    let chip = document.getElementById("editModeChip");
    if (!chip) { chip = document.createElement("div"); chip.id = "editModeChip"; chip.className = "hint"; host.appendChild(chip); }
    chip.textContent = editing ? "Edit mode: ON (Enter=stage, Save=commit, Esc=cancel cell)" : "";
  }

  function onSave() {
    if (Object.keys(staged).length === 0) return;
    const before = JSON.parse(JSON.stringify(glossary));
    const after  = JSON.parse(JSON.stringify(glossary));
    for (const id of Object.keys(staged)) {
      const idx = findGlossaryIndexById(id);
      if (idx < 0) continue;
      const fields = staged[id];
      for (const f of Object.keys(fields)) after[idx][f] = fields[f];
    }
    glossary = after;
    saveGlossary(glossary);
    history.undo.push(before);
    if (history.undo.length > MAX_HISTORY) history.undo = history.undo.slice(-MAX_HISTORY);
    history.redo = [];
    persistHistory();
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
    saveGlossary(glossary); persistHistory();
    staged = Object.create(null);
    renderGlossaryTable(glossary); wireTable(); updateButtons(); updateDomainFilterOptions(glossary);
  }

  function onRedo() {
    if (history.redo.length === 0) return;
    const before = JSON.parse(JSON.stringify(glossary));
    const snapshot = history.redo.pop();
    history.undo.push(before);
    glossary = JSON.parse(JSON.stringify(snapshot));
    saveGlossary(glossary); persistHistory();
    staged = Object.create(null);
    renderGlossaryTable(glossary); wireTable(); updateButtons(); updateDomainFilterOptions(glossary);
  }

  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
      return { undo: Array.isArray(h.undo) ? h.undo : [], redo: Array.isArray(h.redo) ? h.redo : [] };
    } catch { return { undo: [], redo: [] }; }
  }
  function persistHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); updateButtons(); }

  return {
    wireTable,
    refreshAfterExternalChange() { staged = Object.create(null); renderGlossaryTable(glossary); wireTable(); updateButtons(); },
  };
})();
DataBox.wireTable();

// === Missing Example/Note filters (view-only) ===
(function(){
  const filters = document.querySelector(".filters");
  if (!filters) return;
  const wrap = document.createElement("div");
  wrap.className = "missing-filters";
  wrap.innerHTML = `
    <label class="chk"><input type="checkbox" id="onlyMissingExample"> Only missing Example</label>
    <label class="chk"><input type="checkbox" id="onlyMissingNote"> Only missing Note</label>
  `;
  filters.appendChild(wrap);

  const chkEx = document.getElementById("onlyMissingExample");
  const chkNote = document.getElementById("onlyMissingNote");
  const resetBtn = document.getElementById("btnResetFilters");

  function applyMissingFilters(){
    const tbody = document.querySelector("#glossaryTable tbody");
    if (!tbody) return;
    const wantExMissing = !!chkEx?.checked;
    const wantNoteMissing = !!chkNote?.checked;
    for (const tr of tbody.rows) {
      const example = (tr.cells[4]?.textContent || "").trim();
      const note    = (tr.cells[5]?.textContent || "").trim();
      const okEx   = !wantExMissing   || example === "";
      const okNote = !wantNoteMissing || note === "";
      tr.style.display = (okEx && okNote) ? "" : "none";
    }
  }

  chkEx?.addEventListener("change", applyMissingFilters);
  chkNote?.addEventListener("change", applyMissingFilters);
  resetBtn?.addEventListener("click", () => {
    if (chkEx) chkEx.checked = false;
    if (chkNote) chkNote.checked = false;
    setTimeout(applyMissingFilters, 0);
  });

  const tbody = document.querySelector("#glossaryTable tbody");
  if (tbody) new MutationObserver(() => applyMissingFilters()).observe(tbody, { childList: true });
  applyMissingFilters();
})();