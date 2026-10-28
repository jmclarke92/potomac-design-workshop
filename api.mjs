// Storage + facilitator API for the Potomac Law Group workshop.
// Runs as a Netlify Function (v2 syntax) and keeps data in Netlify Blobs.
//
//   GET  /api/ping
//   GET  /api/admin/groups               facilitator: list groups + progress     (x-admin-pin header)
//   PUT  /api/admin/config               facilitator: save group setup           (x-admin-pin header)
//   GET  /api/admin/groups/:id           facilitator: one group, with drawings   (x-admin-pin header)
//   GET  /api/groups/:id?k=KEY           group: setup + saved work               (group key)
//   PUT  /api/groups/:id/state?k=KEY     group: save work                        (group key)
//   GET  /api/groups/:id/img/:name?k=KEY group: saved drawing / whiteboard       (group key)
//   PUT  /api/groups/:id/img/:name?k=KEY group: save drawing / whiteboard        (group key)
import { getStore } from "@netlify/blobs";

export const config = { path: ["/api", "/api/*"] };

const env = (k) => (typeof Netlify !== "undefined" && Netlify.env ? Netlify.env.get(k) : process.env[k]);
const store = () => getStore({ name: "workshop", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const fail = (status, error) => json({ error }, status);

const MAX_STATE = 600_000; // characters of JSON per group
const MAX_IMAGE = 4_500_000; // characters of data URL per image
const IMAGE_NAMES = new Set(["drawing", "whiteboard"]);
const isId = (v) => /^\d{1,3}$/.test(String(v));
const clip = (v, n) => String(v ?? "").slice(0, n);
const newKey = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

const readConfig = async (s) => (await s.get("config", { type: "json" })) || { groups: [] };

const summary = (st) =>
  st
    ? {
        team: st.team && st.team.name ? String(st.team.name).slice(0, 120) : "",
        stage: Number(st.stage) || 0,
        maxStage: Number(st.maxStage) || 0,
        kind: st.d2 && st.d2.kind ? st.d2.kind : "",
        chosen: st.d2 && st.d2.chosen ? String(st.d2.chosen).slice(0, 400) : "",
        updatedAt: st.updatedAt || 0,
      }
    : {};

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const s = store();

  if (parts[0] === "ping") return json({ ok: true, adminConfigured: !!env("ADMIN_PIN") });

  /* ---------------- facilitator routes ---------------- */
  if (parts[0] === "admin") {
    const pin = env("ADMIN_PIN");
    if (!pin) return fail(500, "The ADMIN_PIN environment variable is not set on the server.");
    if (req.headers.get("x-admin-pin") !== pin) return fail(401, "Wrong PIN.");

    if (parts[1] === "groups" && parts.length === 2 && method === "GET") {
      const cfg = await readConfig(s);
      const groups = await Promise.all(
        cfg.groups.map(async (g) => {
          const st = await s.get(`group/${g.id}`, { type: "json" });
          return { id: g.id, key: g.key, talent: g.talent, client: g.client, state: summary(st) };
        })
      );
      return json({ groups });
    }

    if (parts[1] === "config" && parts.length === 2 && method === "PUT") {
      const text = await req.text();
      if (text.length > 200_000) return fail(413, "Too large.");
      let body;
      try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
      const incoming = Array.isArray(body.groups) ? body.groups.slice(0, 60) : [];
      const seen = new Set();
      const old = await readConfig(s);
      const groups = [];
      for (const g of incoming) {
        if (!isId(g.id) || seen.has(String(g.id))) continue;
        seen.add(String(g.id));
        const prev = old.groups.find((x) => String(x.id) === String(g.id));
        const key = /^[a-z0-9]{6,16}$/.test(g.key || "") ? g.key : prev ? prev.key : newKey();
        groups.push({ id: Number(g.id), key, talent: clip(g.talent, 600), client: clip(g.client, 600) });
      }
      groups.sort((a, b) => a.id - b.id);
      await s.setJSON("config", { groups, updatedAt: Date.now() });
      return json({ groups });
    }

    if (parts[1] === "groups" && parts.length === 3 && method === "GET" && isId(parts[2])) {
      const cfg = await readConfig(s);
      const g = cfg.groups.find((x) => String(x.id) === parts[2]);
      if (!g) return fail(404, "No such group.");
      const [state, drawing, whiteboard] = await Promise.all([
        s.get(`group/${g.id}`, { type: "json" }),
        s.get(`img/${g.id}/drawing`, { type: "text" }),
        s.get(`img/${g.id}/whiteboard`, { type: "text" }),
      ]);
      return json({ setup: { talent: g.talent, client: g.client }, state, drawing: drawing || "", whiteboard: whiteboard || "" });
    }
    return fail(404, "Not found.");
  }

  /* ---------------- group routes ---------------- */
  if (parts[0] === "groups" && isId(parts[1])) {
    const id = parts[1];
    const cfg = await readConfig(s);
    const g = cfg.groups.find((x) => String(x.id) === id);
    const k = url.searchParams.get("k") || "";
    if (!g || !k || g.key !== k) return fail(403, "This group link isn’t valid.");

    if (parts.length === 2 && method === "GET") {
      const state = await s.get(`group/${id}`, { type: "json" });
      return json({ setup: { talent: g.talent, client: g.client }, state });
    }

    if (parts[2] === "state" && parts.length === 3 && method === "PUT") {
      const text = await req.text();
      if (text.length > MAX_STATE) return fail(413, "Too large.");
      let body;
      try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid state.");
      body.updatedAt = Date.now();
      await s.setJSON(`group/${id}`, body);
      return json({ ok: true, updatedAt: body.updatedAt });
    }

    if (parts[2] === "img" && IMAGE_NAMES.has(parts[3]) && parts.length === 4) {
      const key = `img/${id}/${parts[3]}`;
      if (method === "GET") return json({ data: (await s.get(key, { type: "text" })) || "" });
      if (method === "PUT") {
        const text = await req.text();
        if (text.length > MAX_IMAGE + 100) return fail(413, "Image too large.");
        let body;
        try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
        const data = typeof body.data === "string" ? body.data : "";
        if (data === "") { await s.delete(key); return json({ ok: true }); }
        if (!data.startsWith("data:image/") || data.length > MAX_IMAGE) return fail(400, "Not an image.");
        await s.set(key, data);
        return json({ ok: true });
      }
    }
    return fail(404, "Not found.");
  }

  return fail(404, "Not found.");
};
