// api/define.js
// POST { term } -> JSON (general + academic domains + related forms)

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Read body (Vercel: req.body in prod; fallback stream in dev)
    const body = req.body ?? (await readJson(req));
    const term = (body?.term ?? body?.query ?? "").trim();

    if (!term) {
      return res.status(400).json({ error: "Missing 'term' (word or short phrase)" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    console.log("DEBUG API key loaded?", !!OPENAI_API_KEY, OPENAI_API_KEY?.slice(0, 12));

    if (!OPENAI_API_KEY) {
      console.warn("No OPENAI_API_KEY found — using mock response");
      return res.status(200).json(mockResponse(term));
    }

    // ---------- Prompt ----------
    const system = [
      "You are a concise learner's dictionary for university language teacher training.",
      "Return ONLY JSON (no markdown).",
      "Schema:",
      "{",
      '  "headword": string,',
      '  "corrected_to": string|null,',
      '  "did_you_mean": string[]|[],',
      '  "general": { "definition_en": string, "translation_ja": string },',
      '  "domains": [ { "domain": "Linguistics"|"Applied Linguistics"|"SLA"|"Psychology", "definition_en": string, "translation_ja": string } ],',
      '  "related_forms": [ { "form": string, "pos": string, "ja_gloss": string } ]',
      "}",
      "",
      "- Keep English definitions ≤ 25 words, paraphrased.",
      "- Japanese translations must be short and direct.",
      "- All everyday senses (e.g. 関心, 興味, 利息) go in GENERAL.",
      "- Domains only include specialist academic senses in Linguistics / Applied Linguistics / SLA / Psychology (max 3).",
      "- If misspelling is obvious, set corrected_to; else null.",
      "- did_you_mean may list up to 3 close alternatives.",
    ].join("\n");

    const user = `TERM: ${JSON.stringify(term)}`;

    // ---------- Call OpenAI ----------
const resp = await fetch(
  `https://api.openai.com/v1/chat/completions`,
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }
);
    if (!resp.ok) {
      const text = await resp.text();
      console.error("DEBUG OpenAI error:", text);
      return res.status(resp.status).json({ error: "OpenAI error", detail: text });
    }

    const data = await resp.json();
    console.log("DEBUG raw OpenAI response:", JSON.stringify(data, null, 2));

    const content = data?.choices?.[0]?.message?.content || "{}";
    const out = safeParseJson(content) ?? {};

    // ---------- Shape result for UI ----------
    const shaped = {
      headword: out.headword ?? term,
      corrected_to: out.corrected_to ?? null,
      did_you_mean: Array.isArray(out.did_you_mean) ? out.did_you_mean.slice(0, 3) : [],
      general: {
        definition_en: out?.general?.definition_en ?? "",
        translation_ja: out?.general?.translation_ja ?? "",
      },
      domains: Array.isArray(out.domains)
        ? out.domains
            .filter(d => d && d.domain && d.definition_en)
            .slice(0, 3)
            .map(d => ({
              domain: d.domain,
              definition_en: d.definition_en ?? "",
              translation_ja: d.translation_ja ?? "",
            }))
        : [],
      related_forms: Array.isArray(out.related_forms)
        ? out.related_forms.map(r => ({
            form: r.form ?? "",
            pos: r.pos ?? "",
            ja_gloss: r.ja_gloss ?? (r.ja ?? ""),
          }))
        : [],
    };

    return res.status(200).json(shaped);
  } catch (err) {
    console.error("DEBUG handler error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

// ---------- helpers ----------
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

// Fallback if API key missing
function mockResponse(term) {
  return {
    headword: term,
    corrected_to: null,
    did_you_mean: [],
    general: {
      definition_en: `A concise learner-style meaning of "${term}".`,
      translation_ja: "簡潔な定義。",
    },
    domains: [],
    related_forms: [],
  };
}