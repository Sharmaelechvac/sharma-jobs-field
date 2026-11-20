/*! SharmaPushTrack — push notification enable module, applied to Jobs & Field
   (Lean App 4 of 7) from the staged crew package in ~/workspace/sharma-push-track/.
   Jobs & Field branding (navy #264387 / gold #F0A846) lives in push-track.css.
   Self-contained: no dependencies, no build step. Talks to the push worker only:
     GET  /vapid-public-key            -> { publicKey }
     POST /subscribe                   { subscription, name, role, app }
     POST /unsubscribe                 { endpoint }
     GET  /prefs?name=&role=           -> { prefs } (or 404 / empty)
     POST /prefs                       { name, role, prefs }
     POST /test                        { endpoint, title, body, url }
       (test send: the server's /test route sends ONLY to the caller's own
        endpoint, ignoring prefs — /send is secret-locked for the watchers
        and is never called from a page. Reconciled per APPLY.md.)
   Usage: <div id="push-panel-mount" data-role="crew"></div>
          or SharmaPushTrack.mount(el, { role: "owner" }).
   Roles: crew sees only schedule_change + punch_items; office sees the office
   set; owner sees all eleven. The role can be changed in the panel; the choice
   is remembered on the device. */
(function () {
  "use strict";
  var WORKER = "https://sharma-push.sharma-crew.workers.dev";
  var ALERTS = [
    { key: "bid_due_24h",        label: "Bid due in 24 hours" },
    { key: "inspection_booked",  label: "Inspection booked" },
    { key: "inspection_passed",  label: "Inspection passed" },
    { key: "inspection_failed",  label: "Inspection failed" },
    { key: "permit_issued",      label: "Permit issued" },
    { key: "new_lead",           label: "New service call or lead" },
    { key: "invoice_paid",       label: "Invoice paid" },
    { key: "invoice_past_due",   label: "Invoice past due" },
    { key: "builder_replied",    label: "Builder replied" },
    { key: "schedule_change",    label: "Crew schedule change for tomorrow" },
    { key: "punch_items",        label: "New punch items" }
  ];
  var ROLE_KEYS = {
    crew:  ["schedule_change", "punch_items"],
    office:["bid_due_24h", "inspection_booked", "inspection_passed", "inspection_failed",
            "permit_issued", "invoice_paid", "invoice_past_due"],
    owner: ALERTS.map(function (a) { return a.key; })
  };
  var ROLE_DEFAULT_ON = {
    crew:  { schedule_change: true, punch_items: true },
    office:{ bid_due_24h: true, inspection_booked: true, inspection_passed: true,
             inspection_failed: true, permit_issued: true, invoice_paid: true,
             invoice_past_due: true },
    owner: ALERTS.reduce(function (m, a) { m[a.key] = true; return m; }, {})
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function urlB64ToUint8(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function isInstalled() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
           window.navigator.standalone === true;
  }
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function mount(target, opts) {
    opts = opts || {};
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return;
    var role = lsGet("spt:role") || opts.role || root.getAttribute("data-role") || "crew";
    if (!ROLE_KEYS[role]) role = "crew";
    var name = lsGet("spt:name") || "";
    var prefs = null;         // current prefs object for (name, role)
    var subscription = null;  // current PushSubscription or null

    root.classList.add("spt");
    root.innerHTML = "";

    var head = el("div", "spt-head");
    head.appendChild(el("div", "spt-title", "Notifications"));
    var dot = el("span", "spt-dot");
    head.appendChild(dot);
    root.appendChild(head);
    var status = el("p", "spt-status", "Checking this phone…");
    root.appendChild(status);

    var tip = el("div", "spt-tip");
    tip.appendChild(el("strong", null, "iPhone: add to Home Screen first. "));
    tip.appendChild(document.createTextNode(
      "Notifications only work in the installed app. Tap the Share button, then " +
      "“Add to Home Screen”, open Jobs & Field from your Home Screen, and come back " +
      "to this switch. (Needs iOS 16.4 or newer.)"));
    tip.hidden = true;
    root.appendChild(tip);

    var nameRow = el("label", "spt-field");
    nameRow.appendChild(el("span", "spt-field-label", "Your name"));
    var nameInput = el("input", "spt-input");
    nameInput.type = "text"; nameInput.autocomplete = "name";
    nameInput.placeholder = "e.g. Sanjay";
    nameInput.value = name;
    nameRow.appendChild(nameInput);
    root.appendChild(nameRow);

    var roleRow = el("label", "spt-field");
    roleRow.appendChild(el("span", "spt-field-label", "I am"));
    var roleSel = el("select", "spt-input");
    [["crew", "Crew"], ["office", "Office"], ["owner", "Owner"]].forEach(function (r) {
      var o = el("option", null, r[1]); o.value = r[0]; roleSel.appendChild(o);
    });
    roleSel.value = role;
    roleRow.appendChild(roleSel);
    root.appendChild(roleRow);

    var btn = el("button", "spt-btn", "Enable notifications");
    btn.type = "button";
    root.appendChild(btn);

    var list = el("div", "spt-list");
    root.appendChild(list);

    var testBtn = el("button", "spt-btn spt-btn-ghost", "Send test notification");
    testBtn.type = "button"; testBtn.hidden = true;
    root.appendChild(testBtn);

    var msg = el("p", "spt-msg", "");
    root.appendChild(msg);

    function say(t) { msg.textContent = t || ""; }
    function setState(cls, text) {
      dot.className = "spt-dot " + cls;
      status.textContent = text;
    }
    function visibleAlerts() {
      return ALERTS.filter(function (a) { return ROLE_KEYS[role].indexOf(a.key) >= 0; });
    }
    function renderSwitches() {
      list.innerHTML = "";
      if (!subscription || !prefs) { list.hidden = true; testBtn.hidden = true; return; }
      list.hidden = false; testBtn.hidden = false;
      visibleAlerts().forEach(function (a) {
        var row = el("label", "spt-row");
        row.appendChild(el("span", "spt-row-label", a.label));
        var sw = el("span", "spt-switch");
        var input = el("input");
        input.type = "checkbox";
        input.checked = prefs[a.key] !== false;
        input.setAttribute("aria-label", a.label);
        var track = el("span", "spt-track");
        sw.appendChild(input); sw.appendChild(track);
        row.appendChild(sw);
        input.addEventListener("change", function () {
          prefs[a.key] = input.checked;
          savePrefs().then(function () { say("Saved."); }).catch(function () {
            say("Could not save — check your connection."); });
        });
        list.appendChild(row);
      });
    }
    function savePrefs() {
      return fetch(WORKER + "/prefs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, role: role, prefs: prefs })
      });
    }
    function loadPrefs() {
      return fetch(WORKER + "/prefs?name=" + encodeURIComponent(name) +
                   "&role=" + encodeURIComponent(role))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          prefs = (j && j.prefs) || null;
          if (!prefs) { prefs = Object.assign({}, ROLE_DEFAULT_ON[role]); return savePrefs(); }
        })
        .catch(function () { prefs = Object.assign({}, ROLE_DEFAULT_ON[role]); });
    }
    function postSubscribe() {
      return fetch(WORKER + "/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(), name: name, role: role,
          app: (location.pathname.split("/")[1] || "tracker")
        })
      });
    }
    function refresh() {
      renderSwitches();
      if (!pushSupported()) {
        setState("off", "This browser can't receive push notifications.");
        btn.hidden = true; tip.hidden = isInstalled(); return;
      }
      if (isIOS() && !isInstalled()) {
        setState("off", "Not installed yet — add to Home Screen first.");
        tip.hidden = false; btn.hidden = true; return;
      }
      tip.hidden = true;
      if (Notification.permission === "denied") {
        setState("off", "Notifications are blocked for this app. Open iPhone Settings → Notifications → Jobs & Field and allow them, then come back.");
        btn.hidden = true; return;
      }
      if (subscription) {
        setState("on", "Notifications are ON for " + (name || "this phone") + " (" + role + ").");
        btn.textContent = "Turn off notifications";
        btn.hidden = false;
      } else {
        setState("off", "Notifications are off on this phone.");
        btn.textContent = "Enable notifications";
        btn.hidden = false;
      }
    }

    btn.addEventListener("click", function () {
      name = nameInput.value.trim();
      if (!name) { say("Type your name first, so the office knows whose phone this is."); nameInput.focus(); return; }
      lsSet("spt:name", name);
      if (subscription) {  // turn off
        var ep = subscription.endpoint;
        subscription.unsubscribe().then(function () {
          subscription = null; prefs = null;
          fetch(WORKER + "/unsubscribe", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: ep })
          }).catch(function () {});
          say("Notifications turned off on this phone.");
          refresh();
        });
        return;
      }
      say("Asking permission…");
      Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") { say("Permission wasn't granted."); refresh(); return; }
        return navigator.serviceWorker.ready;
      }).then(function (reg) {
        if (!reg) return null;
        return fetch(WORKER + "/vapid-public-key")
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var key = j.publicKey || j.key || j.vapidPublicKey;
            return reg.pushManager.subscribe({
              userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key)
            });
          });
      }).then(function (sub) {
        if (!sub) return;
        subscription = sub;
        return postSubscribe().then(loadPrefs).then(function () {
          say("You're set — notifications are on.");
          refresh();
        });
      }).catch(function (e) {
        say("Something went wrong turning notifications on. " + (e && e.message ? e.message : ""));
        refresh();
      });
    });

    roleSel.addEventListener("change", function () {
      role = roleSel.value; lsSet("spt:role", role);
      prefs = null;
      var chain = subscription ? postSubscribe() : Promise.resolve();
      chain.then(loadPrefs).then(function () { say(""); refresh(); });
    });
    nameInput.addEventListener("change", function () {
      name = nameInput.value.trim(); lsSet("spt:name", name);
      prefs = null;
      var chain = subscription ? postSubscribe() : Promise.resolve();
      chain.then(loadPrefs).then(refresh);
    });
    testBtn.addEventListener("click", function () {
      if (!subscription) return;
      say("Sending test…");
      fetch(WORKER + "/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          title: "Jobs & Field test",
          body: "Test notification for " + (name || "this phone") + " — push is working.",
          url: "./"
        })
      }).then(function (r) { say(r.ok ? "Test sent — watch for it." : "Test failed (" + r.status + ")."); })
        .catch(function () { say("Test failed — check your connection."); });
    });

    if (pushSupported() && (!isIOS() || isInstalled())) {
      navigator.serviceWorker.ready
        .then(function (reg) { return reg.pushManager.getSubscription(); })
        .then(function (sub) {
          subscription = sub;
          if (sub) { postSubscribe().then(loadPrefs).then(refresh); }
          else refresh();
        })
        .catch(refresh);
    } else {
      refresh();
    }
  }

  function autoMount() {
    var m = document.getElementById("push-panel-mount");
    if (m) mount(m, { role: m.getAttribute("data-role") || "crew" });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();

  window.SharmaPushTrack = { mount: mount, WORKER: WORKER, ALERTS: ALERTS };
})();
