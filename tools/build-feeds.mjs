#!/usr/bin/env node
/* Jobs & Field — feed builder (Lean App 4 of 7, Phase 2 data merge).
 *
 * Reads the LIVE source systems read-only and writes trimmed, crew-safe
 * JSON feeds into docs/feeds/ (served by GitHub Pages, CORS-open, so the
 * Jobs & Field shell — and later Sharma Home / Sharma Track / Finance —
 * can read them natively).
 *
 * Sources:
 *   Permits    GET https://sharma-permits.sharma-crew.workers.dev/api/permits
 *   Punch      GET https://sharma-punch.sharma-crew.workers.dev/api/bootstrap
 *   Schedule   ~/workspace/sharma-office-tv/docs/data.json (the file the
 *              My Day <-> Office TV paired sync keeps current)
 *   Trackers   the local tracker repos (checklist cards + seed-photos.json),
 *              same parsing as the push trigger checker.
 *
 * Hard rules:
 *   - NO money/billing fields, NO portal usernames, NO share/submit tokens
 *     ever enter a feed. Feeds are allow-listed field by field.
 *   - Nothing is invented: a house/feed only states what a source states.
 *   - Read-only against every live system. Safe to run any time.
 *
 * Run: node tools/build-feeds.mjs   (writes docs/feeds/*.json)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(ROOT, "docs", "feeds");
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Sharma Jobs&Field feed builder)" } };

const PERMITS_API = "https://sharma-permits.sharma-crew.workers.dev/api/permits";
const PUNCH_API = "https://sharma-punch.sharma-crew.workers.dev/api/bootstrap";
const TV_DATA = "/home/hatch/workspace/sharma-office-tv/docs/data.json";

const TRACKERS = [
  { app: "crew",   name: "Crew — Z Brothers", dir: "/home/hatch/workspace/github-migration/sharmatrack-crew",   live: "https://sharmaelechvac.github.io/sharmatrack-crew/" },
  { app: "exj",    name: "EXJ Root",          dir: "/home/hatch/workspace/github-migration/exj-root-tracker",  live: "https://sharmaelechvac.github.io/exj-root-tracker/" },
  { app: "nok",    name: "NOK Construction",  dir: "/home/hatch/workspace/github-migration/sharmatrack-nok",    live: "https://sharmaelechvac.github.io/sharmatrack-nok/" },
  { app: "logan",  name: "Logan Construction",dir: "/home/hatch/workspace/github-migration/sharmatrack-logan", live: "https://sharmaelechvac.github.io/sharmatrack-logan/" },
  { app: "mrcela", name: "MRCELA",            dir: "/home/hatch/workspace/github-migration/sharmatrack-mrcela",live: "https://sharmaelechvac.github.io/sharmatrack-mrcela/" },
  { app: "brross", name: "BR Ross Construction", dir: "/home/hatch/workspace/sharmatrack-brross-app",          live: "https://sharmaelechvac.github.io/sharmatrack-brross/" },
];

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function save(name, v) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), JSON.stringify(v, null, 1));
  console.log("wrote docs/feeds/" + name);
}
async function getJSON(url) {
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
  return r.json();
}
function loadJSON(p, fallback) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } }
function decodeEntities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

/* ---------------- trackers: stage + photos per house ---------------- */
function parseCards(html) {
  const cards = [];
  const chunks = html.split('<div class="capcard"');
  for (const chunk of chunks.slice(1)) {
    const idM = chunk.match(/^\s+id="([rt]cap-\d+)"/);
    const capM = chunk.match(/<span class="cap">([\s\S]*?)<\/span>/);
    if (!idM || !capM) continue;
    cards.push({ cardId: idM[1], phase: idM[1][0] === "r" ? "rough" : "trim",
                 label: decodeEntities(capM[1].replace(/<[^>]+>/g, "")) });
  }
  return cards;
}
function trackerFeed() {
  const editions = [];
  for (const t of TRACKERS) {
    if (!existsSync(t.dir)) continue;
    const seed = loadJSON(path.join(t.dir, "seed-photos.json"), []);
    const seedArr = Array.isArray(seed) ? seed : [];
    const seeded = new Set(seedArr.map((p) => `${p.job}|${p.caption}`));
    const houses = [];
    for (const entry of readdirSync(t.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const page = path.join(t.dir, entry.name, "index.html");
      if (!existsSync(page) || !statSync(page).isFile()) continue;
      const html = readFileSync(page, "utf8");
      if (!html.includes("capcard")) continue;
      const job = entry.name;
      const cards = parseCards(html);
      const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
      const label = titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, "")).replace(/\s*[|·—-]\s*SHARMATRACK.*$/i, "").replace(/^SHARMATRACK\s*[—·-]\s*/i, "") : job;
      let latest = null, photoCount = 0;
      for (const p of seedArr) {
        if (p.job !== job) continue;
        photoCount++;
        if (!latest || (p.taken_at || "") > (latest.taken_at || "")) {
          latest = { url: t.live + String(p.url || "").replace(/^\//, ""), caption: p.caption || "", takenAt: p.taken_at || "" };
        }
      }
      /* No stage %: seed captions are free-form photo captions, not the
         checklist card labels, so a "cards with a seed photo" ratio would
         misstate progress (it reads ~0% on active houses). Stage merges
         properly when each edition's tracker API photo state is read in
         Phase 2 step 2 — until then the feed carries counts + photos only. */
      houses.push({
        job, label, page: `${t.live}${job}/`,
        checklistCards: cards.length, photosSeeded: photoCount,
        latestPhoto: latest,
      });
    }
    if (houses.length) editions.push({ app: t.app, name: t.name, site: t.live, houses });
  }
  return { generatedAt: new Date().toISOString(), editions };
}

/* ---------------- main ---------------- */
const now = new Date().toISOString();
const today = etToday();
let permitsFeed = null, punchFeed = null;

try {
  const d = await getJSON(PERMITS_API);
  const permits = (d.permits || []).map((p) => ({
    number: p.permit_number || "", type: p.type || "", status: p.status || "",
    address: p.address || "", builder: p.builder || "", city: p.city || "", county: p.county || "",
    issuedDate: p.issued_date || "", expirationDate: p.expiration_date || "",
    nextAction: p.next_action || "", license: p.license_used || "",
    crewLink: p.crew_link || "", updatedAt: p.updated_at || "",
  }));
  permitsFeed = { generatedAt: now, source: PERMITS_API, count: permits.length, permits };
  save("permits.json", permitsFeed);
} catch (e) { console.error("permits feed FAILED:", e.message); }

try {
  const d = await getJSON(PUNCH_API);
  const openP = (d.punches || []).filter((p) => !["done", "verified", "completed"].includes(String(p.status || "").toLowerCase()));
  const openT = (d.tasks || []).filter((t) => !["done", "completed"].includes(String(t.status || "").toLowerCase()) && !t.completedAt);
  const houseById = Object.fromEntries((d.houses || []).map((h) => [h.id, h]));
  punchFeed = {
    generatedAt: now, source: PUNCH_API, sourceCounts: d.counts || null,
    counts: { houses: (d.houses || []).length, openPunches: openP.length, openTasks: openT.length },
    houses: (d.houses || []).map((h) => ({
      id: h.id, address: h.address || "", builder: h.builder || "", crew: h.crew || "",
      openPunches: openP.filter((p) => p.houseId === h.id).length,
      openTasks: openT.filter((t) => t.houseId === h.id).length,
    })),
    openPunches: openP.map((p) => ({
      id: p.id, houseId: p.houseId, house: (houseById[p.houseId] || {}).address || "",
      title: p.title || p.location || "", trade: p.trade || "", priority: p.priority || "",
      status: p.status || "", crew: p.crew || "", createdAt: p.createdAt || "",
    })),
    openTasks: openT.map((t) => ({
      id: t.id, houseId: t.houseId || "", house: t.houseId ? ((houseById[t.houseId] || {}).address || "") : "General",
      title: t.title || "", assignee: t.assignee || "", dueDate: t.dueDate || "", status: t.status || "",
    })),
  };
  save("punch.json", punchFeed);
} catch (e) { console.error("punch feed FAILED:", e.message); }

const track = trackerFeed();
track.generatedAt = now;
track.note = "Per-house checklist card counts and seeded photo activity, read from the tracker repos. No stage % is published: seed captions are free-form photo captions, not checklist labels, so a coverage ratio would misstate progress. Per-card photo state from each edition's tracker API merges in Phase 2 step 2.";
save("track-feed.json", track);

/* Finance: "job done -> bill it" signal. Tonight no source carries an
   explicit, readable done marker (tracker jobmeta reads empty for the
   sampled jobs and seed captions don't map to checklist cards), so the
   candidate list is honestly EMPTY rather than inferred. The feed lights
   up when the trackers' per-job status is merged in Phase 2 step 2. */
save("finance-done.json", {
  generatedAt: now,
  rule: "A house appears here only when a source system explicitly marks the job done. Candidates are for the office to verify — never an automatic bill.",
  candidates: [],
});

/* Home: Today summary for the Sharma Home Today tab. */
const tv = loadJSON(TV_DATA, {});
const sched = Array.isArray(tv.mySchedule) ? tv.mySchedule : [];
const ti = tv.todayInspections || {};
save("home-today.json", {
  generatedAt: now, date: today,
  scheduleToday: sched.filter((s) => s.date === today),
  scheduleUpcoming: sched.filter((s) => s.date > today),
  inspections: ti.date === today ? ti : { date: ti.date || "", entries: ti.entries || [], note: "todayInspections block is dated " + (ti.date || "?") },
  counts: {
    scheduleToday: sched.filter((s) => s.date === today).length,
    permitsTotal: permitsFeed ? permitsFeed.count : null,
    permitsIssued: permitsFeed ? permitsFeed.permits.filter((p) => p.status === "Issued").length : null,
    punchOpenItems: punchFeed ? punchFeed.counts.openPunches + punchFeed.counts.openTasks : null,
  },
});
console.log("feeds done for ET date", today);
