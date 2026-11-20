/* Jobs & Field (Lean App 4 of 7) — one front door for the field:
   Jobs · Schedule · Permits · Inspections · Punch.
   Kit v1.3 SK.stack shell. Phase 1: every tab is wired to the existing
   live apps/data — nothing here replaces a source system, and no source
   system was modified. Phase 2: the Permits/Punch tabs and the Jobs hub
   already read merged feed files (docs/feeds/*.json, built by
   tools/build-feeds.mjs from the live APIs); the Schedule/Inspections
   tabs read the Office TV data.json the paired sync keeps current.
   Roles: crew sees Jobs, Inspections, Punch (+ More). Office/Owner see
   all tabs. The role is a device setting (More screen) — the same soft
   gate the fleet's apps use today. */
(function () {
  "use strict";

  var TV_URL = "https://sharmaelechvac.github.io/sharma-office-tv/data.json";
  var FEED_TRACK = "feeds/track-feed.json";
  var FEED_PERMITS = "feeds/permits.json";
  var FEED_PUNCH = "feeds/punch.json";
  var PERMITS_APP = "https://sharma-permits.sharma-crew.workers.dev/";
  var INSPECT_APP = "https://sharma-inspect.sharma-crew.workers.dev/";
  var PUNCH_APP = "https://sharma-punch.sharma-crew.workers.dev/";
  var MYDAY_APP = "https://sharmaelechvac.github.io/sharma-my-day/";
  var HOME_APP = "https://sharmaelechvac.github.io/sharma-home/";
  var EXTRA_APPS = [
    { name: "DNR Contracting", sub: "Mukherjee Residence tracker", site: "https://sharmaelechvac.github.io/sharmatrack-dnr/" }
  ];

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function cached(key) { try { var v = lsGet("jf:cache:" + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function store(key, v) { lsSet("jf:cache:" + key, JSON.stringify(v)); }
  function fetchJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function etToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function fmtDay(iso) { /* "2026-11-20" -> "Fri, Nov 20" */
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(d);
  }
  function fmtStamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) + " ET";
  }
  function skeleton(title) {
    return '<div class="jf"><h1 class="sk-title">' + esc(title) + '</h1>' +
      '<div class="sk-skel"></div><div class="sk-skel"></div><div class="sk-skel"></div></div>';
  }
  function errCard(what) {
    return '<div class="jf"><div class="jf-empty">Could not load ' + esc(what) +
      ' — check your connection and pull to refresh.</div></div>';
  }
  function logoLead() {
    return '<a class="sk-header__logo" href="#/jobs" aria-label="Jobs & Field home">' +
      '<img src="https://sharma-kit.sharma-crew.workers.dev/assets/logo-white-header.png" alt="Sharma Electric & HVAC" width="103" height="20"></a>';
  }
  function backLead(label, href) {
    return '<a class="sk-header__btn sk-header__back" href="' + href + '" data-back>' +
      '<svg class="sk-icon"><use href="#i-chevron-left"/></svg>' + esc(label) + '</a>';
  }

  /* service worker: the app's own scope (the crew app's sk-init pattern —
     SK.registerSW would register at the domain root, wrong on Pages). */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    var base = location.pathname.replace(/[^/]*$/, "");
    navigator.serviceWorker.register(base + "sw.js", { scope: base }).catch(function () {});
  }

  /* ---------------- role ---------------- */
  var role = lsGet("jf:role") || "crew";
  if (["crew", "office", "owner"].indexOf(role) < 0) role = "crew";
  function isOffice() { return role === "office" || role === "owner"; }
  function applyRole() {
    document.querySelectorAll(".sk-tab[data-office]").forEach(function (t) {
      t.style.display = isOffice() ? "" : "none";
    });
  }

  /* ---------------- no-kit fallback ---------------- */
  if (!window.SK || !SK.stack) {
    var app = document.getElementById("app");
    if (app) {
      app.innerHTML = '<div class="sk-main jf"><h1 class="sk-title">Jobs &amp; Field</h1>' +
        '<div class="jf-list">' +
        '<a class="jf-row" href="https://sharmaelechvac.github.io/sharmatrack-crew/"><span class="jf-row__body"><span class="jf-row__title">Crew jobs</span><span class="jf-row__sub">SHARMATRACK crew app</span></span></a>' +
        '<a class="jf-row" href="' + INSPECT_APP + '"><span class="jf-row__body"><span class="jf-row__title">Inspection Prep</span></span></a>' +
        '<a class="jf-row" href="' + PUNCH_APP + '"><span class="jf-row__body"><span class="jf-row__title">Pending Projects / Punch</span></span></a>' +
        '<a class="jf-row" href="' + PERMITS_APP + '"><span class="jf-row__body"><span class="jf-row__title">Permit Tracker</span></span></a>' +
        '<a class="jf-row" href="' + MYDAY_APP + '"><span class="jf-row__body"><span class="jf-row__title">My Day — schedule</span></span></a>' +
        '</div></div>';
    }
    applyRole();
    return;
  }

  var nav = SK.stack("#app", { lead: logoLead(), title: "Jobs & Field" });
  var lastTrack = null, lastTV = null;

  /* Generic cached-first loader: renders the saved copy at once, then the
     fresh copy when it lands (kit last-data-first). PTR + tab re-entry
     both re-fetch. */
  function loader(page, cacheKey, url, render) {
    var hit = cached(cacheKey);
    if (hit) render(hit); else page.html(skeleton(pageTitle(page)));
    function load() {
      return fetchJSON(url).then(function (d) { store(cacheKey, d); render(d); return d; });
    }
    page.refreshable(load);
    page.onReveal = function () { load().catch(function () {}); };
    load().catch(function () { if (!hit) page.html(errCard(pageTitle(page))); });
    return load;
  }
  function pageTitle(page) { return page.key.charAt(0).toUpperCase() + page.key.slice(1); }

  /* ---------------- Jobs ---------------- */
  function editionLatest(ed) {
    var best = "";
    ed.houses.forEach(function (h) { if (h.latestPhoto && h.latestPhoto.takenAt > best) best = h.latestPhoto.takenAt; });
    return best;
  }
  function renderJobs(page, feed) {
    lastTrack = feed;
    var total = 0;
    feed.editions.forEach(function (ed) { total += ed.houses.length; });
    var h = '<div class="jf"><h1 class="sk-title">Jobs</h1>' +
      '<p class="jf-note">' + total + ' houses across ' + feed.editions.length +
      ' builders. Tap a builder to open its tracker right here.</p>';
    h += '<div class="jf-h">Builders</div><div class="jf-list">';
    feed.editions.forEach(function (ed) {
      var latest = editionLatest(ed);
      h += '<a class="jf-row" href="#/view/' + esc(ed.app) + '"><span class="jf-row__body">' +
        '<span class="jf-row__title">' + esc(ed.name) + '</span>' +
        '<span class="jf-row__sub">' + ed.houses.length + (ed.houses.length === 1 ? ' house' : ' houses') +
        (latest ? ' · last photo ' + fmtDay(latest.slice(0, 10)) : '') + '</span></span>' +
        '<span class="jf-row__chev">›</span></a>';
    });
    h += '</div><div class="jf-h">More trackers</div><div class="jf-list">';
    EXTRA_APPS.forEach(function (a) {
      h += '<a class="jf-row" href="' + a.site + '" target="_blank" rel="noopener"><span class="jf-row__body">' +
        '<span class="jf-row__title">' + esc(a.name) + '</span>' +
        '<span class="jf-row__sub">' + esc(a.sub) + ' — opens the full tracker</span></span>' +
        '<span class="jf-row__chev">›</span></a>';
    });
    h += '</div><p class="jf-updated">House and photo counts from the trackers, as of ' +
      fmtStamp(feed.generatedAt) + '. Photos and checklists themselves live in each builder\u2019s tracker.</p></div>';
    page.html(h);
  }
  function buildJobs(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    loader(page, "track", FEED_TRACK, function (d) { renderJobs(page, d); });
  }
  function openView(appKey) {
    function pushIt(feed) {
      var ed = null;
      (feed.editions || []).forEach(function (e) { if (e.app === appKey) ed = e; });
      if (!ed) { location.hash = "#/jobs"; return; }
      if (nav.find("view:" + appKey) >= 0) { nav.popTo(nav.find("view:" + appKey)); return; }
      nav.push("view:" + appKey, function (page) {
        page.setHeader({ lead: backLead("Jobs", "#/jobs"), title: ed.name, backHref: "#/jobs" });
        var h = '<div class="jf"><h1 class="sk-title">' + esc(ed.name) + '</h1>' +
          '<div class="jf-frame-wrap"><iframe class="jf-frame" src="' + esc(ed.site) +
          '" title="' + esc(ed.name) + ' tracker" loading="lazy"></iframe></div>' +
          '<a class="jf-btn" href="' + esc(ed.site) + '" target="_blank" rel="noopener">Open the full tracker</a>' +
          '<div class="jf-h">Houses</div><div class="jf-list">';
        ed.houses.forEach(function (hs) {
          h += '<a class="jf-row" href="' + esc(hs.page) + '" target="_blank" rel="noopener">' +
            (hs.latestPhoto ? '<img class="jf-thumb" src="' + esc(hs.latestPhoto.url) + '" alt="" loading="lazy">' : '') +
            '<span class="jf-row__body"><span class="jf-row__title">' + esc(hs.label) + '</span>' +
            '<span class="jf-row__sub">' + hs.checklistCards + ' checklist items · ' + hs.photosSeeded + ' photos' +
            (hs.latestPhoto ? ' · latest ' + fmtDay((hs.latestPhoto.takenAt || "").slice(0, 10)) : '') +
            '</span></span><span class="jf-row__chev">›</span></a>';
        });
        h += '</div><p class="jf-note">Checklists, photo uploads and job details run in the tracker itself — this door just brings it to one place.</p></div>';
        page.html(h);
      });
    }
    if (lastTrack) pushIt(lastTrack);
    else fetchJSON(FEED_TRACK).then(function (d) { store("track", d); pushIt(d); })
      .catch(function () { location.hash = "#/jobs"; });
  }

  /* ---------------- Schedule (office + owner) ---------------- */
  function renderSchedule(page, tv) {
    lastTV = tv;
    var today = etToday();
    var sched = (tv.mySchedule || []).filter(function (s) { return s.date >= today; });
    sched.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var h = '<div class="jf"><h1 class="sk-title">Schedule</h1>';
    var ti = tv.todayInspections || {};
    if ((ti.entries || []).length) {
      h += '<div class="jf-h">Inspections — ' + esc(fmtDay(ti.date || today)) + '</div>';
      ti.entries.forEach(function (e) {
        h += '<div class="jf-card"><p class="jf-card__title">' + esc(e.title || "") + '</p>' +
          '<p class="jf-note" style="margin:0">' + esc(e.type || "") +
          (e.number ? ' · ' + esc(e.number) : '') + '<br>' +
          (e.time ? esc(e.time) + ' · ' : '') + esc(e.inspector || "") +
          (e.status ? ' · <strong>' + esc(e.status) + '</strong>' : '') + '</p></div>';
      });
    }
    if (!sched.length) {
      h += '<div class="jf-empty">Nothing on the schedule from today onward in the current schedule file.</div>';
    } else {
      var cur = "";
      sched.forEach(function (s) {
        if (s.date !== cur) {
          if (cur) h += '</div>';
          cur = s.date;
          h += '<div class="jf-h">' + (s.date === today ? 'Today — ' : '') + esc(fmtDay(s.date)) + '</div><div class="jf-list">';
        }
        h += '<div class="jf-row"><span class="jf-chip is-time">' + esc(s.time || "All day") + '</span>' +
          '<span class="jf-row__body"><span class="jf-row__title">' + esc(s.title || "") + '</span>' +
          (s.location ? '<span class="jf-row__sub">' + esc(s.location) + '</span>' : '') +
          (s.notes ? '<span class="jf-row__sub">' + esc(s.notes) + '</span>' : '') +
          '</span></div>';
      });
      h += '</div>';
    }
    h += '<p class="jf-updated">The same schedule My Day and Office TV show, updated ' +
      fmtStamp(tv.updatedAt || "") + '. Day-by-day route cards live in My Day.</p>' +
      '<a class="jf-btn" href="' + MYDAY_APP + '" target="_blank" rel="noopener">Open My Day</a></div>';
    page.html(h);
  }
  function buildSchedule(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    loader(page, "tv", TV_URL, function (d) { renderSchedule(page, d); });
  }

  /* ---------------- Permits (office + owner) ---------------- */
  function renderPermits(page, feed) {
    var issued = feed.permits.filter(function (p) { return p.status === "Issued"; }).length;
    var h = '<div class="jf"><h1 class="sk-title">Permits</h1>' +
      '<div class="jf-tiles">' +
      '<div class="jf-tile"><span class="jf-tile__n">' + feed.count + '</span><span class="jf-tile__l">On record</span></div>' +
      '<div class="jf-tile"><span class="jf-tile__n">' + issued + '</span><span class="jf-tile__l">Issued</span></div>' +
      '<div class="jf-tile"><span class="jf-tile__n">' + (feed.count - issued) + '</span><span class="jf-tile__l">In process</span></div>' +
      '</div><div class="jf-list">';
    if (!feed.permits.length) h += '<div class="jf-empty">No permits on record yet.</div>';
    feed.permits.forEach(function (p) {
      h += '<div class="jf-row"><span class="jf-row__body">' +
        '<span class="jf-row__title">' + esc(p.number || "No number yet") +
        (p.type ? ' · ' + esc(p.type) : '') + '</span>' +
        '<span class="jf-row__sub">' + esc([p.address, p.city, p.county].filter(Boolean).join(", ")) +
        (p.builder ? '<br>' + esc(p.builder) : '') +
        (p.nextAction ? '<br>Next: ' + esc(p.nextAction) : '') + '</span></span>' +
        '<span class="jf-chip' + (p.status === "Issued" ? ' is-ok' : ' is-warn') + '">' + esc(p.status || "—") + '</span></div>';
    });
    h += '</div><p class="jf-updated">Read from the Permit Tracker ' + fmtStamp(feed.generatedAt) +
      '. Add or change permits in the Permit Tracker itself.</p>' +
      '<a class="jf-btn" href="' + PERMITS_APP + '" target="_blank" rel="noopener">Open Permit Tracker</a></div>';
    page.html(h);
  }
  function buildPermits(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    loader(page, "permits", FEED_PERMITS, function (d) { renderPermits(page, d); });
  }

  /* ---------------- Inspections ---------------- */
  function renderInspections(page, tv) {
    lastTV = tv;
    var ti = tv.todayInspections || {};
    var entries = ti.entries || [];
    var h = '<div class="jf"><h1 class="sk-title">Inspections</h1>';
    if (!entries.length) {
      h += '<div class="jf-empty">No inspections on record' + (ti.date ? ' for ' + esc(fmtDay(ti.date)) : '') +
        '. New results land here as the county portals are checked through the day.</div>';
    } else {
      h += '<p class="jf-note">Inspection day: <strong>' + esc(fmtDay(ti.date || etToday())) + '</strong> — kept current by the hourly portal checks, 10 AM–6 PM.</p>';
      entries.forEach(function (e) {
        var chip = /approv|pass/i.test(e.status || "") ? ' is-ok' : (/fail|denied|reject/i.test(e.status || "") ? ' is-bad' : ' is-warn');
        h += '<div class="jf-card"><p class="jf-card__title">' + esc(e.title || "") + '</p>' +
          '<p class="jf-note" style="margin:0 0 8px">' + esc(e.type || "") +
          (e.number ? ' · ' + esc(e.number) : '') + '<br>' +
          (e.time ? esc(e.time) + ' · ' : '') + esc(e.inspector || "") +
          (e.inspectorPhone ? '<br>' + esc(e.inspectorPhone) : '') + '</p>' +
          (e.status ? '<span class="jf-chip' + chip + '">' + esc(e.status) + '</span>' : '') +
          (e.notes ? '<p class="jf-note">' + esc(e.notes) + '</p>' : '') + '</div>';
      });
    }
    h += '<p class="jf-updated">Prep checklists, past results and re-inspection notes live in Inspection Prep.</p>' +
      '<a class="jf-btn" href="' + INSPECT_APP + '" target="_blank" rel="noopener">Open Inspection Prep</a></div>';
    page.html(h);
  }
  function buildInspections(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    loader(page, "tv", TV_URL, function (d) { renderInspections(page, d); });
  }

  /* ---------------- Punch ---------------- */
  function renderPunch(page, feed) {
    var c = feed.counts || { houses: 0, openPunches: 0, openTasks: 0 };
    var h = '<div class="jf"><h1 class="sk-title">Punch</h1>' +
      '<div class="jf-tiles">' +
      '<div class="jf-tile"><span class="jf-tile__n">' + c.openPunches + '</span><span class="jf-tile__l">Open punch</span></div>' +
      '<div class="jf-tile"><span class="jf-tile__n">' + c.openTasks + '</span><span class="jf-tile__l">Open tasks</span></div>' +
      '<div class="jf-tile"><span class="jf-tile__n">' + c.houses + '</span><span class="jf-tile__l">Projects</span></div>' +
      '</div>';
    if (!c.openPunches && !c.openTasks) {
      h += '<div class="jf-empty">Nothing open — all caught up. New punch items and tasks will show here as the office adds them.</div>';
    }
    if ((feed.openPunches || []).length) {
      h += '<div class="jf-h">Open punch items</div><div class="jf-list">';
      feed.openPunches.forEach(function (p) {
        h += '<div class="jf-row"><span class="jf-row__body"><span class="jf-row__title">' + esc(p.title || "Punch item") + '</span>' +
          '<span class="jf-row__sub">' + esc(p.house || "") + (p.trade ? ' · ' + esc(p.trade) : '') +
          (p.crew ? ' · ' + esc(p.crew) : '') + '</span></span>' +
          (p.priority ? '<span class="jf-chip is-warn">' + esc(p.priority) + '</span>' : '') + '</div>';
      });
      h += '</div>';
    }
    if ((feed.openTasks || []).length) {
      h += '<div class="jf-h">Open tasks</div><div class="jf-list">';
      feed.openTasks.forEach(function (t) {
        h += '<div class="jf-row"><span class="jf-row__body"><span class="jf-row__title">' + esc(t.title || "Task") + '</span>' +
          '<span class="jf-row__sub">' + esc(t.house || "General") +
          (t.assignee ? ' · ' + esc(t.assignee) : '') +
          (t.dueDate ? ' · due ' + esc(fmtDay(t.dueDate)) : '') + '</span></span></div>';
      });
      h += '</div>';
    }
    if ((feed.houses || []).length) {
      h += '<div class="jf-h">Projects</div><div class="jf-list">';
      feed.houses.forEach(function (hs) {
        var open = (hs.openPunches || 0) + (hs.openTasks || 0);
        h += '<div class="jf-row"><span class="jf-row__body"><span class="jf-row__title">' + esc(hs.address || "Project") + '</span>' +
          '<span class="jf-row__sub">' + esc(hs.builder || "") + (hs.crew ? ' · ' + esc(hs.crew) : '') + '</span></span>' +
          '<span class="jf-chip' + (open ? ' is-warn' : ' is-ok') + '">' + (open ? open + ' open' : 'Clear') + '</span></div>';
      });
      h += '</div>';
    }
    h += '<p class="jf-updated">Read from Pending Projects ' + fmtStamp(feed.generatedAt) +
      '. Mark items done, add photos and verify in Pending Projects itself.</p>' +
      '<a class="jf-btn" href="' + PUNCH_APP + '" target="_blank" rel="noopener">Open Pending Projects</a></div>';
    page.html(h);
  }
  function buildPunch(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    loader(page, "punch", FEED_PUNCH, function (d) { renderPunch(page, d); });
  }

  /* ---------------- More ---------------- */
  function buildMore(page) {
    page.setHeader({ lead: logoLead(), title: "Jobs & Field" });
    var h = '<div class="jf"><h1 class="sk-title">More</h1>' +
      '<div class="jf-h">Display</div><div class="jf-list"><div class="jf-row"><span class="jf-row__body">' +
      '<span class="jf-row__title">Appearance</span><span class="jf-row__sub">Apps open in Light always — Dark only when you pick it here.</span></span></div>' +
      '<div id="jf-appearance"></div></div>' +
      '<div class="jf-h">Your role on this phone</div>' +
      '<div class="jf-seg" role="group" aria-label="Role">' +
      '<button type="button" data-role="crew" aria-pressed="' + (role === "crew") + '">Crew</button>' +
      '<button type="button" data-role="office" aria-pressed="' + (role === "office") + '">Office</button>' +
      '<button type="button" data-role="owner" aria-pressed="' + (role === "owner") + '">Owner</button></div>' +
      '<p class="jf-note">Crew sees Jobs, Inspections and Punch. Office and Owner see every tab, including Schedule and Permits.</p>' +
      '<div class="jf-h">Notifications</div><div id="push-panel-mount"></div>' +
      '<div class="jf-h">The full apps</div><div class="jf-list">' +
      '<a class="jf-row" href="' + MYDAY_APP + '" target="_blank" rel="noopener"><span class="jf-row__body"><span class="jf-row__title">My Day</span><span class="jf-row__sub">The day\u2019s route card</span></span><span class="jf-row__chev">›</span></a>' +
      '<a class="jf-row" href="' + PERMITS_APP + '" target="_blank" rel="noopener"><span class="jf-row__body"><span class="jf-row__title">Permit Tracker</span></span><span class="jf-row__chev">›</span></a>' +
      '<a class="jf-row" href="' + INSPECT_APP + '" target="_blank" rel="noopener"><span class="jf-row__body"><span class="jf-row__title">Inspection Prep</span></span><span class="jf-row__chev">›</span></a>' +
      '<a class="jf-row" href="' + PUNCH_APP + '" target="_blank" rel="noopener"><span class="jf-row__body"><span class="jf-row__title">Pending Projects</span></span><span class="jf-row__chev">›</span></a>' +
      '<a class="jf-row" href="' + HOME_APP + '" target="_blank" rel="noopener"><span class="jf-row__body"><span class="jf-row__title">Sharma Home</span><span class="jf-row__sub">Every Sharma app in one place</span></span><span class="jf-row__chev">›</span></a>' +
      '</div>' +
      '<div class="jf-h">About</div><div class="jf-list"><div class="jf-row"><span class="jf-row__body">' +
      '<span class="jf-row__title">Sharma Electric &amp; HVAC</span>' +
      '<span class="jf-row__sub">Lic. EC13013924 · CAC1823596</span></span></div></div>' +
      '<p class="jf-foot"><img src="logo.png" alt="Sharma Electric &amp; HVAC">Jobs &amp; Field · Lean App 4 of 7<br>Developed by Sanjay Sharma</p></div>';
    page.html(h);
    if (window.SK && SK.scheme && SK.scheme.mountToggle) {
      var ap = page.body.querySelector("#jf-appearance");
      if (ap) SK.scheme.mountToggle(ap);
    }
    if (window.SharmaPushTrack) {
      var mount = page.body.querySelector("#push-panel-mount");
      if (mount) SharmaPushTrack.mount(mount, { role: role });
    }
    page.body.querySelectorAll(".jf-seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        role = b.getAttribute("data-role");
        lsSet("jf:role", role);
        applyRole();
        page.body.querySelectorAll(".jf-seg button").forEach(function (x) {
          x.setAttribute("aria-pressed", String(x === b));
        });
        if (window.SharmaPushTrack) {
          var m2 = page.body.querySelector("#push-panel-mount");
          if (m2) SharmaPushTrack.mount(m2, { role: role });
        }
        if (!isOffice() && ["schedule", "permits"].indexOf(routeKey()) >= 0) location.hash = "#/jobs";
      });
    });
  }

  /* ---------------- routing ---------------- */
  var BUILDERS = { jobs: buildJobs, schedule: buildSchedule, permits: buildPermits,
                   inspections: buildInspections, punch: buildPunch, more: buildMore };
  var OFFICE_ONLY = { schedule: 1, permits: 1 };
  function routeKey() {
    var h = location.hash || "#/jobs";
    if (h.indexOf("#/") !== 0) return "jobs";
    return h.slice(2).split("/")[0] || "jobs";
  }
  function route() {
    var h = location.hash || "#/jobs";
    var parts = h.replace(/^#\//, "").split("/");
    if (parts[0] === "view" && parts[1]) { openView(parts[1]); return; }
    var key = BUILDERS[parts[0]] ? parts[0] : "jobs";
    if (OFFICE_ONLY[key] && !isOffice()) key = "jobs";
    nav.root(key, BUILDERS[key]);
  }
  window.addEventListener("hashchange", route);
  applyRole();
  route();
})();
