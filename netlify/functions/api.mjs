// Storage + facilitator API for the Potomac Law Group workshop.
// Runs as a Netlify Function (v2 syntax) and keeps data in Netlify Blobs.
//
//   GET  /api/ping                       also reports which workshop version is active (version, or null)
//   GET  /api/admin/groups               facilitator: list groups + progress     (x-admin-pin header)
//   PUT  /api/admin/config               facilitator: save group setup           (x-admin-pin header)
//   GET  /api/admin/groups/:id           facilitator: one group, with drawings   (x-admin-pin header)
//   DELETE /api/admin/groups/:id         facilitator: remove a group AND its saved work (x-admin-pin header)
//   POST /api/admin/reset                facilitator: erase everything (new session)    (x-admin-pin header)
//   PUT  /api/admin/version              facilitator: choose the workshop version        (x-admin-pin header)
//   GET  /api/people                     Seyfarth: names on the pre-arranged roster, for the worksheet QR page (names only)
//   PUT  /api/people                     Seyfarth: a participant saves their challenge(s) from their phone
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

// Workshop versions that run live (saved work, group links, facilitator view).
// To make another version live, add its id here AND set live: true in the page's VERSIONS list.
const LIVE_VERSIONS = new Set(["plg2", "sey"]);

/* Seyfarth: groups are pre-arranged with a roster of names. Each person saves their own challenge(s) from the worksheet QR page.
   A person is stored under person/<name>. Someone who is not on the roster can add themselves to a group ("extraGroup"). */
