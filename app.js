/* Shadow Store — Telegram Mini App */
(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  const CFG = window.SHOP_CONFIG || {};
  const I18N = window.I18N;
  const LANGS = ["en", "ru", "it", "fr", "es"];
  const LOCALES = { en: "en-US", ru: "ru-RU", it: "it-IT", fr: "fr-FR", es: "es-ES" };

  const S = {
    me: null, settings: {}, lang: "en", role: "user",
    catalog: { categories: [], products: [] },
    cart: loadCart(), tab: "shop", cat: "all", search: "",
    orders: null, copy: [], pq: null, checkout: null, form: null, langPick: "en",
    admin: { tab: "dashboard", prodCat: "all", ord: null, usr: null, dep: null, log: null },
  };

  // ============================================================ utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => "$" + num(n);
  const balHtml = (n) => { const [a, b] = num(n).split("."); return `$${a}<small>.${b}</small>`; };
  function T(k, v = {}) {
    const s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.en[k] ?? k;
    return s.replace(/\{(\w+)\}/g, (_, x) => (x in v ? v[x] : `{${x}}`));
  }
  const loc = (o) => (o && (o[S.lang] || o.en)) || "";
  const fdate = (s, time = true) => {
    try {
      return new Date(s).toLocaleString(LOCALES[S.lang], time
        ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "short", year: "numeric" });
    } catch { return String(s).slice(0, 16); }
  };
  const isStaff = () => S.role !== "user";
  const canEdit = () => S.role === "admin" || S.role === "owner";
  const haptic = (t = "light") => { try { tg?.HapticFeedback?.impactOccurred(t); } catch { /* */ } };
  const hnotify = (t) => { try { tg?.HapticFeedback?.notificationOccurred(t); } catch { /* */ } };
  const userName = (u) => (u?.username ? "@" + u.username : u?.first_name || String(u?.id ?? "—"));

  function loadCart() { try { return JSON.parse(localStorage.getItem("ss_cart") || "[]"); } catch { return []; } }
  function saveCart() { try { localStorage.setItem("ss_cart", JSON.stringify(S.cart)); } catch { /* */ } }

  async function api(action, data = {}) {
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, initData: tg?.initData || "", data }),
      });
    } catch { throw new Error("NETWORK"); }
    let j;
    try { j = await res.json(); } catch { throw new Error("SERVER_ERROR"); }
    if (!j.ok) {
      if (j.error === "SUB_REQUIRED" && S.me) { S.settings.sub_required = true; setTimeout(subGate); }
      throw new Error(j.error || "SERVER_ERROR");
    }
    return j.data;
  }
  const errText = (e) => (I18N.en["e_" + e?.message] ? T("e_" + e.message) : T("error"));

  let toastTimer;
  function toast(msg, err = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("err", err);
    el.classList.toggle("top", sheetOpen()); // don't cover the sheet's buttons
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function confirmBox(msg) {
    return new Promise((resolve) => {
      if (tg?.showConfirm) { try { tg.showConfirm(msg, (ok) => resolve(!!ok)); return; } catch { /* */ } }
      resolve(window.confirm(msg));
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* */ }
      ta.remove();
    }
    hnotify("success");
    toast(T("copied"));
  }

  const spinner = () => `<div class="spinner"></div>`;
  const empty = (icon, text, extra = "") => `<div class="empty"><div class="big">${icon}</div><div>${h(text)}</div>${extra}</div>`;
  const statusChip = (s) => `<span class="status s-${h(s)}">${h(T("st_" + s) !== "st_" + s ? T("st_" + s) : T(s))}</span>`;

  // ============================================================ sheet (spring physics, drag to dismiss)
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sheetLocked = false, sheetOnClose = null;
  let sheetY = null, sheetAnim = null; // current on-screen offset (px) and running spring
  const sheetH = () => $("#sheet").offsetHeight || window.innerHeight;

  function paintSheet(y) {
    sheetY = y;
    $("#sheet").style.transform = `translate3d(0, ${y}px, 0)`;
    $("#sheetBackdrop").style.opacity = String(Math.max(0, Math.min(1, 1 - y / sheetH())));
  }
  // critically damped by default (damping 1); a little bounce only after a flick
  function springSheet(to, velocity = 0, { response = 0.32, damping = 1, done } = {}) {
    cancelAnimationFrame(sheetAnim);
    if (REDUCED) { paintSheet(to); done?.(); return; }
    const k = (2 * Math.PI / response) ** 2, c = (4 * Math.PI * damping) / response;
    let x = sheetY ?? sheetH(), v = velocity, last = performance.now();
    const step = (now) => {
      let dt = Math.min(0.064, (now - last) / 1000); last = now;
      while (dt > 0) { const h2 = Math.min(dt, 1 / 240); v += (-k * (x - to) - c * v) * h2; x += v * h2; dt -= h2; }
      if (Math.abs(x - to) < 0.5 && Math.abs(v) < 8) { paintSheet(to); sheetAnim = null; done?.(); return; }
      paintSheet(x); sheetAnim = requestAnimationFrame(step);
    };
    sheetAnim = requestAnimationFrame(step);
  }
  // Apple's momentum projection: where would a flick come to rest?
  const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);
  const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

  function openSheet(html, opts = {}) {
    const wasOpen = sheetOpen();
    $("#sheetBody").innerHTML = html;
    $("#sheetBody").scrollTop = 0;
    $("#sheet").classList.add("open");
    $("#sheetBackdrop").classList.add("open");
    sheetLocked = !!opts.locked;
    sheetOnClose = opts.onClose || null;
    if (!wasOpen && (sheetY === null || sheetAnim === null)) paintSheet(sheetH()); // start below the screen
    springSheet(0); // from wherever it is now, so an interrupted close reverses smoothly
    updateBack();
  }
  const sheetOpen = () => $("#sheet").classList.contains("open");
  function closeSheet(force = false, velocity = 0) {
    if (!sheetOpen() || (sheetLocked && !force)) return;
    $("#sheet").classList.remove("open");
    $("#sheetBackdrop").classList.remove("open");
    const cb = sheetOnClose; sheetOnClose = null; sheetLocked = false;
    springSheet(sheetH() + 24, velocity, { response: 0.3 });
    updateBack();
    if (cb) cb();
  }

  // drag: 1:1 with the finger, from the handle anywhere, or from the content when it is scrolled to the top
  (function sheetDrag() {
    const el = $("#sheet"), body = $("#sheetBody");
    let drag = null;
    const begin = (y, fromHandle) => ({ y0: y, s0: sheetY ?? 0, fromHandle, active: false, hist: [[performance.now(), y]] });
    const move = (y, ev) => {
      if (!drag) return;
      const dy = y - drag.y0;
      if (!drag.active) {
        if (Math.abs(dy) < 8) return;                      // small threshold before committing
        if (!drag.fromHandle && (dy < 0 || body.scrollTop > 0)) { drag = null; return; } // let content scroll
        drag.active = true; drag.y0 = y; drag.s0 = sheetY ?? 0;
        cancelAnimationFrame(sheetAnim); sheetAnim = null;  // grab it mid-flight
      }
      ev?.cancelable && ev.preventDefault();
      const raw = drag.s0 + (y - drag.y0);
      const lockedLimit = sheetLocked ? 0 : Infinity;
      let ny = raw < 0 ? -rubber(-raw, sheetH()) : raw;     // resist above the top
      if (ny > lockedLimit) ny = lockedLimit + rubber(ny - lockedLimit, sheetH());
      paintSheet(ny);
      drag.hist.push([performance.now(), y]);
      if (drag.hist.length > 6) drag.hist.shift();
    };
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.active) return;
      const [t0, y0] = d.hist[0], [t1, y1] = d.hist[d.hist.length - 1];
      const v = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0;   // px/s
      const rest = (sheetY ?? 0) + project(v);
      if (!sheetLocked && rest > sheetH() * 0.45) { haptic("light"); closeSheet(false, v); }
      else springSheet(0, v, { damping: Math.abs(v) > 300 ? 0.8 : 1 });
    };
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      drag = begin(e.touches[0].clientY, !body.contains(e.target));
    }, { passive: true });
    el.addEventListener("touchmove", (e) => move(e.touches[0].clientY, e), { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    // mouse (Telegram Desktop): drag by the handle
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || body.contains(e.target)) return;
      el.setPointerCapture(e.pointerId);
      drag = begin(e.clientY, true);
    });
    el.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") move(e.clientY, e); });
    el.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") end(); });
  })();

  function updateBack() {
    if (!tg?.BackButton) return;
    if ((sheetOpen() && !sheetLocked) || S.tab !== "shop") tg.BackButton.show(); else tg.BackButton.hide();
  }
  function onBack() { if (sheetOpen()) closeSheet(); else go("shop"); }

  // ============================================================ icons
  const ICON = {
    shop: '<svg viewBox="0 0 24 24"><path d="M4 7h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 7a3.5 3.5 0 0 1 7 0"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    cart: '<svg viewBox="0 0 24 24"><path d="M3 4h2.2l2.1 10.4a1.8 1.8 0 0 0 1.8 1.4h8.1a1.8 1.8 0 0 0 1.8-1.4L20.5 8H6.1"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/></svg>',
    profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    admin: '<svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
  };

  // ============================================================ navigation & render
  function go(tab) {
    const changed = S.tab !== tab;
    S.tab = tab;
    window.scrollTo(0, 0);
    render();
    if (changed && !REDUCED) {
      const v = $("#view");
      v.classList.remove("view-enter"); void v.offsetWidth; v.classList.add("view-enter");
    }
    if (changed) haptic("light");
  }

  function renderTabbar() {
    const tabs = ["shop", "cart", "orders", "profile"];
    if (isStaff()) tabs.push("admin");
    const count = S.cart.reduce((a, i) => a + i.qty, 0);
    $("#tabbar").innerHTML = tabs.map((t) => `
      <button class="tab ${S.tab === t ? "active" : ""}" data-act="go" data-tab="${t}">
        ${ICON[t]}<span>${h(T("tab_" + t))}</span>
        ${t === "cart" && count ? `<span class="badge">${count}</span>` : ""}
      </button>`).join("");
  }

  function renderTop() {
    $("#shopName").textContent = S.settings.shop_name || "Shadow Store";
    $("#topBalance").textContent = money(S.me?.balance);
    document.documentElement.lang = S.lang;
  }

  function render() {
    renderTop();
    renderTabbar();
    const v = $("#view");
    switch (S.tab) {
      case "shop": v.innerHTML = viewShop(); mountShop(); break;
      case "search": v.innerHTML = viewSearch(); mountSearch(); break;
      case "cart": v.innerHTML = viewCart(); break;
      case "orders": v.innerHTML = `<h1 class="page-title">${h(T("tab_orders"))}</h1><div id="ordersBox">${spinner()}</div>`; loadOrders(); break;
      case "profile": v.innerHTML = viewProfile(); break;
      case "admin": v.innerHTML = viewAdmin(); loadAdmin(); break;
    }
    updateBack();
  }

  function gate(icon, text, withRetry = false) {
    $("#tabbar").innerHTML = "";
    $("#view").innerHTML = `<div class="gate"><div style="font-size:52px">${icon}</div><div>${h(text)}</div>
      ${withRetry ? `<button class="btn primary" data-act="reload">${h(T("retry"))}</button>` : ""}
      ${S.settings.manager ? `<button class="btn ghost" data-act="manager">💬 ${h(T("contact_manager"))}</button>` : ""}</div>`;
  }

  // required channel subscription
  function subGate() {
    closeSheet?.(true);
    $("#tabbar").innerHTML = "";
    $("#view").innerHTML = `<div class="gate"><div style="font-size:52px">📢</div>
      <div style="font-size:20px;font-weight:700">${h(T("sub_title"))}</div>
      <div class="muted" style="max-width:300px">${h(T("sub_text"))}</div>
      ${S.settings.sub_link ? `<button class="btn primary" data-act="sub-open">${h(T("sub_btn"))}</button>` : ""}
      <button class="btn ghost" data-act="sub-check">${h(T("sub_check"))}</button></div>`;
  }

  // ============================================================ data
  function setMe(d) {
    S.me = d.user;
    S.settings = d.settings || {};
    S.role = d.user.role;
    S.lang = LANGS.includes(d.user.lang) ? d.user.lang : "en";
  }
  async function loadCatalog() {
    S.catalog = await api("catalog");
    // drop cart items that no longer exist
    const ids = new Set(S.catalog.products.map((p) => p.id));
    S.cart = S.cart.filter((i) => ids.has(i.id));
    saveCart();
  }
  let refreshing = false;
  async function refreshMe() {
    if (S.me && S.settings.sub_required) return checkSub(false);
    if (refreshing || !S.me) return;
    refreshing = true;
    try {
      const d = await api("me");
      const changed = d.user.balance !== S.me.balance;
      setMe(d);
      renderTop();
      if (changed && ["shop", "profile", "cart"].includes(S.tab) && !sheetOpen()) render();
    } catch { /* ignore */ } finally { refreshing = false; }
  }
  async function checkSub(showError = true) {
    if (refreshing) return;
    refreshing = true;
    try {
      setMe(await api("me", { check_sub: true }));
      if (!S.settings.sub_required) return location.reload();
      if (showError) { hnotify("error"); toast(T("e_SUB_REQUIRED"), true); }
    } catch { /* ignore */ } finally { refreshing = false; }
  }
  const product = (id) => S.catalog.products.find((p) => p.id === Number(id));

  // ============================================================ shop
  const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>';
  function ph(p, cls = "") {
    const c = S.catalog.categories.find((x) => x.id === p.category_id);
    const inner = c?.icon ? `<span class="ph-emoji">${h(c.icon)}</span>` : GLYPH;
    return `<div class="ph ${cls}" data-hue="${(p.category_id ?? p.id) % 5}">${inner}</div>`;
  }
  const stockOrder = (list) => [...list].sort((a, b) => (a.stock === 0) - (b.stock === 0)); // sold-out items go last

  function productCard(p) {
    const img = p.images?.[0];
    const out = p.stock === 0;
    const name = loc(p.name);
    const stock = p.stock === null ? T("available") : out ? T("out_of_stock") : T("in_stock", { n: p.stock });
    return `<button class="p-card ${out ? "out" : ""}" data-act="product" data-id="${p.id}">
      <div class="p-img">
        ${img ? `<img src="${h(img)}" alt="" loading="lazy">` : ph(p)}
        <div class="badges">
          ${p.is_hot ? `<span class="badge-hot">${h(T("hot"))}</span>` : ""}
          ${p.is_new ? `<span class="badge-new">${h(T("new"))}</span>` : ""}
          ${out ? `<span class="badge-out">${h(T("out_of_stock"))}</span>` : ""}
        </div>
      </div>
      <div class="p-info">
        <div class="p-name">${h(name)}</div>
        <div class="p-row"><span class="p-price">${money(p.price)}</span><span class="p-stock">${h(stock)}</span></div>
      </div>
    </button>`;
  }

  function shopList() {
    const q = S.search.trim().toLowerCase();
    let prods = S.cat === "all" ? S.catalog.products : S.catalog.products.filter((p) => String(p.category_id) === String(S.cat));
    if (q) prods = prods.filter((p) => [loc(p.name), loc(p.description), p.name?.en].join(" ").toLowerCase().includes(q));
    return stockOrder(prods);
  }
  function shopGrid(prods) {
    return prods.length ? `<div class="grid">${prods.map(productCard).join("")}</div>` : empty("📦", T("nothing_found"));
  }
  function viewShop() {
    const cats = S.catalog.categories;
    const cat = cats.find((c) => String(c.id) === String(S.cat));
    if (!cat) S.cat = "all";
    const prods = shopList();
    const chip = (id, label) => `<button class="chip ${String(S.cat) === String(id) ? "active" : ""}" data-act="cat" data-id="${id}">${h(label)}</button>`;
    return `
      <section class="card glow balbar">
        <button class="balbar-info" data-act="go" data-tab="profile">
          <span class="eyebrow">${h(T("balance"))}</span>
          <span class="balbar-sum">${balHtml(S.me.balance)}</span>
        </button>
        <div class="balbar-actions">
          <button class="chip-btn" data-act="lang" aria-label="Language">${I18N[S.lang].flag} ${S.lang.toUpperCase()}</button>
          <button class="btn primary sm" data-act="topup">${h(T("top_up"))}</button>
        </div>
      </section>
      <div class="search-box shop-search">${ICON.search.replace("<svg", '<svg aria-hidden="true"')}
        <input class="input" id="q" type="search" placeholder="${h(T("search_ph"))}" value="${h(S.search)}" autocomplete="off" enterkeyhint="search">
      </div>
      ${cats.length ? `<div class="chips">${chip("all", T("all"))}${cats.map((c) => chip(c.id, (c.icon ? c.icon + " " : "") + loc(c.name))).join("")}</div>` : ""}
      <h2 class="section-title">${h(cat ? loc(cat.name) : T("products"))}<span class="muted small" id="shopCount">${prods.length}</span></h2>
      <div id="shopGrid">${shopGrid(prods)}</div>`;
  }
  function mountShop() {
    const input = $("#q");
    if (!input) return;
    input.addEventListener("input", () => {
      S.search = input.value;
      const prods = shopList();
      $("#shopGrid").innerHTML = shopGrid(prods);
      $("#shopCount").textContent = prods.length;
    });
  }

  function openProduct(id) {
    const p = product(id);
    if (!p) return;
    S.pq = { id: p.id, qty: 1 };
    const name = loc(p.name);
    const imgs = p.images || [];
    const out = p.stock === 0;
    const stock = p.stock === null ? T("available") : out ? T("out_of_stock") : T("in_stock", { n: p.stock });
    const desc = loc(p.description);
    openSheet(`
      <div class="gallery">${imgs.length ? imgs.map((u) => `<div><img src="${h(u)}" alt=""></div>`).join("") : `<div>${ph(p, "big")}</div>`}</div>
      <div style="display:flex;gap:6px;margin-top:14px">
        ${p.is_hot ? `<span class="badge-hot">${h(T("hot"))}</span>` : ""}${p.is_new ? `<span class="badge-new">${h(T("new"))}</span>` : ""}
      </div>
      <h2 class="sheet-title" style="margin-top:8px">${h(name)}</h2>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="price-big">${money(p.price)}</div>
        <span class="muted small">${h(stock)}</span>
      </div>
      ${desc ? `<h3 class="section-title" style="font-size:16px">${h(T("description"))}</h3><div class="desc">${h(desc)}</div>` : ""}
      ${out ? "" : `
        <div class="kv" style="margin-top:14px"><span class="k">${h(T("quantity"))}</span>
          <div class="stepper"><button data-act="pqty" data-d="-1">−</button><span id="pqty">1</span><button data-act="pqty" data-d="1">+</button></div>
        </div>
        <div class="row-actions">
          <button class="btn ghost" data-act="add-cart">${h(T("add_to_cart"))}</button>
          <button class="btn primary" data-act="buy-now">${h(T("buy_now"))}</button>
        </div>`}
    `);
  }

  const maxQty = (p) => Math.min(100, p.stock === null ? 100 : p.stock);

  function addToCart(id, qty) {
    const p = product(id);
    if (!p) return;
    const ex = S.cart.find((i) => i.id === p.id);
    if (ex) ex.qty = Math.min(maxQty(p), ex.qty + qty); else S.cart.push({ id: p.id, qty: Math.min(maxQty(p), qty) });
    saveCart();
    renderTabbar();
  }

  // ============================================================ search
  function viewSearch() {
    return `<h1 class="page-title">${h(T("tab_search"))}</h1>
      <div class="search-box">${ICON.search.replace("<svg", '<svg aria-hidden="true"')}
        <input class="input" id="q" type="search" placeholder="${h(T("search_ph"))}" value="${h(S.search)}" autocomplete="off">
      </div>
      <div id="results"></div>`;
  }
  function mountSearch() {
    const input = $("#q");
    const draw = () => {
      const q = S.search.trim().toLowerCase();
      const res = stockOrder(S.catalog.products).filter((p) => !q ||
        [loc(p.name), loc(p.description), p.name?.en].join(" ").toLowerCase().includes(q));
      $("#results").innerHTML = res.length ? `<div class="grid">${res.map(productCard).join("")}</div>` : empty("🔍", T("nothing_found"));
    };
    input.addEventListener("input", () => { S.search = input.value; draw(); });
    draw();
  }

  // ============================================================ cart & checkout
  const cartLines = () => S.cart.map((i) => ({ ...i, p: product(i.id) })).filter((i) => i.p);

  function viewCart() {
    const lines = cartLines();
    if (!lines.length) {
      return `<h1 class="page-title">${h(T("tab_cart"))}</h1>${empty("🛒", T("cart_empty"),
        `<button class="btn primary" style="margin-top:16px" data-act="go" data-tab="shop">${h(T("go_shop"))}</button>`)}`;
    }
    const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
    return `<h1 class="page-title" style="display:flex;justify-content:space-between;align-items:center">${h(T("tab_cart"))}
        <button class="chip-btn" data-act="cart-clear">${h(T("clear"))}</button></h1>
      <div class="list">${lines.map((l) => `
        <div class="item">
          <div class="thumb">${l.p.images?.[0] ? `<img src="${h(l.p.images[0])}" alt="">` : ph(l.p, "small")}</div>
          <div class="grow">
            <div class="title">${h(loc(l.p.name))}</div>
            <div class="sub">${money(l.p.price)} × ${l.qty} = <b style="color:#fff">${money(l.p.price * l.qty)}</b></div>
          </div>
          <div class="stepper"><button data-act="cqty" data-id="${l.p.id}" data-d="-1">−</button><span>${l.qty}</span><button data-act="cqty" data-id="${l.p.id}" data-d="1">+</button></div>
        </div>`).join("")}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="kv"><span class="k">${h(T("total"))}</span><span class="v price-big" style="font-size:24px">${money(total)}</span></div>
        <div class="kv"><span class="k">${h(T("your_balance"))}</span><span class="v">${money(S.me.balance)}</span></div>
      </div>
      <button class="btn primary block" style="margin-top:14px" data-act="checkout">${h(T("checkout"))}</button>`;
  }

  function openCheckout(items, fromCart) {
    const lines = items.map((i) => ({ ...i, p: product(i.id) })).filter((l) => l.p);
    const total = Math.round(lines.reduce((a, l) => a + l.p.price * l.qty, 0) * 100) / 100;
    const bal = S.me.balance;
    const enough = bal >= total;
    S.checkout = { items: lines.map((l) => ({ id: l.p.id, qty: l.qty })), fromCart };
    openSheet(`
      <h2 class="sheet-title">${h(T("confirm_order"))}</h2>
      <div class="card">
        ${lines.map((l) => `<div class="kv"><span class="k">${h(loc(l.p.name))} × ${l.qty}</span><span class="v">${money(l.p.price * l.qty)}</span></div>`).join("")}
        <div class="kv"><span class="k">${h(T("total"))}</span><span class="v price-big" style="font-size:22px">${money(total)}</span></div>
      </div>
      <div class="card">
        <div class="kv"><span class="k">${h(T("your_balance"))}</span><span class="v">${money(bal)}</span></div>
        ${enough ? `<div class="kv"><span class="k">${h(T("after"))}</span><span class="v">${money(bal - total)}</span></div>` : ""}
      </div>
      ${enough
        ? `<button class="btn primary block" style="margin-top:16px" data-act="pay">${h(T("pay", { amount: total.toFixed(2) }))}</button>`
        : `<div class="warn">${h(T("not_enough", { amount: (total - bal).toFixed(2) }))}</div>
           <div class="row-actions"><button class="btn primary" data-act="topup">${h(T("top_up"))}</button>
           <button class="btn ghost" data-act="manager">💬 ${h(T("manager"))}</button></div>`}
    `);
  }

  async function pay(btn) {
    if (!S.checkout) return;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;margin:0;border-width:2px"></span>`;
    try {
      const r = await api("buy", { items: S.checkout.items });
      S.me.balance = r.balance;
      if (S.checkout.fromCart) { S.cart = []; saveCart(); }
      S.orders = null;
      hnotify("success");
      loadCatalog().then(() => { if (!sheetOpen()) render(); }).catch(() => {});
      showOrder(r.order, true);
      renderTop(); renderTabbar();
    } catch (e) {
      hnotify("error");
      toast(errText(e), true);
      btn.disabled = false;
      btn.textContent = T("checkout");
      if (["OUT_OF_STOCK", "PRODUCT_UNAVAILABLE"].includes(e.message)) loadCatalog().then(render).catch(() => {});
    }
  }

  function deliveredHtml(order) {
    S.copy = [];
    return (order.order_items || []).map((it) => {
      const items = (it.delivered || []).map((c) => {
        const i = S.copy.push(String(c)) - 1;
        return `<div class="delivered"><code>${h(c)}</code><button class="icon-btn" data-act="copy" data-i="${i}" aria-label="${h(T("copy"))}">⧉</button></div>`;
      }).join("");
      return `<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-weight:600">
        <span>${h(loc(it.title))} × ${it.qty}</span><span>${money(it.price * it.qty)}</span></div>${items}</div>`;
    }).join("");
  }

  function showOrder(order, justBought = false) {
    openSheet(`
      ${justBought ? `<div class="success-icon">✓</div><h2 class="sheet-title center" style="margin-bottom:4px">${h(T("order_done"))}</h2>
        <p class="muted center small" style="margin:0 0 10px">${h(T("order_done_sub"))}</p>`
        : `<h2 class="sheet-title">${h(T("order"))} #${order.id}</h2>`}
      <div class="card">
        <div class="kv"><span class="k">${h(T("order"))}</span><span class="v">#${order.id}</span></div>
        <div class="kv"><span class="k">${h(T("date"))}</span><span class="v">${h(fdate(order.created_at))}</span></div>
        <div class="kv"><span class="k">${h(T("status"))}</span><span class="v">${statusChip(order.status)}</span></div>
        <div class="kv"><span class="k">${h(T("total"))}</span><span class="v">${money(order.total)}</span></div>
      </div>
      <h3 class="section-title" style="font-size:16px">${h(T("your_items"))}</h3>
      ${deliveredHtml(order)}
      <button class="btn ghost block" style="margin-top:18px" data-act="close">${h(T("close"))}</button>
    `);
  }

  // ============================================================ orders
  async function loadOrders() {
    const box = $("#ordersBox");
    try {
      if (!S.orders) S.orders = await api("orders");
      if (S.tab !== "orders") return;
      if (!S.orders.length) {
        box.innerHTML = empty("🧾", T("no_orders"), `<button class="btn primary" style="margin-top:16px" data-act="go" data-tab="shop">${h(T("go_shop"))}</button>`);
        return;
      }
      box.innerHTML = `<div class="list">${S.orders.map((o) => `
        <button class="item" data-act="my-order" data-id="${o.id}">
          <div class="grow">
            <div class="title">${h(T("order"))} #${o.id}</div>
            <div class="sub">${h((o.order_items || []).map((i) => `${loc(i.title)} × ${i.qty}`).join(", "))}</div>
            <div class="sub">${h(fdate(o.created_at))}</div>
          </div>
          <div style="text-align:right"><div class="val">${money(o.total)}</div><div style="margin-top:4px">${statusChip(o.status)}</div></div>
        </button>`).join("")}</div>`;
    } catch (e) {
      box.innerHTML = empty("⚠️", errText(e), `<button class="btn ghost" style="margin-top:16px" data-act="reload-orders">${h(T("retry"))}</button>`);
    }
  }

  // ============================================================ profile
  function viewProfile() {
    const u = S.me;
    const photo = tg?.initDataUnsafe?.user?.photo_url;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
    return `<h1 class="page-title">${h(T("tab_profile"))}</h1>
      <div class="card">
        <div class="profile-head">
          <div class="avatar">${photo ? `<img src="${h(photo)}" alt="">` : h(name.charAt(0).toUpperCase())}</div>
          <div><div style="font-weight:700;font-size:17px">${h(name)}</div>
            <div class="muted small">${u.username ? "@" + h(u.username) : ""}</div></div>
        </div>
      </div>
      <div class="card glow hero">
        <span class="eyebrow">${h(T("balance"))}</span>
        <div class="hero-bal">${balHtml(u.balance)}</div>
        <div class="muted small">${h(T("top_up_hint"))}</div>
        <div class="hero-actions"><button class="btn primary" data-act="topup">${h(T("top_up"))}</button></div>
      </div>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><div class="k">${h(T("orders_count"))}</div><div class="v">${u.orders_count}</div></div>
        <div class="stat"><div class="k">${h(T("spent"))}</div><div class="v">${money(u.spent)}</div></div>
      </div>
      <div class="card" style="margin-top:12px;padding:4px 14px">
        <button class="menu-item" data-act="lang"><span class="ic">🌐</span><span class="grow">${h(T("language"))}</span><span class="muted">${I18N[S.lang].flag} ${h(I18N[S.lang].lang_name)}</span><span class="chev">›</span></button>
        <button class="menu-item" data-act="manager"><span class="ic">💬</span><span class="grow">${h(T("contact_manager"))}</span><span class="muted">@${h(S.settings.manager || "")}</span><span class="chev">›</span></button>
        <button class="menu-item" data-act="go" data-tab="orders"><span class="ic">🧾</span><span class="grow">${h(T("tab_orders"))}</span><span class="chev">›</span></button>
        ${isStaff() ? `<button class="menu-item" data-act="go" data-tab="admin"><span class="ic">🛡</span><span class="grow">${h(T("tab_admin"))}</span><span class="muted">${h(T("r_" + S.role))}</span><span class="chev">›</span></button>` : ""}
      </div>
      <div class="card" style="margin-top:12px">
        <div class="kv"><span class="k">${h(T("user_id"))}</span><span class="v"><button data-act="copy-val" data-v="${u.id}">${u.id} ⧉</button></span></div>
        <div class="kv"><span class="k">${h(T("joined"))}</span><span class="v">${h(fdate(u.created_at, false))}</span></div>
      </div>`;
  }

  function openLang(first = false) {
    S.langPick = S.lang;
    const draw = () => `
      <h2 class="sheet-title">${h(T("choose_lang"))}</h2>
      <p class="muted small" style="margin:-6px 0 14px">${h(T("lang_sub"))}</p>
      ${LANGS.map((l) => `<button class="lang-opt ${S.langPick === l ? "active" : ""}" data-act="lang-pick" data-l="${l}">
        <span class="flag">${I18N[l].flag}</span>${h(I18N[l].lang_name)}<span class="check"></span></button>`).join("")}
      <button class="btn primary block" style="margin-top:10px" data-act="lang-save">${h(T("continue"))}</button>`;
    S._langDraw = draw;
    openSheet(draw(), { locked: first });
  }

  // ============================================================ external links
  function openTg(url) {
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank");
  }
  function topup() {
    const bot = S.settings.bot_username;
    if (!bot) return toast(T("top_up_hint"));
    openTg(`https://t.me/${bot}?start=topup`);
  }
  function manager() {
    if (S.settings.manager) openTg(`https://t.me/${S.settings.manager}`);
  }

  // ============================================================ ADMIN
  function adminTabs() {
    const r = S.role;
    const t = ["dashboard"];
    if (r !== "manager") t.push("catalog");
    t.push("orders", "users", "deposits");
    if (r !== "manager") t.push("broadcast", "texts", "log");
    if (r === "owner") t.push("settings", "admins");
    return t;
  }
  function viewAdmin() {
    const tabs = adminTabs();
    if (!tabs.includes(S.admin.tab)) S.admin.tab = "dashboard";
    return `<h1 class="page-title">${h(T("tab_admin"))}</h1>
      <div class="underline-tabs admin-tabs">${tabs.map((t) =>
        `<button class="${S.admin.tab === t ? "active" : ""}" data-act="atab" data-t="${t}">${h(T("a_" + t))}</button>`).join("")}</div>
      <div id="adminBody">${spinner()}</div>`;
  }
  async function loadAdmin() {
    const el = $("#adminBody");
    if (!el) return;
    el.innerHTML = spinner();
    const tab = S.admin.tab;
    try {
      await A[tab](el);
    } catch (e) {
      if (S.admin.tab !== tab) return;
      el.innerHTML = empty("⚠️", errText(e), `<button class="btn ghost" style="margin-top:16px" data-act="admin-reload">${h(T("retry"))}</button>`);
    }
  }

  // ----- small form helpers
  const field = (label, inner, hint = "") => `<div class="field"><label>${h(label)}</label>${inner}${hint ? `<div class="hint">${h(hint)}</div>` : ""}</div>`;
  const input = (name, value = "", attrs = "") => `<input class="input" name="${name}" value="${h(value)}" ${attrs}>`;
  const textarea = (name, value = "", attrs = "") => `<textarea class="textarea" name="${name}" ${attrs}>${h(value)}</textarea>`;
  const toggle = (name, label, checked) => `<label class="toggle"><span>${h(label)}</span><input type="checkbox" name="${name}" ${checked ? "checked" : ""}></label>`;
  const val = (name, root = $("#sheetBody")) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  const checked = (name, root = $("#sheetBody")) => !!root.querySelector(`[name="${name}"]`)?.checked;

  // multi-language inputs: one visible at a time
  function langTabs(group) {
    return `<div class="lang-tabs">${LANGS.map((l, i) =>
      `<button type="button" class="${i === 0 ? "active" : ""}" data-act="ltab" data-g="${group}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div>`;
  }
  function mlInputs(group, name, values = {}, multiline = false, attrs = "") {
    return LANGS.map((l, i) => multiline
      ? `<textarea class="textarea ${i ? "hidden" : ""}" data-g="${group}" data-l="${l}" data-ml="${name}" ${attrs}>${h(values?.[l] || "")}</textarea>`
      : `<input class="input ${i ? "hidden" : ""}" data-g="${group}" data-l="${l}" data-ml="${name}" value="${h(values?.[l] || "")}" ${attrs}>`).join("");
  }
  function collectML(name, root = $("#sheetBody")) {
    const out = {};
    $$(`[data-ml="${name}"]`, root).forEach((el) => { if (el.value.trim()) out[el.dataset.l] = el.value.trim(); });
    return out;
  }

  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { hnotify("error"); toast(errText(e), true); return undefined; }
    finally { if (btn) btn.disabled = false; }
  }

  const A = {
    // ---------------------------------------------------------- dashboard
    async dashboard(el) {
      const s = await api("stats");
      const stat = (k, v, cls = "") => `<div class="stat ${cls}"><div class="k">${h(k)}</div><div class="v">${v}</div></div>`;
      el.innerHTML = `
        <div class="stats">
          ${stat(T("revenue") + " · " + T("today"), money(s.revenue_today), "accent wide")}
          ${stat(T("revenue") + " · " + T("d7"), money(s.revenue_7d))}
          ${stat(T("revenue") + " · " + T("d30"), money(s.revenue_30d))}
          ${stat(T("orders_n") + " · " + T("today"), s.orders_today)}
          ${stat(T("orders_n") + " · " + T("d30"), s.orders_30d)}
          ${stat(T("dep_crypto"), money(s.dep_crypto_30d))}
          ${stat(T("dep_card"), money(s.dep_card_30d))}
          ${stat(T("users_total"), s.users_total)}
          ${stat(T("users_new"), s.users_today)}
          ${stat(T("balances"), money(s.balances_total), "wide")}
        </div>
        <h3 class="section-title">${h(T("top_products"))}</h3>
        ${(s.top_products || []).length ? `<div class="list">${s.top_products.map((p, i) => `
          <div class="item"><span class="muted" style="width:18px">${i + 1}</span>
            <div class="grow"><div class="title">${h(loc(p.name))}</div><div class="sub">${p.qty} ${h(T("items"))}</div></div>
            <div class="val">${money(p.revenue)}</div></div>`).join("")}</div>` : `<div class="muted small">${h(T("no_data"))}</div>`}
        ${canEdit() ? `<h3 class="section-title">${h(T("export"))}</h3>
          <div class="row-actions" style="margin-top:0">
            <button class="btn ghost sm" data-act="export" data-type="orders">📦 ${h(T("exp_orders"))}</button>
            <button class="btn ghost sm" data-act="export" data-type="users">👥 ${h(T("exp_users"))}</button>
            <button class="btn ghost sm" data-act="export" data-type="deposits">💰 ${h(T("exp_deposits"))}</button>
          </div>` : ""}`;
    },

    // ---------------------------------------------------------- catalog
    async catalog(el) {
      const [cats, prods] = await Promise.all([api("cat_list"), api("prod_list")]);
      S.admin.cats = cats; S.admin.prods = prods;
      const pc = S.admin.prodCat;
      const list = pc === "all" ? prods : prods.filter((p) => String(p.category_id) === String(pc));
      const chip = (id, label) => `<button class="chip ${String(pc) === String(id) ? "active" : ""}" data-act="prod-filter" data-id="${id}">${h(label)}</button>`;
      el.innerHTML = `
        <div class="section-title" style="margin-top:4px">${h(T("categories"))}
          <button class="btn sm ghost" data-act="cat-edit">+ ${h(T("add"))}</button></div>
        ${cats.length ? `<div class="list">${cats.map((c) => `
          <button class="item" data-act="cat-edit" data-id="${c.id}">
            <span style="font-size:22px;width:28px;text-align:center">${h(c.icon || "📁")}</span>
            <div class="grow"><div class="title">${h(loc(c.name))}</div>
              <div class="sub">${c.products} · ${h(c.is_active ? T("active") : T("hidden"))}</div></div>
            <span class="chev muted">›</span></button>`).join("")}</div>` : `<div class="muted small">${h(T("no_data"))}</div>`}
        <div class="section-title">${h(T("products"))}
          <button class="btn sm primary" data-act="prod-edit">+ ${h(T("add"))}</button></div>
        <div class="chips" style="margin-top:0;margin-bottom:10px">${chip("all", T("all"))}${cats.map((c) => chip(c.id, loc(c.name))).join("")}</div>
        ${list.length ? `<div class="list">${list.map((p) => `
          <button class="item" data-act="prod-edit" data-id="${p.id}">
            <div class="thumb">${p.images?.[0] ? `<img src="${h(p.images[0])}" alt="">` : `<div class="ph">${h(loc(p.name).charAt(0))}</div>`}</div>
            <div class="grow"><div class="title">${h(loc(p.name))}</div>
              <div class="sub">${p.stock === null ? h(T("unlimited")) : h(T("stock_left", { n: p.stock }))} · ${h(T("sold"))}: ${p.sold}${p.is_active ? "" : " · " + h(T("hidden"))}</div></div>
            <div class="val">${money(p.price)}</div></button>`).join("")}</div>` : empty("📦", T("no_data"))}`;
    },

    // ---------------------------------------------------------- orders
    async orders(el, append = false) {
      const st = S.admin.ord ||= { status: "", q: "", offset: 0, items: [], count: 0 };
      if (!append) { st.offset = 0; st.items = []; }
      const r = await api("orders_list", { status: st.status, q: st.q, offset: st.offset });
      st.items = st.items.concat(r.items); st.count = r.count ?? st.items.length;
      const chip = (s, label) => `<button class="chip ${st.status === s ? "active" : ""}" data-act="ord-filter" data-s="${s}">${h(label)}</button>`;
      el.innerHTML = `
        <form class="toolbar" data-submit="ord-search"><input class="input" name="q" placeholder="${h(T("search_orders"))}" value="${h(st.q)}" inputmode="numeric"><button class="btn sm ghost">🔍</button></form>
        <div class="chips" style="margin-top:0;margin-bottom:12px">${chip("", T("all"))}${["new", "processing", "completed", "cancelled"].map((s) => chip(s, T("st_" + s))).join("")}</div>
        ${st.items.length ? `<div class="list">${st.items.map((o) => `
          <button class="item" data-act="a-order" data-id="${o.id}">
            <div class="grow"><div class="title">#${o.id} · ${h(userName({ ...o.users, id: o.user_id }))}</div>
              <div class="sub">${h((o.order_items || []).map((i) => `${loc(i.title)} × ${i.qty}`).join(", "))}</div>
              <div class="sub">${h(fdate(o.created_at))}</div></div>
            <div style="text-align:right"><div class="val">${money(o.total)}</div><div style="margin-top:4px">${statusChip(o.status)}</div></div>
          </button>`).join("")}</div>
          ${st.items.length < st.count ? `<button class="btn ghost block" style="margin-top:12px" data-act="more" data-t="orders">${h(T("load_more"))}</button>` : ""}`
        : empty("🧾", T("no_data"))}`;
    },

    // ---------------------------------------------------------- users
    async users(el, append = false) {
      const st = S.admin.usr ||= { q: "", offset: 0, items: [], count: 0 };
      if (!append) { st.offset = 0; st.items = []; }
      const r = await api("users_list", { q: st.q, offset: st.offset });
      st.items = st.items.concat(r.items); st.count = r.count ?? st.items.length;
      el.innerHTML = `
        <form class="toolbar" data-submit="usr-search"><input class="input" name="q" placeholder="${h(T("search_users"))}" value="${h(st.q)}"><button class="btn sm ghost">🔍</button></form>
        <div class="muted small" style="margin-bottom:10px">${h(T("users_total"))}: ${st.count}</div>
        ${st.items.length ? `<div class="list">${st.items.map((u) => `
          <button class="item" data-act="a-user" data-id="${u.id}">
            <div class="avatar" style="width:40px;height:40px;font-size:16px">${h((u.first_name || u.username || "?").charAt(0).toUpperCase())}</div>
            <div class="grow"><div class="title">${h([u.first_name, u.last_name].filter(Boolean).join(" ") || "—")} ${u.username ? `<span class="muted">@${h(u.username)}</span>` : ""}</div>
              <div class="sub">${u.id} · ${u.lang.toUpperCase()}${u.role !== "user" ? " · " + h(T("r_" + u.role)) : ""}${u.is_blocked ? " · ⛔ " + h(T("is_blocked")) : ""}</div></div>
            <div class="val">${money(u.balance)}</div></button>`).join("")}</div>
          ${st.items.length < st.count ? `<button class="btn ghost block" style="margin-top:12px" data-act="more" data-t="users">${h(T("load_more"))}</button>` : ""}`
        : empty("👥", T("no_data"))}`;
    },

    // ---------------------------------------------------------- deposits
    async deposits(el, append = false) {
      const st = S.admin.dep ||= { method: "", status: "", offset: 0, items: [], count: 0 };
      if (!append) { st.offset = 0; st.items = []; }
      const r = await api("deposits_list", { method: st.method, status: st.status, offset: st.offset });
      st.items = st.items.concat(r.items); st.count = r.count ?? st.items.length;
      const chipM = (m, label) => `<button class="chip ${st.method === m ? "active" : ""}" data-act="dep-filter" data-k="method" data-v="${m}">${h(label)}</button>`;
      const chipS = (s, label) => `<button class="chip ${st.status === s ? "active" : ""}" data-act="dep-filter" data-k="status" data-v="${s}">${h(label)}</button>`;
      el.innerHTML = `
        <div class="chips" style="margin-top:0">${chipM("", T("all"))}${chipM("crypto", "🪙 " + T("crypto"))}${chipM("card", "💳 " + T("card"))}</div>
        <div class="chips" style="margin-top:6px;margin-bottom:12px">${chipS("", T("all"))}${chipS("paid", T("paid"))}${chipS("pending", T("pending"))}${chipS("expired", T("expired"))}</div>
        ${st.items.length ? `<div class="list">${st.items.map((d) => `
          <button class="item" data-act="a-user" data-id="${d.user_id}">
            <span style="font-size:20px">${d.method === "crypto" ? "🪙" : d.method === "card" ? "💳" : "✍️"}</span>
            <div class="grow"><div class="title">#${d.user_no ?? d.id} · ${h(userName({ ...d.users, id: d.user_id }))}</div>
              <div class="sub">${d.paid_asset ? h(`${d.paid_amount} ${d.paid_asset}`) + " · " : ""}${d.comment ? h(d.comment) + " · " : ""}${h(fdate(d.paid_at || d.created_at))}</div></div>
            <div style="text-align:right"><div class="val">${money(d.amount_usd)}</div><div style="margin-top:4px">${statusChip(d.status)}</div></div>
          </button>`).join("")}</div>
          ${st.items.length < st.count ? `<button class="btn ghost block" style="margin-top:12px" data-act="more" data-t="deposits">${h(T("load_more"))}</button>` : ""}`
        : empty("💰", T("no_data"))}`;
    },

    // ---------------------------------------------------------- broadcast
    async broadcast(el) {
      el.innerHTML = `<form id="bcForm" data-submit="noop">
        ${field(T("bc_text"), textarea("text", "", 'style="min-height:140px"'))}
        ${field(T("bc_photo"), input("photo_url", "", 'placeholder="https://…"'))}
        ${field(T("bc_btn_text"), input("button_text"))}
        ${field(T("bc_btn_url"), input("button_url", "", 'placeholder="https://…"'))}
        ${field(T("bc_audience"), `<select class="select" name="lang"><option value="all">${h(T("bc_all"))}</option>
          ${LANGS.map((l) => `<option value="${l}">${I18N[l].flag} ${h(I18N[l].lang_name)}</option>`).join("")}</select>`)}
        <div class="row-actions">
          <button type="button" class="btn ghost" data-act="bc" data-test="1">${h(T("bc_test"))}</button>
          <button type="button" class="btn primary" data-act="bc">${h(T("bc_send"))}</button>
        </div></form>`;
    },

    // ---------------------------------------------------------- bot texts
    async texts(el) {
      const d = await api("texts_get");
      el.innerHTML = `<form id="txForm" data-submit="noop">
        <div class="field"><label>${h(T("welcome_text"))}</label>${langTabs("w")}${mlInputs("w", "welcome", d.welcome, true, 'style="min-height:140px"')}<div class="hint">${h(T("welcome_hint"))}</div></div>
        ${field(T("welcome_photo"), input("welcome_photo", d.welcome_photo, 'placeholder="https://…"'))}
        ${field(T("manager_username"), input("manager", d.manager ? "@" + d.manager : ""))}
        <div class="field"><label>${h(T("card_text"))}</label>${langTabs("c")}${mlInputs("c", "card_text", d.card_text, true)}<div class="hint">${h(T("card_hint"))}</div></div>
        <button type="button" class="btn primary block" data-act="texts-save">${h(T("save"))}</button></form>`;
    },

    // ---------------------------------------------------------- settings
    async settings(el) {
      const d = await api("settings_get");
      const ALL = ["USDT", "TON", "BTC", "ETH", "LTC", "BNB", "TRX", "USDC"];
      el.innerHTML = `<form id="stForm" data-submit="noop">
        ${field(T("shop_name"), input("shop_name", d.shop_name))}
        ${field(T("min_deposit"), input("min_deposit", d.min_deposit, 'inputmode="decimal"'))}
        ${field(T("quick_amounts"), input("quick_amounts", (d.quick_amounts || []).join(", ")))}
        <div class="field"><label>${h(T("coins"))}</label><div class="coins">${ALL.map((c) =>
          `<label><input type="checkbox" name="asset" value="${c}" ${d.assets.includes(c) ? "checked" : ""}>${c}</label>`).join("")}</div></div>
        ${toggle("maintenance", T("maintenance_mode"), d.maintenance)}
        <div class="field" style="margin-top:16px"><label>${h(T("sub_channel"))}</label>${input("sub_channel", d.sub_channel || "", 'placeholder="@channel"')}<div class="hint">${h(T("sub_channel_hint"))}</div></div>
        ${field(T("sub_link"), input("sub_link", d.sub_link || "", 'placeholder="https://t.me/+…"'))}
        <button type="button" class="btn primary block" style="margin-top:16px" data-act="settings-save">${h(T("save"))}</button></form>`;
    },

    // ---------------------------------------------------------- admins
    async admins(el) {
      const list = await api("admins_list");
      el.innerHTML = `
        <div class="list">${list.map((u) => `
          <div class="item"><div class="avatar" style="width:40px;height:40px;font-size:16px">${h((u.first_name || u.username || "#").charAt(0).toUpperCase())}</div>
            <div class="grow"><div class="title">${h(userName(u))}</div>
              <div class="sub">${u.id} · ${h(T("r_" + u.role))}${u.fixed ? " · " + h(T("from_config")) : ""}</div></div>
            ${u.fixed ? "" : `<button class="btn sm danger" data-act="admin-remove" data-id="${u.id}">${h(T("remove"))}</button>`}
          </div>`).join("")}</div>
        <h3 class="section-title">${h(T("add_admin"))}</h3>
        <form id="adForm" data-submit="noop">
          ${field(T("who"), input("who", "", 'placeholder="123456789 / @username"'), T("who_hint"))}
          ${field(T("role"), `<select class="select" name="role">
            <option value="manager">${h(T("r_manager"))}</option><option value="admin" selected>${h(T("r_admin"))}</option><option value="owner">${h(T("r_owner"))}</option></select>`)}
          <button type="button" class="btn primary block" data-act="admin-add">${h(T("add"))}</button>
        </form>
        <p class="hint" style="margin-top:14px;line-height:1.5">${h(T("roles_hint"))}</p>`;
    },

    // ---------------------------------------------------------- log
    async log(el, append = false) {
      const st = S.admin.log ||= { offset: 0, items: [] };
      if (!append) { st.offset = 0; st.items = []; }
      const r = await api("log_list", { offset: st.offset });
      st.items = st.items.concat(r); st.more = r.length === 50;
      el.innerHTML = st.items.length ? `<div class="list">${st.items.map((x) => `
        <div class="item"><div class="grow"><div class="title">${h(x.action)}</div>
          <div class="sub">${h(x.admin)} · ${h(fdate(x.created_at))}</div>
          ${x.details && Object.keys(x.details).length ? `<div class="sub">${h(JSON.stringify(x.details))}</div>` : ""}</div></div>`).join("")}</div>
        ${st.more ? `<button class="btn ghost block" style="margin-top:12px" data-act="more" data-t="log">${h(T("load_more"))}</button>` : ""}`
        : empty("📜", T("no_data"));
    },
  };

  // ----- category form
  function openCatForm(id) {
    const c = id ? S.admin.cats.find((x) => x.id === Number(id)) : { name: {}, is_active: true, sort: 0 };
    openSheet(`
      <h2 class="sheet-title">${h(id ? T("edit") : T("add"))} · ${h(T("categories"))}</h2>
      <div class="field"><label>${h(T("name"))}</label>${langTabs("cn")}${mlInputs("cn", "name", c.name)}<div class="hint">${h(T("name_hint"))}</div></div>
      ${field(T("icon"), input("icon", c.icon || "", 'placeholder="📚"'))}
      ${field(T("image_url"), input("image_url", c.image_url || "", 'placeholder="https://…"'))}
      ${field(T("sort"), input("sort", c.sort ?? 0, 'inputmode="numeric"'))}
      ${toggle("is_active", T("active"), c.is_active)}
      <div class="row-actions">
        ${id ? `<button class="btn danger" data-act="cat-delete" data-id="${id}">${h(T("delete"))}</button>` : ""}
        <button class="btn primary" data-act="cat-save" data-id="${id || ""}">${h(T("save"))}</button>
      </div>`);
  }

  // ----- product form
  function openProdForm(id) {
    const p = id ? S.admin.prods.find((x) => x.id === Number(id))
      : { name: {}, description: {}, images: [], delivery_type: "unique", is_active: true, sort: 0, price: "" };
    S.form = { id: id ? Number(id) : null, images: [...(p.images || [])] };
    openSheet(`
      <h2 class="sheet-title">${h(id ? T("edit") : T("add"))} · ${h(T("products"))}</h2>
      <div class="field"><label>${h(T("name"))} / ${h(T("description"))}</label>${langTabs("pn")}
        ${mlInputs("pn", "name", p.name)}<div style="height:8px"></div>${mlInputs("pn", "description", p.description, true, 'style="min-height:120px"')}
        <div class="hint">${h(T("name_hint"))}</div></div>
      ${field(T("category"), `<select class="select" name="category_id"><option value="">${h(T("no_category"))}</option>
        ${S.admin.cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? "selected" : ""}>${h(loc(c.name))}</option>`).join("")}</select>`)}
      ${field(T("price_usd"), input("price", p.price, 'inputmode="decimal" placeholder="9.99"'))}
      <div class="field"><label>${h(T("photos"))}</label>
        <div class="photo-row" id="photoRow"></div>
        <div class="toolbar" style="margin:8px 0 0"><input class="input" name="img_url" placeholder="https://…"><button type="button" class="btn sm ghost" data-act="img-add">${h(T("add"))}</button></div>
        <label class="btn ghost sm" style="margin-top:8px;width:max-content">📷 ${h(T("upload"))}<input type="file" accept="image/*" id="imgFile" hidden></label>
      </div>
      <div class="field"><label>${h(T("delivery"))}</label>
        <label class="radio"><input type="radio" name="delivery_type" value="unique" ${p.delivery_type !== "shared" ? "checked" : ""}><span>${h(T("d_unique"))}</span></label>
        <label class="radio"><input type="radio" name="delivery_type" value="shared" ${p.delivery_type === "shared" ? "checked" : ""}><span>${h(T("d_shared"))}</span></label>
      </div>
      <div class="field ${p.delivery_type === "shared" ? "" : "hidden"}" id="sharedBox"><label>${h(T("delivery_content"))}</label>${textarea("delivery_content", p.delivery_content || "")}</div>
      ${toggle("is_active", T("active"), p.is_active)}
      ${toggle("is_hot", T("hot_flag"), p.is_hot)}
      ${toggle("is_new", T("new_flag"), p.is_new)}
      <div style="height:12px"></div>
      ${field(T("sort"), input("sort", p.sort ?? 0, 'inputmode="numeric"'))}
      ${id && p.delivery_type !== "shared" ? `<button class="btn ghost block" data-act="stock" data-id="${id}">📦 ${h(T("manage_stock"))} · ${p.stock}</button>` : ""}
      <div class="row-actions">
        ${id ? `<button class="btn danger" data-act="prod-delete" data-id="${id}">${h(T("delete"))}</button>
                <button class="btn ghost" data-act="prod-dup" data-id="${id}">${h(T("duplicate"))}</button>` : ""}
        <button class="btn primary" data-act="prod-save">${h(T("save"))}</button>
      </div>`);
    drawPhotos();
    $("#imgFile").addEventListener("change", (e) => uploadImage(e.target));
  }
  function drawPhotos() {
    const row = $("#photoRow");
    if (!row) return;
    row.innerHTML = S.form.images.map((u, i) =>
      `<div class="photo"><img src="${h(u)}" alt=""><button type="button" data-act="img-del" data-i="${i}">✕</button></div>`).join("");
  }
  async function uploadImage(inputEl) {
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file) return;
    if (S.form.images.length >= 5) return;
    toast(T("loading"));
    try {
      const { base64, type } = await resizeImage(file, 1280);
      const r = await api("upload", { base64, type });
      S.form.images.push(r.url);
      drawPhotos();
    } catch (e) { toast(errText(e), true); }
  }
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        const data = c.toDataURL(type, 0.86);
        resolve({ base64: data.split(",")[1], type });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("BAD_FILE_TYPE")); };
      img.src = url;
    });
  }

  // ----- stock sheet
  async function openStock(id) {
    const p = S.admin.prods.find((x) => x.id === Number(id));
    openSheet(`<h2 class="sheet-title">${h(loc(p?.name))}</h2>${spinner()}`, { onClose: () => loadAdmin() });
    const items = await api("stock_list", { product_id: id }).catch(() => []);
    if (!sheetOpen()) return;
    $("#sheetBody").innerHTML = `
      <h2 class="sheet-title">${h(loc(p?.name))}</h2>
      <div class="field"><label>${h(T("stock_add"))}</label>${textarea("stock_text", "", 'style="min-height:120px" placeholder="KEY-AAAA-1111\nKEY-BBBB-2222"')}<div class="hint">${h(T("stock_hint"))}</div></div>
      <button class="btn primary block" data-act="stock-add" data-id="${id}">${h(T("add"))}</button>
      <h3 class="section-title">${h(T("items_in_stock"))} <span class="muted small">${items.length}</span></h3>
      ${items.length ? `<div class="list">${items.map((s) => `
        <div class="item"><code class="grow" style="font-size:12px;word-break:break-all;white-space:pre-wrap">${h(s.content)}</code>
          <button class="icon-btn" data-act="stock-del" data-id="${s.id}" data-p="${id}">✕</button></div>`).join("")}</div>`
        : `<div class="muted small">${h(T("no_data"))}</div>`}`;
  }

  // ----- admin order sheet
  async function openAdminOrder(id) {
    openSheet(spinner());
    let o;
    try { o = await api("order_get", { id }); } catch (e) { closeSheet(); return toast(errText(e), true); }
    const cancelled = o.status === "cancelled";
    $("#sheetBody").innerHTML = `
      <h2 class="sheet-title">${h(T("order"))} #${o.id}</h2>
      <div class="card">
        <div class="kv"><span class="k">${h(T("user"))}</span><span class="v"><button data-act="a-user" data-id="${o.user_id}" style="color:var(--blue-2)">${h(userName({ ...o.users, id: o.user_id }))} · ${o.user_id}</button></span></div>
        <div class="kv"><span class="k">${h(T("date"))}</span><span class="v">${h(fdate(o.created_at))}</span></div>
        <div class="kv"><span class="k">${h(T("total"))}</span><span class="v">${money(o.total)}</span></div>
        <div class="kv"><span class="k">${h(T("status"))}</span><span class="v">${statusChip(o.status)}</span></div>
      </div>
      ${deliveredHtml(o)}
      ${cancelled ? "" : `
        <h3 class="section-title" style="font-size:16px">${h(T("status"))}</h3>
        <div class="chips" style="margin:0">${["new", "processing", "completed"].map((s) =>
          `<button class="chip ${o.status === s ? "active" : ""}" data-act="ord-status" data-id="${o.id}" data-s="${s}">${h(T("st_" + s))}</button>`).join("")}</div>
        ${canEdit() ? `<div class="row-actions">
          <button class="btn danger" data-act="ord-cancel" data-id="${o.id}" data-refund="1" data-total="${o.total}">${h(T("cancel_refund"))}</button>
          <button class="btn ghost" data-act="ord-cancel" data-id="${o.id}" data-refund="0">${h(T("cancel_only"))}</button></div>` : ""}`}`;
  }

  // ----- admin user sheet
  async function openAdminUser(id) {
    openSheet(spinner());
    let d;
    try { d = await api("user_get", { id }); } catch (e) { closeSheet(); return toast(errText(e), true); }
    const u = d.user;
    $("#sheetBody").innerHTML = `
      <div class="profile-head" style="margin:6px 0 14px">
        <div class="avatar">${h((u.first_name || u.username || "?").charAt(0).toUpperCase())}</div>
        <div><div style="font-weight:700;font-size:18px">${h([u.first_name, u.last_name].filter(Boolean).join(" ") || "—")}</div>
          <div class="muted small">${u.username ? "@" + h(u.username) + " · " : ""}${u.id}</div></div>
      </div>
      <div class="card glow"><span class="eyebrow">${h(T("balance"))}</span><div class="hero-bal" style="font-size:34px">${balHtml(u.balance)}</div>
        ${canEdit() ? `<div class="hero-actions">
          <button class="btn primary" data-act="adjust" data-id="${u.id}" data-sign="1">+ ${h(T("credit"))}</button>
          <button class="btn ghost" data-act="adjust" data-id="${u.id}" data-sign="-1">− ${h(T("debit"))}</button></div>` : ""}
      </div>
      <div class="card">
        <div class="kv"><span class="k">${h(T("language"))}</span><span class="v">${I18N[u.lang]?.flag || ""} ${u.lang.toUpperCase()}</span></div>
        <div class="kv"><span class="k">${h(T("role"))}</span><span class="v">${h(T("r_" + u.role))}</span></div>
        <div class="kv"><span class="k">${h(T("joined"))}</span><span class="v">${h(fdate(u.created_at))}</span></div>
        <div class="kv"><span class="k">${h(T("is_blocked"))}</span><span class="v">${u.is_blocked ? "⛔" : "—"}</span></div>
      </div>
      <div class="row-actions">
        ${u.username ? `<button class="btn ghost" data-act="open-chat" data-u="${h(u.username)}">💬 Telegram</button>` : ""}
        ${canEdit() ? `<button class="btn ${u.is_blocked ? "ghost" : "danger"}" data-act="block" data-id="${u.id}" data-b="${u.is_blocked ? 0 : 1}">${h(u.is_blocked ? T("unblock") : T("block"))}</button>` : ""}
      </div>
      <h3 class="section-title" style="font-size:16px">${h(T("transactions"))}</h3>
      ${d.transactions.length ? `<div class="list">${d.transactions.map((x) => `
        <div class="item"><div class="grow"><div class="title">${h(T("tx_" + x.type))}</div>
          <div class="sub">${h(fdate(x.created_at))}${x.comment ? " · " + h(x.comment) : ""}</div></div>
          <div class="val" style="color:${x.amount >= 0 ? "var(--green)" : "var(--text)"}">${x.amount >= 0 ? "+" : "−"}${money(Math.abs(x.amount))}</div></div>`).join("")}</div>`
        : `<div class="muted small">${h(T("no_data"))}</div>`}
      <h3 class="section-title" style="font-size:16px">${h(T("tab_orders"))}</h3>
      ${d.orders.length ? `<div class="list">${d.orders.map((o) => `
        <button class="item" data-act="a-order" data-id="${o.id}"><div class="grow"><div class="title">#${o.id}</div><div class="sub">${h(fdate(o.created_at))}</div></div>
          <div style="text-align:right"><div class="val">${money(o.total)}</div><div style="margin-top:4px">${statusChip(o.status)}</div></div></button>`).join("")}</div>`
        : `<div class="muted small">${h(T("no_data"))}</div>`}`;
  }

  function openAdjust(id, sign) {
    const credit = sign > 0;
    openSheet(`
      <h2 class="sheet-title">${h(credit ? T("credit") : T("debit"))}</h2>
      ${field(T("amount"), input("amount", "", 'inputmode="decimal" placeholder="25"'))}
      ${credit ? `<div class="field"><label>${h(T("method"))}</label>
        <label class="radio"><input type="radio" name="method" value="card" checked><span>💳 ${h(T("m_card"))}</span></label>
        <label class="radio"><input type="radio" name="method" value="manual"><span>✍️ ${h(T("m_manual"))}</span></label></div>` : ""}
      ${field(T("comment"), input("comment"))}
      ${toggle("notify", T("notify_user"), true)}
      <button class="btn primary block" style="margin-top:16px" data-act="adjust-save" data-id="${id}" data-sign="${sign}">${h(T("save"))}</button>`);
  }

  // ============================================================ actions
  const ACT = {
    go: (el) => { closeSheet(true); go(el.dataset.tab); },
    reload: () => location.reload(),
    "sub-open": () => openTg(S.settings.sub_link),
    "sub-check": () => checkSub(true),
    close: () => closeSheet(),
    cat: (el) => { S.cat = el.dataset.id; haptic(); render(); },
    product: (el) => { haptic(); openProduct(el.dataset.id); },
    pqty: (el) => {
      const p = product(S.pq.id);
      S.pq.qty = Math.max(1, Math.min(maxQty(p), S.pq.qty + Number(el.dataset.d)));
      $("#pqty").textContent = S.pq.qty; haptic();
    },
    "add-cart": () => { addToCart(S.pq.id, S.pq.qty); hnotify("success"); closeSheet(); toast(T("added")); },
    "buy-now": () => openCheckout([{ id: S.pq.id, qty: S.pq.qty }], false),
    cqty: (el) => {
      const i = S.cart.find((x) => x.id === Number(el.dataset.id));
      const p = product(el.dataset.id);
      if (!i || !p) return;
      i.qty += Number(el.dataset.d);
      if (i.qty <= 0) S.cart = S.cart.filter((x) => x !== i); else i.qty = Math.min(maxQty(p), i.qty);
      saveCart(); haptic(); render();
    },
    "cart-clear": async () => { if (await confirmBox(T("clear") + "?")) { S.cart = []; saveCart(); render(); } },
    checkout: () => openCheckout(S.cart, true),
    pay: (el) => pay(el),
    copy: (el) => copyText(S.copy[Number(el.dataset.i)] ?? ""),
    "copy-val": (el) => copyText(el.dataset.v),
    "my-order": (el) => { const o = S.orders.find((x) => x.id === Number(el.dataset.id)); if (o) showOrder(o); },
    "reload-orders": () => { S.orders = null; render(); },
    topup: () => topup(),
    manager: () => manager(),
    "open-chat": (el) => openTg(`https://t.me/${el.dataset.u}`),
    lang: () => openLang(false),
    "lang-pick": (el) => { S.langPick = el.dataset.l; haptic(); $("#sheetBody").innerHTML = S._langDraw(); },
    "lang-save": async (el) => {
      await busy(el, async () => {
        await api("set_lang", { lang: S.langPick });
        S.lang = S.langPick; S.me.lang = S.langPick; S.me.lang_chosen = true;
        closeSheet(true); render();
      });
    },

    // ----- admin
    atab: (el) => { S.admin.tab = el.dataset.t; render(); },
    "admin-reload": () => loadAdmin(),
    more: async (el) => {
      const t = el.dataset.t;
      const st = { orders: S.admin.ord, users: S.admin.usr, deposits: S.admin.dep, log: S.admin.log }[t];
      st.offset += 50;
      await busy(el, () => A[t]($("#adminBody"), true));
    },
    export: (el) => busy(el, async () => { await api("export", { type: el.dataset.type }); toast(T("export_sent")); }),
    ltab: (el) => {
      const g = el.dataset.g, l = el.dataset.l;
      $$(`.lang-tabs button[data-g="${g}"]`).forEach((b) => b.classList.toggle("active", b === el));
      $$(`[data-g="${g}"][data-l]`).forEach((x) => { if (x.tagName !== "BUTTON") x.classList.toggle("hidden", x.dataset.l !== l); });
    },
    "cat-edit": (el) => openCatForm(el.dataset.id),
    "cat-save": (el) => busy(el, async () => {
      await api("cat_save", {
        id: el.dataset.id ? Number(el.dataset.id) : undefined, name: collectML("name"),
        icon: val("icon"), image_url: val("image_url"), sort: val("sort"), is_active: checked("is_active"),
      });
      toast(T("saved")); closeSheet(); loadAdmin(); loadCatalog().catch(() => {});
    }),
    "cat-delete": async (el) => {
      if (!(await confirmBox(T("confirm_delete")))) return;
      await busy(el, async () => { await api("cat_delete", { id: Number(el.dataset.id) }); closeSheet(); loadAdmin(); loadCatalog().catch(() => {}); });
    },
    "prod-filter": (el) => { S.admin.prodCat = el.dataset.id; loadAdmin(); },
    "prod-edit": (el) => openProdForm(el.dataset.id),
    "img-add": () => {
      const u = val("img_url").trim();
      if (!/^https?:\/\//.test(u) || S.form.images.length >= 5) return;
      S.form.images.push(u); $('[name="img_url"]').value = ""; drawPhotos();
    },
    "img-del": (el) => { S.form.images.splice(Number(el.dataset.i), 1); drawPhotos(); },
    "prod-save": (el) => busy(el, async () => {
      const dt = $('[name="delivery_type"]:checked')?.value || "unique";
      await api("prod_save", {
        id: S.form.id || undefined, name: collectML("name"), description: collectML("description"),
        category_id: val("category_id") || null, price: val("price").replace(",", "."), images: S.form.images,
        delivery_type: dt, delivery_content: val("delivery_content"),
        is_active: checked("is_active"), is_hot: checked("is_hot"), is_new: checked("is_new"), sort: val("sort"),
      });
      toast(T("saved")); closeSheet(); loadAdmin(); loadCatalog().catch(() => {});
    }),
    "prod-dup": (el) => busy(el, async () => { await api("prod_dup", { id: Number(el.dataset.id) }); toast(T("done")); closeSheet(); loadAdmin(); }),
    "prod-delete": async (el) => {
      if (!(await confirmBox(T("confirm_delete")))) return;
      await busy(el, async () => { await api("prod_delete", { id: Number(el.dataset.id) }); closeSheet(); loadAdmin(); loadCatalog().catch(() => {}); });
    },
    stock: (el) => openStock(el.dataset.id),
    "stock-add": (el) => busy(el, async () => {
      const r = await api("stock_add", { product_id: Number(el.dataset.id), text: val("stock_text") });
      toast(T("lines_added", { n: r.added })); hnotify("success");
      const onClose = sheetOnClose; await openStock(el.dataset.id); sheetOnClose = onClose;
    }),
    "stock-del": (el) => busy(el, async () => {
      await api("stock_delete", { ids: [Number(el.dataset.id)] });
      el.closest(".item")?.remove();
    }),
    "ord-filter": (el) => { S.admin.ord.status = el.dataset.s; loadAdmin(); },
    "a-order": (el) => openAdminOrder(Number(el.dataset.id)),
    "ord-status": (el) => busy(el, async () => {
      await api("order_status", { id: Number(el.dataset.id), status: el.dataset.s });
      toast(T("saved")); openAdminOrder(Number(el.dataset.id)); if (S.admin.tab === "orders") loadAdmin();
    }),
    "ord-cancel": async (el) => {
      const refund = el.dataset.refund === "1";
      const q = refund ? T("refund_q", { amount: Number(el.dataset.total).toFixed(2) }) : T("cancel_q");
      if (!(await confirmBox(q))) return;
      await busy(el, async () => {
        await api("order_cancel", { id: Number(el.dataset.id), refund });
        toast(T("done")); openAdminOrder(Number(el.dataset.id)); if (S.admin.tab === "orders") loadAdmin();
      });
    },
    "a-user": (el) => openAdminUser(Number(el.dataset.id)),
    adjust: (el) => openAdjust(Number(el.dataset.id), Number(el.dataset.sign)),
    "adjust-save": (el) => busy(el, async () => {
      const amount = Math.abs(Number(val("amount").replace(",", "."))) * Number(el.dataset.sign);
      if (!amount) throw new Error("BAD_AMOUNT");
      await api("user_adjust", {
        id: Number(el.dataset.id), amount, comment: val("comment"),
        method: $('[name="method"]:checked')?.value || "manual", notify: checked("notify"),
      });
      hnotify("success"); toast(T("saved"));
      openAdminUser(Number(el.dataset.id));
      if (["users", "deposits", "dashboard"].includes(S.admin.tab)) loadAdmin();
      if (Number(el.dataset.id) === S.me.id) refreshMe();
    }),
    block: (el) => busy(el, async () => {
      await api("user_block", { id: Number(el.dataset.id), blocked: el.dataset.b === "1" });
      toast(T("saved")); openAdminUser(Number(el.dataset.id)); if (S.admin.tab === "users") loadAdmin();
    }),
    "dep-filter": (el) => { S.admin.dep[el.dataset.k] = el.dataset.v; loadAdmin(); },
    bc: async (el) => {
      const f = $("#bcForm");
      const data = {
        text: val("text", f), photo_url: val("photo_url", f), button_text: val("button_text", f),
        button_url: val("button_url", f), lang: val("lang", f), test: !!el.dataset.test,
      };
      if (!data.text.trim()) return toast(T("e_EMPTY"), true);
      if (!data.test && !(await confirmBox(T("bc_confirm")))) return;
      await busy(el, async () => {
        const r = await api("broadcast", data);
        toast(data.test ? T("bc_test_sent") : T("bc_started", { n: r.recipients }));
      });
    },
    "texts-save": (el) => busy(el, async () => {
      const f = $("#txForm");
      await api("texts_save", {
        welcome: collectML("welcome", f), welcome_photo: val("welcome_photo", f),
        manager: val("manager", f), card_text: collectML("card_text", f),
      });
      toast(T("saved"));
      const me = await api("me"); setMe(me);
    }),
    "settings-save": (el) => busy(el, async () => {
      const f = $("#stForm");
      await api("settings_save", {
        shop_name: val("shop_name", f), min_deposit: val("min_deposit", f).replace(",", "."),
        quick_amounts: val("quick_amounts", f).split(/[,\s]+/).map(Number).filter((x) => x > 0),
        assets: $$('[name="asset"]:checked', f).map((x) => x.value), maintenance: checked("maintenance", f),
        sub_channel: val("sub_channel", f), sub_link: val("sub_link", f),
      });
      toast(T("saved"));
      const me = await api("me"); setMe(me); renderTop();
    }),
    "admin-add": (el) => busy(el, async () => {
      const f = $("#adForm");
      await api("admin_set", { who: val("who", f), role: val("role", f) });
      toast(T("saved")); loadAdmin();
    }),
    "admin-remove": async (el) => {
      if (!(await confirmBox(T("remove") + "?"))) return;
      await busy(el, async () => { await api("admin_remove", { id: Number(el.dataset.id) }); loadAdmin(); });
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-submit]");
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.submit;
    if (kind === "ord-search") { S.admin.ord.q = val("q", form); loadAdmin(); }
    if (kind === "usr-search") { S.admin.usr.q = val("q", form); loadAdmin(); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.name === "delivery_type") $("#sharedBox")?.classList.toggle("hidden", e.target.value !== "shared");
  });
  $("#sheetBackdrop").addEventListener("click", () => closeSheet());

  // ============================================================ init
  async function init() {
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.setHeaderColor("#0b0b10"); tg.setBackgroundColor("#0b0b10"); tg.setBottomBarColor?.("#101017"); } catch { /* */ }
      tg.BackButton?.onClick(onBack);
      try { tg.onEvent("activated", refreshMe); } catch { /* */ }
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshMe(); });

    if (!tg?.initData) return gate("🤖", T("open_in_tg"));
    $("#view").innerHTML = spinner();

    try {
      setMe(await api("me"));
    } catch (e) {
      return gate("⚠️", errText(e), true);
    }
    if (S.me.is_blocked) return gate("⛔", T("blocked"));
    if (S.settings.maintenance && S.role === "user") return gate("🛠", T("maintenance"), true);
    if (S.settings.sub_required) return subGate();

    try { await loadCatalog(); } catch (e) { return gate("⚠️", errText(e), true); }

    const page = new URLSearchParams(location.search).get("page");
    if (page === "admin" && isStaff()) S.tab = "admin";
    render();
    if (!S.me.lang_chosen) openLang(true);
  }

  document.addEventListener("touchstart", () => {}, { passive: true }); // enables :active press states on iOS
  const topbar = document.querySelector(".topbar");
  const onScroll = () => topbar?.classList.toggle("scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });

  init();
})();
