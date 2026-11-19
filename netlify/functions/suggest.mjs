// AI starter suggestions for the ATL workshop (Leading AI Transformation in Legal Practice).
// POST /ai/suggest  { kind: "hate" | "hmw" | "needs" | "feels" | "analogy", ctx: {...} }  ->  { items: [...] }
// Needs the ANTHROPIC_API_KEY environment variable in Netlify. Without it (or with AI_SUGGESTIONS=off) it answers 503
// and the page quietly carries on without suggestions. Nothing is stored: text is sent to the API and the reply returned.
export const config = { path: "/ai/suggest" };

const env = (k) => (typeof Netlify !== "undefined" && Netlify.env ? Netlify.env.get(k) : process.env[k]);
const clip = (v, n = 600) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const list = (a, n = 12) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => clip(x, 300)).filter(Boolean);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const SYSTEM = "You help lawyers in an executive education design-thinking workshop on leading AI transformation in legal practice. " +
  "Write like a candid, thoughtful law-firm leader, in plain words, concrete and specific to the situation given. No hype, no jargon, no preamble. " +
  "Reply with ONLY valid JSON, exactly in the shape requested.";

function prompt(kind, c) {
  const ch = clip(c.challenge), pain = clip(c.pain), hmw = clip(c.hmw), who = clip(c.persona);
  switch (kind) {
    case "hate":
      return `A team is working on this AI transformation challenge at their law firm: "${ch}".\nStatements they already have: ${JSON.stringify(list(c.existing))}.\n` +
        `Suggest 3 NEW, different frustrations that complete the sentence "I hate it that…". Write only the part after "I hate it that", one sentence each, in the first person plural or singular.\nReturn a JSON array of 3 strings.`;
    case "hmw":
      return `Challenge: "${ch}".\nThe team's chosen frustration: "I hate it that ${pain}".\n` +
        `Suggest 3 different "How might we…" questions that reframe it as an opportunity. Each is one sentence starting with "How might we", concrete and not a disguised solution.\nReturn a JSON array of 3 strings.`;
    case "needs":
      return `Challenge: "${ch}".\nEnd user: "${who}".\nTheir pain points: ${JSON.stringify(list(c.pains))}.\nNeeds already listed: ${JSON.stringify(list(c.have))}.\n` +
        `Suggest 3 NEW needs that complete "needs a way to…". Start each with a verb, describe what the person needs (not a product or solution).\nReturn a JSON array of 3 strings.`;
    case "feels":
      return `Challenge: "${ch}".\nEnd user: "${who}".\nTheir needs: ${JSON.stringify(list(c.needs))}.\nFeelings already listed: ${JSON.stringify(list(c.have))}.\n` +
        `Suggest 3 NEW feelings or motivators that complete "in a way that makes them feel…" (for example "confident that…"). Each is a short phrase.\nReturn a JSON array of 3 strings.`;
    case "analogy":
      return `A team is designing a solution to this problem at a law firm.\nChallenge: "${ch}".\nProblem as reframed: "${hmw}".\nEnd user: "${who}".\n` +
        `Suggest 4 well-known consumer products, companies or services OUTSIDE law whose way of working is genuinely instructive for this problem. Do not use Amazon Prime, Uber, Netflix or coffee shops. Pick varied ones.\n` +
        `For each give: "name" (short), "why" (one sentence on why it is relevant to THIS problem), and "attrs" (3 specific attributes that make it great, each a short phrase).\nReturn a JSON array of 4 objects with keys name, why, attrs.`;
  }
  return null;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = env("ANTHROPIC_API_KEY");
  if (!key || env("AI_SUGGESTIONS") === "off") return json({ error: "suggestions are off" }, 503);
  let body;
  try { const t = await req.text(); if (t.length > 8000) return json({ error: "too large" }, 413); body = JSON.parse(t); } catch { return json({ error: "bad request" }, 400); }
  const p = prompt(body.kind, body.ctx || {});
  if (!p) return json({ error: "unknown kind" }, 400);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env("ANTHROPIC_MODEL") || "claude-haiku-5-5", max_tokens: 700, system: SYSTEM, messages: [{ role: "user", content: p }] }),
      signal: AbortSignal.timeout(14000)
    });
    if (!r.ok) return json({ error: "upstream " + r.status }, 502);
    const d = await r.json();
    const text = ((d.content || []).find((b) => b.type === "text") || {}).text || "";
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    let items = m ? JSON.parse(m[0]) : null;
    if (!Array.isArray(items)) return json({ error: "unparseable" }, 502);
    items = body.kind === "analogy"
      ? items.slice(0, 4).map((x) => ({ name: clip(x.name, 60), why: clip(x.why, 240), attrs: list(x.attrs, 4) })).filter((x) => x.name)
      : items.slice(0, 3).map((x) => clip(x, 300)).filter(Boolean);
    return json({ items });
  } catch (e) {
    return json({ error: "failed" }, 502);
  }
};