const MAX_MEMBERS = 8;
const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slug = (v) => norm(v).replace(/ /g, "-").slice(0, 60);
const cleanNames = (arr) => {
  const out = [], seen = new Set();
  for (const n of Array.isArray(arr) ? arr : []) {
    const name = clip(n, 60).replace(/\s+/g, " ").trim();
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name)); out.push(name);
    if (out.length >= MAX_MEMBERS) break;
  }
  return out;
};
const listPersons = async (s) => {
  const { blobs } = await s.list({ prefix: "person/" });
  return (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
};
const personFor = (persons, name) => persons.find((p) => norm(p.name) === norm(name));
/* A group's members: its roster names, then anyone who added themselves to it. */
const membersOf = (g, persons) => {
  const out = (g.members || []).map((name) => {
    const p = personFor(persons, name);
    return { name, challenges: p ? p.challenges || [] : [], at: p ? p.at || 0 : 0, extra: false };
  });
  for (const p of persons) {
    if (String(p.extraGroup) === String(g.id) && !out.some((m) => norm(m.name) === norm(p.name)) && out.length < MAX_MEMBERS)
      out.push({ name: p.name, challenges: p.challenges || [], at: p.at || 0, extra: true });
  }
  return out;
};
const setupOf = async (s, cfg, g) =>
  versionOf(cfg) === "sey"
    ? { members: membersOf(g, await listPersons(s)) }
    : { talent: g.talent, client: g.client };

const readConfig = async (s) => (await s.get("config", { type: "json" })) || { groups: [] };
// The active version. A session saved before the picker existed has groups but no version: that was Potomac Day 2.
const versionOf = (cfg) => cfg.version || (cfg.groups && cfg.groups.length ? "plg2" : null);

const summary = (st) =>
  st
    ? {
        team: st.team && st.team.name ? String(st.team.name).slice(0, 120) : "",
        stage: Number(st.stage) || 0,
        maxStage: Number(st.maxStage) || 0,
        members: ((st.team && st.team.members) || []).map((m) => String((m && m.name) || "").trim().slice(0, 40)).filter(Boolean).slice(0, 8),
        kind: st.d2 && st.d2.kind ? st.d2.kind : "",
        hmw: st.sey && st.sey.hmw ? String(st.sey.hmw).slice(0, 300) : "",
        chosen: st.d2 && st.d2.chosen ? String(st.d2.chosen).slice(0, 400) : "",
        updatedAt: st.updatedAt || 0,
      }
    : {};

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  const s = store();

  if (parts[0] === "ping") {
    let version = null;
    try { version = versionOf(await readConfig(s)); } catch {}
    return json({ ok: true, adminConfigured: !!env("ADMIN_PIN"), version });
  }

  /* ---------------- worksheet QR page (Seyfarth) ---------------- */
  if (parts[0] === "people" && parts.length === 1) {
    const cfg = await readConfig(s);
    if (versionOf(cfg) !== "sey") return fail(404, "This isn’t open right now.");
    const persons = await listPersons(s);
    if (method === "GET") {
      const people = [];
      for (const g of cfg.groups) for (const m of membersOf(g, persons)) people.push({ name: m.name, group: g.id, done: m.challenges.length > 0 });
      return json({ people, groups: cfg.groups.map((g) => g.id) });
    }
    if (method === "PUT") {
      const text = await req.text();
      if (text.length > 6000) return fail(413, "Too large.");
      let body;
      try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
      const name = clip(body && body.name, 60).replace(/\s+/g, " ").trim();
      const challenges = (Array.isArray(body && body.challenges) ? body.challenges : []).map((c) => clip(c, 500).trim()).filter(Boolean).slice(0, 2);
      if (!name) return fail(400, "Choose your name first.");
      if (!challenges.length) return fail(400, "Type your challenge first.");
      let extraGroup;
      const home = cfg.groups.find((g) => (g.members || []).some((n) => norm(n) === norm(name)));
      if (!home) {
        const asked = cfg.groups.find((g) => String(g.id) === String(body.group));
        if (!asked) return fail(404, "That name isn’t on the list. Ask your facilitator.");
        const prev = personFor(persons, name);
        if (!prev && membersOf(asked, persons).length >= MAX_MEMBERS) return fail(409, "That group is full. Ask your facilitator.");
        extraGroup = prev && prev.extraGroup ? prev.extraGroup : asked.id;
      }
      const rec = { name, challenges, at: Date.now() };
      if (extraGroup !== undefined) rec.extraGroup = extraGroup;
      await s.setJSON(`person/${slug(name)}`, rec);
      return json({ ok: true });
    }
    return fail(405, "Not allowed.");
  }

  /* ---------------- facilitator routes ---------------- */
  if (parts[0] === "admin") {
    const pin = env("ADMIN_PIN");
    if (!pin) return fail(500, "The ADMIN_PIN environment variable is not set on the server.");
    if (req.headers.get("x-admin-pin") !== pin) return fail(401, "Wrong PIN.");

    if (parts[1] === "groups" && parts.length === 2 && method === "GET") {
      const cfg = await readConfig(s);
      const isSey = versionOf(cfg) === "sey";
      const persons = isSey ? await listPersons(s) : [];
      const groups = await Promise.all(
        cfg.groups.map(async (g) => {
          const st = await s.get(`group/${g.id}`, { type: "json" });
          if (isSey)
            return { id: g.id, key: g.key, roster: membersOf(g, persons).map((m) => ({ name: m.name, done: m.challenges.length > 0, extra: m.extra })), state: summary(st) };
          return { id: g.id, key: g.key, talent: g.talent, client: g.client, state: summary(st) };
        })
      );
      return json({ groups, version: versionOf(cfg) });
    }

    if (parts[1] === "version" && parts.length === 2 && method === "PUT") {
      let body;
      try { body = JSON.parse(await req.text()); } catch { return fail(400, "Invalid JSON."); }
      const version = body && body.version;
      if (!LIVE_VERSIONS.has(version)) return fail(400, "That version can’t run live yet.");
      const cfg = await readConfig(s);
      const current = versionOf(cfg);
      if (current && current !== version && cfg.groups.length) return fail(409, "Start a new session to change the version.");
      await s.setJSON("config", { ...cfg, groups: cfg.groups, version, updatedAt: Date.now() });
      return json({ version });
    }

    if (parts[1] === "config" && parts.length === 2 && method === "PUT") {
      const text = await req.text();
      if (text.length > 200_000) return fail(413, "Too large.");
      let body;
      try { body = JSON.parse(text); } catch { return fail(400, "Invalid JSON."); }
      const incoming = Array.isArray(body.groups) ? body.groups.slice(0, 60) : [];
      const seen = new Set();
      const old = await readConfig(s);
      const version = versionOf(old);
      if (incoming.length && !version) return fail(409, "Choose a workshop version first.");
      const groups = [];
      for (const g of incoming) {
        if (!isId(g.id) || seen.has(String(g.id))) continue;
        seen.add(String(g.id));
        const prev = old.groups.find((x) => String(x.id) === String(g.id));
        const key = /^[a-z0-9]{6,16}$/.test(g.key || "") ? g.key : prev ? prev.key : newKey();
        groups.push(version === "sey"
          ? { id: Number(g.id), key, members: cleanNames(g.members) }
          : { id: Number(g.id), key, talent: clip(g.talent, 600), client: clip(g.client, 600) });
      }
      groups.sort((a, b) => a.id - b.id);
      await s.setJSON("config", { groups, version, updatedAt: Date.now() });
      return json({ groups: groups.map((g) => ({ id: g.id, key: g.key })) });
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
      return json({ setup: await setupOf(s, cfg, g), state, drawing: drawing || "", whiteboard: whiteboard || "" });
    }
    if (parts[1] === "groups" && parts.length === 3 && method === "DELETE" && isId(parts[2])) {
      const id = parts[2];
      const cfg = await readConfig(s);
      const gone = cfg.groups.find((x) => String(x.id) === id);
      if (gone && versionOf(cfg) === "sey") {
        for (const p of await listPersons(s)) {
          if ((gone.members || []).some((n) => norm(n) === norm(p.name)) || String(p.extraGroup) === id) await s.delete(`person/${slug(p.name)}`);
        }
      }
      cfg.groups = cfg.groups.filter((x) => String(x.id) !== id);
      await s.setJSON("config", { ...cfg, version: versionOf(cfg), updatedAt: Date.now() });
      await Promise.all([s.delete(`group/${id}`), s.delete(`img/${id}/drawing`), s.delete(`img/${id}/whiteboard`)]);
      return json({ ok: true });
    }

    if (parts[1] === "reset" && parts.length === 2 && method === "POST") {
      await s.deleteAll();
      await s.setJSON("config", { groups: [], version: null, updatedAt: Date.now() });
      return json({ ok: true });
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
      return json({ setup: await setupOf(s, cfg, g), state, version: versionOf(cfg) });
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
