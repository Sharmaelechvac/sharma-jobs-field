# Jobs & Field — Lean App 4 of 7

One front door for the field at Sharma Electric & HVAC: **Jobs · Schedule ·
Permits · Inspections · Punch**. Crew use Jobs, Inspections and Punch;
office and Sanjay see all five tabs (device role, set on the More screen).

Live: https://sharmaelechvac.github.io/sharma-jobs-field/
(GitHub Pages from `main` `/docs`. Kit v1.3 shell — SK.stack, pull-to-refresh,
skeletons, last-data-first; LIGHT always, dark only via the Appearance switch;
navy #264387 / gold #F0A846; macOS sidebar look on wide screens via macos.css.)

## How it is wired (Phase 1 — front door)

No source system was replaced or modified. Each tab reads its live source:

| Tab | Source | How |
|---|---|---|
| Jobs | The six SHARMATRACK tracker editions | Merged feed (below) for houses/photos; each builder's tracker opens inside the app (Pages sites frame cleanly) with an "Open the full tracker" button. DNR opens full-screen (its repo isn't in the feed yet). |
| Schedule | Office TV `docs/data.json` (`mySchedule`, kept current by the My Day ↔ Office TV paired sync) | Fetched live from GitHub Pages (CORS-open). |
| Permits | Permit Tracker worker API | Merged feed — the worker sends frame-blocking headers and no CORS, so the tab renders the feed and deep-links the full app for edits. |
| Inspections | Office TV `docs/data.json` (`todayInspections`, kept current by the hourly known-inspections updater) | Fetched live; Inspection Prep deep-linked for prep detail. |
| Punch | Pending Projects (sharma-punch) worker API | Merged feed, same reason as Permits; full app deep-linked for marking items done. |

The hourly inspections updater, tracker photo flows and the crew app are
untouched — this app only reads.

## Feeds (Phase 2 — data merge, step 1)

`tools/build-feeds.mjs` (read-only against every source) writes
`docs/feeds/*.json`. Re-run it any time; a cron can refresh on the same
cadence as the data behind each feed.

| Feed | Contents | Consumer |
|---|---|---|
| `permits.json` | Permits, allow-listed fields only — **no billing/money fields, no portal usernames** | Jobs & Field Permits tab |
| `punch.json` | Houses, open punches, open tasks, counts — **no share/submit tokens** | Jobs & Field Punch tab |
| `track-feed.json` | Per-house checklist card counts, seeded photo counts and latest photo (absolute URLs) for 17 houses across 6 tracker editions | Jobs hub today; **Sharma Track** tomorrow |
| `home-today.json` | Today's schedule, upcoming schedule, today's inspections block, headline counts | **Sharma Home** Today tab |
| `finance-done.json` | "Job done → bill it" candidates | **Finance** |

Honesty rules baked into the generator:

- **No stage % is published.** Tracker seed captions are free-form photo
  captions, not checklist card labels, so a photo-coverage ratio would read
  ~0% on active houses and misstate progress. Stage merges for real when
  each edition's tracker API per-card photo state is read (Phase 2 step 2).
- **`finance-done.json` candidates are empty on purpose.** No source carries
  an explicit, readable "job done" marker tonight (tracker jobmeta reads
  empty for sampled jobs). The list lights up when a real marker exists —
  it is never inferred.

## Push (one of only 3 push apps)

Applied from the staged crew package (`~/workspace/sharma-push-track/`,
per its APPLY.md):

- `docs/push-track.js` + `docs/push-track.css` — the enable panel, mounted
  on the More screen with the app role. Rebranded to navy/gold for this app
  (the Track brand stays on Sharma Track itself). Crew role sees only
  **Crew schedule change for tomorrow** + **New punch items**; office/owner
  see their sets.
- Test button posts to the push worker's **`/test`** route (the
  reconciliation APPLY.md flagged: `/send` is secret-locked for the watcher
  scripts and is never called from a page).
- `docs/sw.js` — kit shell worker with the push + notificationclick
  listeners appended; cache behavior untouched. Fallback icon adjusted to
  this app's `icons/icon-192.png`, default title "Jobs & Field".
- The schedule_change / punch_items trigger checker (with baselines seeded
  2026-11-20) stays in `~/workspace/sharma-push-track/triggers/` and runs
  unchanged — its alerts deep-link into the source apps.
- End-to-end delivery still needs the push server live
  (`sharma-push.sharma-crew.workers.dev` was still 404 at build time) and a
  phone that has added Jobs & Field to its Home Screen and tapped Enable.
  The panel degrades gracefully until then.

## Redirects — plan, deliberately not executed tonight

Old links must keep working for weeks, so **nothing was redirected or
taken down**. When Sanjay/Mark say go, add a small "Moved to Jobs & Field"
stub (meta-refresh + a big button, old app fully intact underneath for one
release) to: the crew app hub, Permit Tracker, Inspection Prep and Pending
Projects. The tracker editions themselves are Sharma Track's to redirect,
not this app's — builders' links stay live regardless.

## Remaining

1. Phase 2 step 2: per-card photo state from each tracker edition's API →
   real stage % in `track-feed.json` and a real done signal for
   `finance-done.json`. Needs the editions' API shapes confirmed per repo.
2. DNR edition into the track feed (its app repo wasn't on this box —
   only NOTES.md — so it is a link card for now).
3. Feed refresh cron (suggest: permits/punch hourly 7 AM–7 PM ET alongside
   the inspections updater; track/home-today on the My Day morning rebuild
   and the 3×-daily Office TV sync).
4. Push server go-live + first phone test (see Push above).
5. Mark's design sign-off, then Sanjay's — including the role model
   (crew don't see Schedule/Permits tabs) and the Jobs-tab iframe viewers.
6. CORS/frame-ancestors on the permits/inspect/punch workers would let
   those tabs embed the full apps later — that's a server change for
   Steve's review, not done here.
