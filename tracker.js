/**
 * WebPulse Tracker v1.0
 * Embed this script on any website you want to monitor.
 * Replace FIREBASE_CONFIG below with your own Firebase project config.
 * Place this script before </body> on every page.
 */

(function () {
  // ─── CONFIGURE YOUR FIREBASE PROJECT HERE ────────────────────────────────
  const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDRMlSM1uxzQ-JV6W74spJZ2k7MS4ZO01A",
  authDomain:        "traffic-checking.firebaseapp.com",
  projectId:         "traffic-checking",
  storageBucket:     "traffic-checking.firebasestorage.app",
  messagingSenderId: "772799649219",
  appId:             "1:772799649219:web:8415aa443b4d0232461976"
  };
  // ─────────────────────────────────────────────────────────────────────────

  const COLLECTION       = "page_views";
  const ZALO_COLLECTION  = "zalo_clicks";

  function loadFirebase(callback) {
    const sdkBase = "https://www.gstatic.com/firebasejs/10.12.2/";
    let loaded = 0;
    const scripts = [
      sdkBase + "firebase-app-compat.js",
      sdkBase + "firebase-firestore-compat.js"
    ];
    scripts.forEach(function (src) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = function () {
        loaded++;
        if (loaded === scripts.length) callback();
      };
      document.head.appendChild(s);
    });
  }

  function getDeviceType() {
    const ua = navigator.userAgent;
    if (/Mobi|Android/i.test(ua)) return "mobile";
    if (/Tablet|iPad/i.test(ua)) return "tablet";
    return "desktop";
  }

  function getBrowser() {
    const ua = navigator.userAgent;
    if (/Firefox/i.test(ua)) return "Firefox";
    if (/Edg/i.test(ua)) return "Edge";
    if (/Chrome/i.test(ua)) return "Chrome";
    if (/Safari/i.test(ua)) return "Safari";
    if (/Opera|OPR/i.test(ua)) return "Opera";
    return "Unknown";
  }

  function getOS() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac OS/i.test(ua)) return "macOS";
    if (/Linux/i.test(ua)) return "Linux";
    if (/Android/i.test(ua)) return "Android";
    if (/iOS|iPhone|iPad/i.test(ua)) return "iOS";
    return "Unknown";
  }

  async function getLocation() {
    // Try multiple APIs in order — if one fails, try the next
    const apis = [
      async () => {
        const r = await fetch("https://ip-api.com/json/?fields=status,country,countryCode,regionName,city");
        const d = await r.json();
        if (d.status !== "success") throw new Error("fail");
        return { country: d.country, country_code: d.countryCode, city: d.city, region: d.regionName };
      },
      async () => {
        const r = await fetch("https://ipwho.is/");
        const d = await r.json();
        if (!d.success) throw new Error("fail");
        return { country: d.country, country_code: d.country_code, city: d.city, region: d.region };
      },
      async () => {
        const r = await fetch("https://freeipapi.com/api/json");
        const d = await r.json();
        return { country: d.countryName || "Unknown", country_code: d.countryCode || "XX", city: d.cityName || "Unknown", region: d.regionName || "Unknown" };
      },
      async () => {
        const r = await fetch("https://ipapi.co/json/");
        const d = await r.json();
        return { country: d.country_name || "Unknown", country_code: d.country_code || "XX", city: d.city || "Unknown", region: d.region || "Unknown" };
      }
    ];

    for (const api of apis) {
      try {
        const loc = await Promise.race([
          api(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
        ]);
        if (loc.country && loc.country !== "Unknown") return loc;
      } catch (e) { /* try next */ }
    }
    return { country: "Unknown", country_code: "XX", city: "Unknown", region: "Unknown" };
  }

  function getSessionId() {
    let sid = sessionStorage.getItem("_wp_sid");
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("_wp_sid", sid);
    }
    return sid;
  }

  // ── NEW vs RETURNING VISITOR ──────────────────────────────────────────────
  // Uses localStorage to persist visitor identity across sessions
  function getVisitorInfo() {
    const KEY_ID    = "_wp_vid";
    const KEY_COUNT = "_wp_vc";
    const KEY_FIRST = "_wp_vf";

    let visitorId    = localStorage.getItem(KEY_ID);
    let visitCount   = parseInt(localStorage.getItem(KEY_COUNT) || "0");
    let firstVisit   = localStorage.getItem(KEY_FIRST);
    const isNew      = !visitorId;

    if (isNew) {
      visitorId  = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      firstVisit = new Date().toISOString();
      localStorage.setItem(KEY_ID,    visitorId);
      localStorage.setItem(KEY_FIRST, firstVisit);
    }

    visitCount++;
    localStorage.setItem(KEY_COUNT, visitCount);

    return {
      visitor_id:    visitorId,
      visitor_type:  isNew ? "new" : "returning",
      visit_count:   visitCount,
      first_visit:   firstVisit
    };
  }


  // Only counts time when user is actively interacting (not idle/tab hidden)
  function trackActiveTime() {
    let activeSeconds = 0;
    let isActive = true;
    let lastTick = Date.now();
    const IDLE_TIMEOUT = 30000; // 30s no interaction = idle
    let idleTimer = null;

    function markActive() {
      isActive = true;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { isActive = false; }, IDLE_TIMEOUT);
    }

    // Count active seconds every 1s
    setInterval(() => {
      if (isActive && !document.hidden) {
        activeSeconds++;
      }
    }, 1000);

    // Reset idle timer on any user interaction
    ["mousemove","keydown","scroll","click","touchstart"].forEach(evt => {
      document.addEventListener(evt, markActive, { passive: true });
    });

    // Pause when tab is hidden
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) isActive = false;
      else markActive();
    });

    // Start idle timer immediately
    markActive();

    return { getSeconds: () => activeSeconds };
  }

  loadFirebase(async function () {
    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();

    const location = await getLocation();
    const sessionId = getSessionId();
    const visitorInfo = getVisitorInfo();
    const activeTimer = trackActiveTime();

    // Save initial page view
    const payload = {
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      page: window.location.pathname,
      page_title: document.title,
      referrer: document.referrer || "direct",
      session_id: sessionId,
      visitor_id: visitorInfo.visitor_id,
      visitor_type: visitorInfo.visitor_type,
      visit_count: visitorInfo.visit_count,
      first_visit: visitorInfo.first_visit,
      device: getDeviceType(),
      browser: getBrowser(),
      os: getOS(),
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      language: navigator.language || "unknown",
      country: location.country,
      country_code: location.country_code,
      city: location.city,
      region: location.region,
      host: window.location.hostname,
      active_seconds: 0
    };

    let docRef = null;
    try {
      docRef = await db.collection(COLLECTION).add(payload);
    } catch (e) {
      // Silently fail — never interrupt the page experience
    }

    // ── ZALO BUTTON CLICK TRACKING ───────────────────────────────────────────
    // Detects clicks on Zalo buttons/links anywhere on the page.
    // Matches: href containing zalo.me, oa.zalo.me, zaloapp://, or
    //          elements with class/id/data containing "zalo"
    function isZaloElement(el) {
      if (!el) return false;
      const href = el.href || el.getAttribute?.("href") || "";
      if (/zalo\.me|oa\.zalo\.me|zaloapp:\/\//i.test(href)) return true;
      const attrs = (el.className || "") + " " + (el.id || "") + " " +
                    (el.getAttribute?.("data-type") || "") + " " +
                    (el.getAttribute?.("aria-label") || "") + " " +
                    (el.title || "");
      if (/zalo/i.test(attrs)) return true;
      // Check parent up to 4 levels (button may wrap an icon/image)
      return false;
    }

    function findZaloAncestor(el) {
      let node = el;
      for (let i = 0; i < 5; i++) {
        if (!node) break;
        if (isZaloElement(node)) return node;
        node = node.parentElement;
      }
      return null;
    }

    async function saveZaloClick(zaloEl) {
      const href = zaloEl.href || zaloEl.getAttribute?.("href") || "";
      const zaloPayload = {
        timestamp:    firebase.firestore.FieldValue.serverTimestamp(),
        page:         window.location.pathname,
        page_title:   document.title,
        session_id:   sessionId,
        visitor_id:   visitorInfo.visitor_id,
        visitor_type: visitorInfo.visitor_type,
        device:       getDeviceType(),
        browser:      getBrowser(),
        country:      location.country,
        country_code: location.country_code,
        city:         location.city,
        host:         window.location.hostname,
        zalo_href:    href,
        // Extract Zalo OA / phone number from URL if present
        zalo_target:  (href.match(/zalo\.me\/([^?#/]+)/i) || [])[1] || "unknown"
      };
      try {
        await db.collection(ZALO_COLLECTION).add(zaloPayload);
        // Also update the page_view doc with zalo_clicked flag
        if (docRef) await docRef.update({ zalo_clicked: true });
      } catch(e) {}
    }

    document.addEventListener("click", function(e) {
      const zaloEl = findZaloAncestor(e.target);
      if (zaloEl) saveZaloClick(zaloEl);
    }, { passive: true });
    // ─────────────────────────────────────────────────────────────────────────


    async function updateTime() {
      if (!docRef) return;
      try {
        await docRef.update({ active_seconds: activeTimer.getSeconds() });
      } catch(e) {}
    }

    // Periodic update every 15 seconds
    setInterval(updateTime, 15000);

    // Final update when user leaves the page
    window.addEventListener("pagehide", updateTime);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) updateTime();
    });
  });
})();
