/*! Sharma design kit v1.3 service worker, applied to Jobs & Field
   (Lean App 4 of 7). Copy of the kit shell worker with the app path set to
   /sharma-jobs-field/, plus the SharmaPushTrack push listeners appended at
   the end (per ~/workspace/sharma-push-track/APPLY.md).
   What it does:
   - App shell ("/") : network first, saved copy if there is no signal or
     the network takes over 2.5 s. Only a real unlocked page is saved.
   - Kit files (css, js, logo): served from the phone at once, refreshed in
     the background.
   - Never touches: /login, /logout, /api/*, POSTs, or anything else.
   Holds no data, passcodes or keys. */
var VERSION = "sk-shell-v1.3";
var DATA = "sk-data-v1";
var KIT = new URL((new URL(self.location.href).searchParams.get("kit") || "https://sharma-kit.sharma-crew.workers.dev").replace(/\/$/, ""), self.location.href).href.replace(/\/$/, "");
var KIT_FILES = [KIT + "/sharma-kit.css", KIT + "/sharma-kit.js", KIT + "/assets/logo-white-header.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    var page = fetch("/sharma-jobs-field/", { credentials: "same-origin", redirect: "manual", cache: "no-store" }).then(function (r) {
      if (r.ok && r.type === "basic" && (r.headers.get("content-type") || "").indexOf("text/html") === 0) return c.put("/sharma-jobs-field/", r);
    }).catch(function () {});
    return Promise.all([page].concat(KIT_FILES.map(function (u) {
      return fetch(u, { mode: "cors", cache: "no-cache" }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    })));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("sk-shell-") === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function wipe() { return Promise.all([caches.delete(DATA), caches.open(VERSION).then(function (c) { return c.delete("/sharma-jobs-field/"); })]); }

function shell(req) {
  var net = fetch(req).then(function (r) {
    if (r.type === "opaqueredirect" || r.redirected || r.status === 401 || r.status === 403) { wipe(); return r; }
    if (r.ok && (r.headers.get("content-type") || "").indexOf("text/html") === 0) {
      var copy = r.clone(); caches.open(VERSION).then(function (c) { return c.put("/sharma-jobs-field/", copy); });
    }
    return r;
  });
  var saved = caches.open(VERSION).then(function (c) { return c.match("/sharma-jobs-field/"); });
  return new Promise(function (resolve, reject) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    net.then(give, function () { saved.then(function (s) { if (s) give(s); else if (!done) { done = true; reject(new Error("offline")); } }); });
    setTimeout(function () { saved.then(give); }, 2500);
  });
}

function kitFile(e) {
  var req = e.request;
  return caches.open(VERSION).then(function (c) {
    return c.match(req.url).then(function (hit) {
      var fresh = fetch(req.url, { mode: "cors", cache: "no-cache" }).then(function (r) { if (r.ok) c.put(req.url, r.clone()); return r; });
      if (hit) { e.waitUntil(fresh.catch(function () {})); return hit; }
      return fresh.catch(function () { return fetch(req); });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (req.url.indexOf(KIT + "/") === 0 && /\.(css|js|png|svg)$/.test(url.pathname)) { e.respondWith(kitFile(e)); return; }
  if (url.origin === self.location.origin) {
    if (url.pathname === "/sharma-jobs-field/logout") { e.respondWith(wipe().then(function () { return fetch(req); })); return; }
    if (url.pathname === "/sharma-jobs-field/" && req.mode === "navigate") { e.respondWith(shell(req)); return; }
    return; /* /login, /api/*, everything else: straight to the network, never saved here */
  }
});

/*! === SHARMATRACK PUSH — appended per APPLY.md ============================
   Adds ONLY two listeners (push + notificationclick). It does not touch the
   fetch handler, caches, VERSION, install or activate — the kit shell keeps
   behaving exactly as before. The file changing is enough for phones to pick
   up the new worker on next open; no VERSION bump is required.
   Icon: payload "icon" wins; otherwise <scope>/icons/icon-192.png (the
   per-app fallback for Jobs & Field, same adjustment APPLY.md notes for
   EXJ's logo.png). Default title is this app's name.                        */

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var scope = self.registration.scope;
  var title = d.title || "Jobs & Field";
  var opts = {
    body: d.body || "",
    icon: d.icon || new URL("icons/icon-192.png", scope).href,
    tag: d.tag || d.type || "sharma-push",
    data: { url: d.url || "./", type: d.type || "" }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = new URL((e.notification.data && e.notification.data.url) || "./",
                       self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        if (wins[i].url.indexOf(self.registration.scope) === 0 && "focus" in wins[i]) {
          if ("navigate" in wins[i] && wins[i].url !== target) {
            return wins[i].navigate(target).then(function (w) { return w && w.focus(); });
          }
          return wins[i].focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
/* === END SHARMATRACK PUSH ================================================= */
