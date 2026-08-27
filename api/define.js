// api/define.js
// POST { term } -> JSON (general + domains + synonyms/antonyms optional view-only)
// Returns collocation/phrase-style examples (not sentences) and a short note.
// If examples/notes fail validation, they are omitted entirely.

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body ?? (await readJson(req));
    const term = (body?.term ?? body?.query ?? "").trim();
    if (!term) {
      return res.status(400).json({ error: "Missing 'term' (word or short phrase)" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      console.warn("No OPENAI_API_KEY found — using mock response");
      return res.status(200).json(mockResponse(term));
    }

    // -------- Prompt: compact collocations, short notes; JSON only --------
    const system = [
      "You are a concise learner's dictionary for university language teacher training.",
      "Return ONLY JSON (no markdown).",
      "Schema:",
      "{",
      '  "headword": string,',
      '  "corrected_to": string|null,',
      '  "did_you_mean": string[]|[],',
      '  "general": {',
      '    "definition_en": string,',
      '    "translation_ja": string,',
      '    "example_en": string|undefined,     // semicolon-separated collocations/phrases; no sentences',
      '    "note": string|undefined            // one short tip',
      "  },",
      '  "domains": [',
      '    {',
      '      "domain": "Linguistics"|"Applied Linguistics"|"SLA"|"Psychology",',
      '      "definition_en": string,',
      '      "translation_ja": string,',
      '      "example_en": string|undefined,   // semicolon-separated collocations/phrases; no sentences',
      '      "note": string|undefined          // one short tip',
      "    }",
      "  ],",
      '  "word_family": [',
      '    {',
      '      "form": string,',
      '      "relation": "headword"|"base/stem"|"derivative"|"related form",',
      '      "pos": string,',
      '      "definition_en": string,',
      '      "translation_ja": string',
      '    }',
      "  ],",
      '  "synonyms": string[]|[],              // optional, view-only',
      '  "antonyms": string[]|[]               // optional, view-only',
      "}",
      "",
      "- English definitions ≤ 25 words; paraphrase.",
      "- Japanese translations are short, direct equivalents.",
      "- Everyday/common senses go in GENERAL.",
      "- Domains include only specialist academic senses (max 3).",
      "- If misspelling is obvious, set corrected_to; else null.",
      "- did_you_mean may list up to 3 alternatives.",
      "",
      "WORD FAMILY:",
      "- Include the most useful base/stem and derived forms (3–6 items).",
      "- Include the queried headword itself, labeled headword.",
      "- Include derivational forms (noun, verb, adjective, adverb, agent noun).",
      "- Do NOT include simple tense, participle, comparative, or plural forms (e.g. interpreted, interpreting, interpretations).",
      "- Include only common, useful forms; do not invent or include obscure formations.",
      "- Each definition_en is concise (≤18 words) and specific to that form.",
      "- translation_ja is a short, direct Japanese equivalent.",
      "- Use an empty array when no reliable word family exists.",
      "",
      "COLLOCATION/PHRASE EXAMPLES:",
      "- Output 1–3 collocations/short phrases, separated by semicolons ';'.",
      "- No full sentences. No leading 'For example'. No quotes.",
      "- Each phrase ≤ 4 words; must naturally include or pair with the headword.",
      "NOTES:",
      "- ONE short tip (≤80 chars): collocation, register, grammar, or confusion.",
      "- If unsure or unsuitable, omit example_en and/or note.",
    ].join("\n");

    const user = `TERM: ${JSON.stringify(term)}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("DEBUG OpenAI error:", text);
      return res.status(resp.status).json({ error: "OpenAI error", detail: text });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    const out = safeParseJson(content) ?? {};

    // -------- Validate & Shape --------
    const headword = out.headword || term;

    // General
    const rawGen = out?.general ?? {};
    const genExample = validateCollocations(rawGen.example_en, headword) || undefined;
    const genNote = validateNote(rawGen.note) || undefined;

    // Domains
    const domains = Array.isArray(out.domains) ? out.domains : [];
    const shapedDomains = domains
      .filter(
        (d) =>
          d &&
          typeof d.domain === "string" &&
          ["Linguistics", "Applied Linguistics", "SLA", "Psychology"].includes(d.domain) &&
          d.definition_en
      )
      .slice(0, 3)
      .map((d) => {
        const ex = validateCollocations(d.example_en, headword) || undefined;
        const note = validateNote(d.note) || undefined;
        return {
          domain: d.domain,
          definition_en: d.definition_en ?? "",
          translation_ja: d.translation_ja ?? "",
          example_en: ex,
          note,
        };
      });

    // View-only synonyms/antonyms (not saved to glossary)
    const synonyms = (Array.isArray(out.synonyms) ? out.synonyms : []).filter(isShortWord);
    const antonyms = (Array.isArray(out.antonyms) ? out.antonyms : []).filter(isShortWord);

    // Compact morphological word family for learner reference
    const rawWordFamily = Array.isArray(out.word_family) ? out.word_family : [];
    const wordFamily = rawWordFamily
      .filter((item) => item && typeof item.form === "string" && item.definition_en)
      .slice(0, 6)
      .map((item) => ({
        form: cleanShortText(item.form, 60),
        relation: ["headword", "base/stem", "derivative", "related form"].includes(item.relation)
          ? item.relation
          : "related form",
        pos: cleanShortText(item.pos, 30),
        definition_en: cleanShortText(item.definition_en, 180),
        translation_ja: cleanShortText(item.translation_ja, 100),
      }))
      .filter((item) => item.form && item.definition_en);
    const baseForms = wordFamily.filter((item) => item.relation === "base/stem").map((item) => item.form);
    for (let i = wordFamily.length - 1; i >= 0; i--) {
      const item = wordFamily[i];
      if (item.relation === "derivative" && baseForms.some((base) => isSimpleInflection(item.form, base))) {
        wordFamily.splice(i, 1);
      }
    }
    if (!wordFamily.some((item) => item.form.toLowerCase() === headword.toLowerCase())) {
      wordFamily.unshift({
        form: headword,
        relation: "headword",
        pos: cleanShortText(rawGen.pos, 30),
        definition_en: cleanShortText(rawGen.definition_en, 180),
        translation_ja: cleanShortText(rawGen.translation_ja, 100),
      });
    }
    wordFamily.splice(6);

    const shaped = {
      headword,
      corrected_to: out.corrected_to ?? null,
      did_you_mean: Array.isArray(out.did_you_mean) ? out.did_you_mean.slice(0, 3) : [],
      general: {
        definition_en: rawGen?.definition_en ?? "",
        translation_ja: rawGen?.translation_ja ?? "",
        example_en: genExample,
        note: genNote,
      },
      domains: shapedDomains,
      word_family: wordFamily,
      synonyms,
      antonyms,
    };

    return res.status(200).json(shaped);
  } catch (err) {
    console.error("DEBUG handler error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

/* ----------------- helpers ----------------- */

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return safeParseJson(raw) ?? {};
}

/**
 * Validate collocation/phrase lists like: "aptitude test; aptitude for languages"
 * Rules:
 * - 1–3 phrases separated by semicolons.
 * - Each phrase 1–4 words; no sentence punctuation; no quotes/bullets/emojis.
 * - Must include the headword (substring ok for phrases like "language aptitude").
 */
function validateCollocations(str, headword) {
  if (!str || typeof str !== "string") return null;
  const cleaned = str.replace(/\s*;\s*/g, ";").trim();
  if (!cleaned) return null;

  const parts = cleaned.split(";").map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;

  const hw = headword.toLowerCase();
  const ok = [];
  for (const p of parts) {
    if (/["'•\-*]/.test(p)) return null; // quotes/bullets
    if (/[.?!]$/.test(p)) return null;   // sentence-like
    if (/[…💡🔥😊👍]/.test(p)) return null;
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 4) return null;
    const contains =
      p.toLowerCase().includes(hw) ||
      hw.split(/\s+/).some((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(p));
    if (!contains) return null;
    ok.push(p);
  }
  return ok.join("; ");
}

function validateNote(note) {
  if (!note || typeof note !== "string") return null;
  const s = note.trim();
  if (!s) return null;
  if (s.length > 80) return null;
  // avoid full definitions/examples inside notes
  if (/^[A-Z].+?[:.].+/.test(s) && s.length > 60) return null;
  return s;
}

function isShortWord(s) {
  return typeof s === "string" && s.trim().length > 0 && s.trim().length <= 20 && !/[;,.]/.test(s);
}

function cleanShortText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function isSimpleInflection(form, base) {
  const f = form.toLowerCase();
  const b = base.toLowerCase();
  const variants = new Set([
    `${b}s`, `${b}es`, `${b}ed`, `${b}ing`,
    b.endsWith("e") ? `${b.slice(0, -1)}ing` : "",
    b.endsWith("e") ? `${b}d` : "",
  ]);
  return variants.has(f);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Fallback if API key missing
function mockResponse(term) {
  return {
    headword: term,
    corrected_to: null,
    did_you_mean: [],
    general: {
      definition_en: `A concise learner-style meaning of "${term}".`,
      translation_ja: "簡潔な定義。",
      example_en: `${term} test; ${term} for languages`,
      note: "Collocation: headword + for ~",
    },
    domains: [],
    word_family: [],
    synonyms: ["ability", "talent"],
    antonyms: ["inability"],
  };
}
