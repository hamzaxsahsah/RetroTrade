const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (path, opts = {}) => {
  const token = localStorage.getItem("rt_token");
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
};
const apiForm = async (path, formData) => {
  const token = localStorage.getItem("rt_token");
  const r = await fetch(path, { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {}, body: formData });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Upload failed");
  return data;
};
let ME = null, GEO = {}, FAVS = new Set();
async function refreshMe() {
  try { const d = await api("/api/auth/me"); ME = d.user; } catch { ME = null; }
  renderAuth();
}
async function refreshFavs() {
  if (!ME) { FAVS = new Set(); return; }
  try { FAVS = new Set(await api("/api/favorites")); } catch {}
  const el = $("#favCount"); if (el) el.textContent = FAVS.size || "";
}
async function refreshNotifs() {
  if (!ME) return;
  try {
    const n = await api("/api/notifications");
    const unread = n.filter((x) => !x.read).length;
    const b = $("#notifCount");
    if (unread) { b.style.display = ""; b.textContent = unread; } else b.style.display = "none";
    $("#notifList").innerHTML = n.length ? n.slice(0, 15).map((x) =>
      `<div class="py-2" style="border-bottom:1px solid var(--line)"><b>${esc(x.title)}</b><div class="text-sm">${esc(x.body)}</div>
       ${x.link ? `<a class="text-sm" style="color:var(--amber)" href="${esc(x.link)}">Open →</a>` : ""}</div>`).join("")
      : `<div class="empty">No notifications yet</div>`;
  } catch {}
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Top toast notifications (non-blocking replacement for alert()).
window.toast = (msg, type = "info") => {
  const box = document.getElementById("toasts") || (() => { const d = document.createElement("div"); d.id = "toasts"; document.body.appendChild(d); return d; })();
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.innerHTML = `<span>${esc(msg)}</span><button aria-label="dismiss">✕</button>`;
  el.querySelector("button").onclick = () => el.remove();
  box.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 3800);
};
const money = (l) => `${Number(l.price).toLocaleString()} ${esc(l.currency || "USD")}`;
// --- Location-based pricing: each country has a home currency; a static
// indicative FX table (units per 1 USD, no external API so it works offline)
// converts any listing price into the viewer's local currency.
const COUNTRY_FX = { France: "EUR", Germany: "EUR", Spain: "EUR", Italy: "EUR", "United Kingdom": "GBP", USA: "USD", Canada: "CAD", Japan: "JPY", Morocco: "MAD" };
const CURRS = ["USD", "EUR", "GBP", "CAD", "JPY", "MAD"];
const PER_USD = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, JPY: 149.5, MAD: 10.05 };
const langCur = () => {
  const g = (navigator.language || "en").toLowerCase();
  if (/^(fr|de|es|it|nl|pt|el)/.test(g)) return "EUR";
  if (g.startsWith("en-gb")) return "GBP";
  if (g.startsWith("ja")) return "JPY";
  if (g.startsWith("ar")) return "MAD";
  if (g.startsWith("en-ca") || g.startsWith("fr-ca")) return "CAD";
  return "USD";
};
const homeCur = () => (ME?.country && COUNTRY_FX[ME.country]) || langCur();
// Viewer's display currency: manual override > profile country > browser locale.
const viewCurrency = () => localStorage.getItem("rt_currency") || homeCur();
const fxTo = (amount, from, to) => (Number(amount) / (PER_USD[from] || 1)) * (PER_USD[to] || 1);
const fmtCur = (amount, cur) => {
  try { return new Intl.NumberFormat(navigator.language || "en", { style: "currency", currency: cur, maximumFractionDigits: ["JPY", "MAD"].includes(cur) ? 0 : 2 }).format(amount); }
  catch { return `${Number(amount).toLocaleString()} ${cur}`; }
};
// Localized price tag (converted) + original seller price as reference.
const priceTag = (l) => {
  const t = viewCurrency(), from = l.currency || "USD";
  if (from === t) return money(l);
  return `≈ ${fmtCur(fxTo(l.price, from, t), t)}`;
};
const origRef = (l) => {
  const t = viewCurrency(), from = l.currency || "USD";
  return from === t ? "" : `<span title="Seller's asking price">· ${money(l)}</span>`;
};
window.setCurrency = (c) => { if (c) localStorage.setItem("rt_currency", c); else localStorage.removeItem("rt_currency"); route(false); };
const img0 = (l) => (l.images && l.images[0] ? l.images[0].url : "https://picsum.photos/seed/" + l.id + "/500/500");
// Discogs-style collector grades (badge, not dropdown text)
const GRADE = { "Mint": ["NM", "grade-nm"], "Good": ["VG+", "grade-vg"], "Fair": ["Good", "grade-good"], "For Parts": ["Parts", "grade-parts"] };
const gradeOf = (c) => GRADE[c] || ["VG+", "grade-vg"];
const gradeBadge = (c) => { const [t, k] = gradeOf(c); return `<span class="grade ${k}" title="Condition: ${esc(c)}">${t}</span>`; };
// Design-lab variants: accent + card density (preview at #/design)
const DESIGNS = {
  a: { name: "A · Amber Classic", desc: "Amber accent, standard 240px cards", accent: "#f5a524" },
  b: { name: "B · Joystick Coral", desc: "Coral accent, compact 196px cards — denser rails", accent: "#ff6b35" },
  c: { name: "C · Cartridge Gold", desc: "Gold accent, airy 284px cards — fewer, bigger", accent: "#e8c547" },
};
const designId = () => localStorage.getItem("rt_design") || "a";
window.setDesign = (id) => { localStorage.setItem("rt_design", id); document.documentElement.dataset.design = id; route(false); };
// haversine km between two lat/lng
const km = (a, b, c, d) => {
  if (a == null || b == null || c == null || d == null) return null;
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const myPos = () => { try { return JSON.parse(localStorage.getItem("rt_pos") || "null"); } catch { return null; } };
const distChip = (l) => {
  const p = myPos();
  const d = p ? km(p.lat, p.lng, l.lat, l.lng) : null;
  if (d == null) return "";
  return `<span class="dist-chip">📍 ${d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km"} away</span>`;
};

function renderAuth() {
  $("#authArea").innerHTML = ME
    ? `<span class="text-sm hidden md:inline">Hi, <a style="color:var(--amber)" href="#/profile/${ME.id}">${esc(ME.name)}</a></span>
       <a class="btn ghost" href="#/dashboard">Dashboard</a> <a class="btn ghost" href="#/messages">Inbox</a>
       <button class="btn ghost" onclick="logout()">Logout</button>`
    : `<a class="btn ghost" href="#/auth">Login</a>`;
}
window.logout = () => { localStorage.removeItem("rt_token"); ME = null; location.hash = "#/"; location.reload(); };

function card(l) {
  const fav = FAVS.has(l.id) ? "♥" : "♡";
  const av = (l.seller?.name || "?")[0].toUpperCase();
  return `<div class="card" onclick="location.hash='#/listing/${l.id}'">
    <div class="imgwrap"><img loading="lazy" src="${img0(l)}" alt="">
      <span class="seller-ava" title="${esc(l.seller?.name || "seller")}">${esc(av)}</span>
      <span class="price-tag">${priceTag(l)}</span></div>
    <div class="meta">
      <div class="t">${esc(l.title)}</div>
      <div class="s">${esc(l.brand)}${l.brand && l.model ? " · " : ""}${esc(l.model)} ${origRef(l)}</div>
      <div class="flex gap-1 mt-1 items-center flex-wrap">${gradeBadge(l.condition)}
        ${l.status !== "active" ? `<span class="pill status-${l.status}">${esc(l.status)}</span>` : ""}
        ${distChip(l)}
        <button class="ml-auto" style="background:none;border:none;color:var(--muted);cursor:pointer" onclick="event.stopPropagation();toggleFav(${l.id})">${fav}</button></div>
    </div></div>`;
}
window.toggleFav = async (id) => {
  if (!ME) { location.hash = "#/auth"; return; }
  if (FAVS.has(id)) { await api(`/api/favorites/${id}`, { method: "DELETE" }); FAVS.delete(id); }
  else { await api(`/api/favorites/${id}`, { method: "POST" }); FAVS.add(id); }
  route();
};
function rail(title, sub, listings, id) {
  if (!listings.length) return "";
  return `<section class="my-6"><div class="flex items-baseline gap-3 mb-1">
    <h2 class="rail-title">${title}</h2><span class="text-sm" style="color:var(--muted)">${sub || ""}</span>
    <a class="text-sm ml-auto" style="color:var(--amber)" href="#/browse?rail=${id || ""}">See all →</a></div>
    <div class="rail-wrap"><button class="rail-btn left-0" style="left:-14px" onclick="scrollRail('${id}',-1)">‹</button>
    <div class="rail" id="rail-${id}">${listings.map(card).join("")}</div>
    <button class="rail-btn" style="right:-14px" onclick="scrollRail('${id}',1)">›</button></div></section>`;
}
window.scrollRail = (id, dir) => { const el = $("#rail-" + id); if (el) el.scrollBy({ left: dir * 540, behavior: "smooth" }); };

const CATS = [["console", "🎮 Consoles"], ["controller", "🕹 Controllers"], ["game", "💾 Games"], ["accessory", "🔌 Accessories"], ["bundle", "📦 Bundles"]];

// ---------- pages ----------
const HERO = {
  a: { kicker: "◈ PLAYER 1 · INSERT COIN", title: "TRADE PIXELS,<br>NOT JUST PRICES.", bg: "linear-gradient(120deg,#1a1a25,#2b1a4d 60%,#123b38)" },
  b: { kicker: "◈ HIGH SCORE · 16 LISTINGS LIVE", title: "HAGGLE LIKE<br>IT'S 1994.", bg: "linear-gradient(120deg,#211319,#3d1a2b 55%,#123b38)" },
  c: { kicker: "◈ RARE FINDS · GRADED & TRUE", title: "COLLECTOR-GRADE<br>RETRO, NEAR YOU.", bg: "linear-gradient(120deg,#14141c,#233046 60%,#3a2f14)" },
};
async function homePage() {
  const v = designId(), hero = HERO[v] || HERO.a;
  const [fresh, nintendo, sega, sony, dropped] = await Promise.all([
    api("/api/listings?sort=newest").catch(() => []),
    api("/api/listings?brand=Nintendo").catch(() => []),
    api("/api/listings?brand=Sega").catch(() => []),
    api("/api/listings?brand=Sony").catch(() => []),
    api("/api/listings?sort=price_asc").catch(() => []),
  ]);
  const ending = [...fresh].reverse().slice(0, 10);
  return `<div class="rounded-2xl p-8 mb-4" style="background:${hero.bg};border:1px solid var(--line)">
    <div class="text-xs font-bold" style="color:var(--teal);letter-spacing:.18em">${hero.kicker}</div>
    <div class="font-pixel text-lg md:text-2xl mt-2" style="color:var(--amber);line-height:1.7">${hero.title}</div>
    <p class="mt-3" style="color:var(--muted)">Retro consoles, controllers & cartridges. Make an offer, haggle in-chat, meet up & play.</p>
    <div class="flex gap-2 mt-4 flex-wrap"><a class="btn" href="#/browse">Browse the bazaar</a><a class="btn teal" href="#/sell/new">List your console</a>
    <a class="btn ghost" href="#/design">Design lab: ${DESIGNS[v].name} ▾</a></div></div>
  <div class="rail" style="padding-bottom:6px">${CATS.map(([cv, l]) => `<a class="chip" href="#/browse?category=${cv}">${l}</a>`).join("")}</div>
  <div id="rails">${rail("NEWLY LISTED", "fresh carts & consoles", fresh, "fresh")}
  ${rail("NINTENDO", "NES → GameCube", nintendo.length ? nintendo : fresh, "nin")}
  ${rail("SEGA", "Genesis, Saturn, Dreamcast", sega.length ? sega : fresh, "seg")}
  ${rail("SONY", "PS1, PS2 & more", sony.length ? sony : fresh, "son")}
  ${rail("PRICE-FRIENDLY FIRST", "lowest asking prices", dropped, "drop")}
  ${rail("ENDING SOON", "oldest active listings", ending, "end")}</div>`;
}
// Design lab: 2–3 hero + rail mock variations (accent × density) for review
async function designLabPage() {
  const sample = await api("/api/listings?sort=newest").catch(() => []);
  const cards = sample.slice(0, 5);
  const mock = (id) => {
    const d = DESIGNS[id], h = HERO[id];
    return `<div class="mock-frame" data-design="${id}" style="background:var(--bg)">
      <div class="p-5" style="background:${h.bg};border-bottom:1px solid var(--line)">
        <div class="text-xs font-bold" style="color:var(--teal);letter-spacing:.18em">${h.kicker}</div>
        <div class="font-pixel mt-2" style="color:var(--amber);font-size:15px;line-height:1.8">${h.title}</div>
        <div class="flex gap-2 mt-3"><span class="btn">Browse the bazaar</span><span class="btn teal">List yours</span></div></div>
      <div class="rail" style="padding:12px 12px 16px">
        ${cards.map((l) => `<div class="card"><div class="imgwrap"><img src="${img0(l)}">
          <span class="seller-ava">${esc(((l.seller?.name) || "?")[0])}</span>
          <span class="price-tag">${money(l)}</span></div>
          <div class="meta"><div class="t">${esc(l.title)}</div><div class="s">${esc(l.brand)} ${esc(l.model)}</div></div></div>`).join("")}
      </div>
      <div class="p-4 flex items-center gap-3" style="border-top:1px solid var(--line)">
        <span style="width:14px;height:14px;border-radius:4px;background:${d.accent};display:inline-block"></span>
        <div><b>Variant ${d.name}</b><div class="text-sm" style="color:var(--muted)">${d.desc}</div></div>
        <button class="btn ml-auto" onclick="setDesign('${id}');location.hash='#/'">${designId() === id ? "✓ Active" : "Use this"}</button>
      </div></div>`;
  };
  return `<h1 class="rail-title">DESIGN LAB</h1>
  <p class="mt-2 mb-4" style="color:var(--muted)">Three hero + rail directions — same layout, different accent color and card density. Pick one to apply it site-wide.</p>
  <div class="grid gap-6">${mock("a")}${mock("b")}${mock("c")}</div>`;
}

function filterState() {
  const h = location.hash;
  const qi = h.indexOf("?");
  const p = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
  return { country: p.get("country") || "", city: p.get("city") || "", category: p.get("category") || "", brand: p.get("brand") || "", condition: p.get("condition") || "", minPrice: p.get("minPrice") || "", maxPrice: p.get("maxPrice") || "", allowOffers: p.get("allowOffers") || "", ships: p.get("ships") || "", sort: p.get("sort") || "newest", search: ($("#search")?.value || p.get("search") || ""), view: p.get("view") || "list" };
}
const BRANDS = ["Nintendo", "Sega", "Sony", "Atari"];
async function browsePage() {
  const f = filterState();
  const qs = new URLSearchParams({ sort: f.sort });
  ["country", "city", "category", "brand", "condition", "minPrice", "maxPrice", "search"].forEach((k) => { if (f[k]) qs.set(k, f[k]); });
  if (f.allowOffers) qs.set("allowOffers", "1");
  if (f.ships === "ships") qs.set("ships", "1");
  if (f.ships === "pickup") qs.set("pickup", "1");
  const list = await api("/api/listings?" + qs.toString()).catch(() => []);
  const pos = myPos();
  if (f.sort === "nearest" && pos) {
    const d = (l) => km(pos.lat, pos.lng, l.lat, l.lng) ?? 1e9;
    list.sort((x, y) => d(x) - d(y));
  }
  const countries = Object.keys(GEO);
  const cities = f.country ? GEO[f.country] || [] : [];
  const isMap = f.view === "map";
  const qlink = (k, v) => {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    if (v) p.set(k, v); else p.delete(k);
    return `#/browse?${p.toString()}`;
  };
  // record-store crate rail (desktop left)
  const crate = `<aside class="crate-rail" style="width:230px;flex-shrink:0"><div class="flex flex-col gap-3">
    <div class="crate"><h4>Crates · category</h4>
      <a href="${qlink("category", "")}" class="${!f.category ? "on" : ""}">All crates</a>
      ${CATS.map(([v, l]) => `<a href="${qlink("category", v)}" class="${f.category === v ? "on" : ""}">${l}</a>`).join("")}</div>
    <div class="crate"><h4>Brand</h4>
      <a href="${qlink("brand", "")}" class="${!f.brand ? "on" : ""}">Any brand</a>
      ${BRANDS.map((b) => `<a href="${qlink("brand", b)}" class="${f.brand === b ? "on" : ""}">${b}</a>`).join("")}
      <div style="padding:8px 14px"><input id="f-brand" class="input" placeholder="Other brand…" value="${esc(BRANDS.includes(f.brand) ? "" : f.brand)}"></div></div>
    <div class="crate"><h4>Grade</h4><div style="padding:10px 14px"><div class="grade-pick">
      ${["", "Mint", "Good", "Fair", "For Parts"].map((c) => `<button class="${f.condition === c ? "on" : ""}" onclick="location.hash='${qlink("condition", c)}'">${c === "" ? "Any" : gradeOf(c)[0]}</button>`).join("")}
    </div></div></div>
    <div class="crate"><h4>Handoff</h4>
      <a href="${qlink("ships", "")}" class="${!f.ships ? "on" : ""}">Pickup or ships</a>
      <a href="${qlink("ships", "ships")}" class="${f.ships === "ships" ? "on" : ""}">📦 Ships</a>
      <a href="${qlink("ships", "pickup")}" class="${f.ships === "pickup" ? "on" : ""}">🤝 Local pickup</a></div>
  </div></aside>`;
  const topbar = `<div class="rounded-xl p-3 mb-3" style="background:var(--card);border:1px solid var(--line)">
    <div class="grid md:grid-cols-4 gap-2">
      <select id="f-country" class="input"><option value="">🌍 Country (all)</option>${countries.map((c) => `<option ${f.country === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      <select id="f-city" class="input"><option value="">📍 City (all)</option>${cities.map((c) => `<option ${f.city === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      <select id="f-sort" class="input"><option value="newest">Newest</option><option value="price_asc" ${f.sort === "price_asc" ? "selected" : ""}>Price ↑</option><option value="price_desc" ${f.sort === "price_desc" ? "selected" : ""}>Price ↓</option><option value="nearest" ${f.sort === "nearest" ? "selected" : ""}>Nearest</option></select>
      <div class="flex gap-2"><input id="f-min" type="number" class="input" placeholder="Min" value="${esc(f.minPrice)}"><input id="f-max" type="number" class="input" placeholder="Max" value="${esc(f.maxPrice)}"></div>
      <label class="text-sm flex items-center gap-2"><input type="checkbox" id="f-off" ${f.allowOffers ? "checked" : ""}> Offers ✓</label>
      <select id="f-cat-m" class="input md:hidden"><option value="">All categories</option>${CATS.map(([v, l]) => `<option value="${v}" ${f.category === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn" onclick="applyFilters()">Apply</button>
      <button class="btn ghost" onclick="nearMe()">📍 Near me</button>
      <select id="f-cur" class="input" title="Display currency" onchange="setCurrency(this.value || null)">
        <option value="">💱 ${viewCurrency()} auto</option>
        ${CURRS.map((c) => `<option value="${c}" ${localStorage.getItem("rt_currency") === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
    </div></div>`;
  const body = isMap
    ? `<div id="map" class="mt-1"></div>`
    : `<div class="mt-1">${list.map((l) => `<div class="rowitem" onclick="location.hash='#/listing/${l.id}'">
        <img src="${img0(l)}"><div class="flex-1"><b>${esc(l.title)}</b>
        <div class="text-sm mt-1 flex gap-1 items-center flex-wrap">${gradeBadge(l.condition)}<span style="color:var(--muted)">${esc(l.brand)} ${esc(l.model)}</span>${distChip(l)}</div>
        <div class="text-xs mt-1" style="color:var(--muted)">📍 ${esc(l.city)}, ${esc(l.country)}</div></div>
        <div class="text-right"><div class="font-extrabold" style="color:var(--amber)">${priceTag(l)}</div>
        <div class="text-xs" style="color:var(--muted)">${origRef(l)}</div>
        <button class="btn mt-2" onclick="event.stopPropagation();location.hash='#/listing/${l.id}'">View</button></div></div>`).join("") || `<div class="empty mt-4"><span class="pixel-ghost">⊙﹏⊙</span>No cartridges in this crate yet — <a style="color:var(--amber)" href="#/sell/new">be the first to list!</a> Try widening the search radius.</div>`}</div>`;
  setTimeout(() => {
    $("#f-country")?.addEventListener("change", (e) => {
      const cs = GEO[e.target.value] || [];
      $("#f-city").innerHTML = `<option value="">📍 City (all)</option>` + cs.map((c) => `<option>${c}</option>`).join("");
    });
    $("#f-brand")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { const p = new URLSearchParams(location.hash.split("?")[1] || ""); p.set("brand", e.target.value); location.hash = "#/browse?" + p.toString(); } });
    if (isMap && window.L) {
      const map = L.map("map").setView([48.85, 2.35], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      list.filter((l) => l.lat).forEach((l) => L.marker([l.lat, l.lng]).addTo(map).bindPopup(`<a href="#/listing/${l.id}"><b>${esc(l.title)}</b><br>${priceTag(l)}</a>`));
    }
  });
  return `<div class="flex items-center gap-3 mb-3">
      <h1 class="rail-title">BROWSE</h1><span style="color:var(--muted)" class="text-sm"><b>${list.length}</b> results</span>
      <span class="ml-auto view-toggle"><a href="${qlink("view", "")}" class="${!isMap ? "on" : ""}">☰ List</a><a href="${qlink("view", "map")}" class="${isMap ? "on" : ""}">🗺 Map</a></span>
    </div>
    <div class="flex gap-4 items-start"><div class="hidden md:block">${crate}</div>
    <div class="flex-1" style="min-width:0">${topbar}${body}</div></div>`;
}
window.applyFilters = () => {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  const v = (id) => $("#" + id)?.value;
  if (v("f-country")) p.set("country", v("f-country")); else p.delete("country");
  if (v("f-city")) p.set("city", v("f-city")); else p.delete("city");
  if (v("f-cat-m")) p.set("category", v("f-cat-m")); else if (!p.get("category") || v("f-cat-m") === "") { if (v("f-cat-m") === "") p.delete("category"); }
  if (v("f-brand")) p.set("brand", v("f-brand"));
  if (v("f-min")) p.set("minPrice", v("f-min")); else p.delete("minPrice");
  if (v("f-max")) p.set("maxPrice", v("f-max")); else p.delete("maxPrice");
  if ($("#f-off")?.checked) p.set("allowOffers", "1"); else p.delete("allowOffers");
  p.set("sort", v("f-sort") || "newest");
  location.hash = "#/browse?" + p.toString();
};
window.nearMe = () => {
  navigator.geolocation?.getCurrentPosition(async (pos) => {
    localStorage.setItem("rt_pos", JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    p.set("sort", "nearest");
    location.hash = `#/browse?${p.toString()}`;
    setTimeout(() => route(), 50);
  }, () => toast("Geolocation unavailable — allow location access to see distances.", "error"));
};

// sparkline of negotiation price movement (SVG polyline, teal)
function sparkline(offers, ask) {
  const pts = offers.map((o) => Number(o.amount));
  if (pts.length < 1) return `<div class="text-xs py-3 text-center" style="color:var(--muted)">No bids yet — open the book below.</div>`;
  const all = [...pts, Number(ask)];
  const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, 1);
  const W = 220, H = 44;
  const xy = pts.map((p, i) => [pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 8) + 4, H - 6 - ((p - lo) / span) * (H - 14)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const dots = xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3" fill="${i === xy.length - 1 ? "var(--purple)" : "var(--teal)"}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:48px;display:block">
    <polyline points="${line}" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linejoin="round"/>
    <line x1="0" x2="${W}" y1="${(H - 6 - ((ask - lo) / span) * (H - 14)).toFixed(1)}" y2="${(H - 6 - ((ask - lo) / span) * (H - 14)).toFixed(1)}" stroke="var(--purple)" stroke-dasharray="4 3" stroke-width="1" opacity=".7"/>${dots}</svg>`;
}
function ladderRows(offers) {
  if (!offers.length) return `<div class="text-xs py-2" style="color:var(--muted)">Ask: seller's price (dashed line). Be the first bidder.</div>`;
  return [...offers].slice(-6).reverse().map((o) =>
    `<div class="neg-row"><b style="color:var(--teal)">${Number(o.amount).toLocaleString()}</b>
     <span class="pill st-${o.status}">${o.status}</span>
     <span class="ml-auto text-xs" style="color:var(--muted)">${(o.created_at || "").slice(5, 16).replace(" ", " · ")}</span></div>`).join("");
}
async function listingPage(id) {
  const l = await api(`/api/listings/${id}`);
  const ladder = await api(`/api/listings/${id}/offers`).catch(() => []);
  const similar = await api(`/api/listings?brand=${encodeURIComponent(l.brand || l.category)}`).catch(() => []);
  const mine = ME && ME.id === l.seller_id;
  const gallery = l.images.length ? l.images.map((im, i) =>
    `<img src="${im.url}" class="rounded-lg cursor-pointer" style="width:100%;height:${i === 0 ? 340 : 90}px;object-fit:cover;border:${i === 0 ? "1px solid var(--line)" : "none"}" onclick="swapMain('${im.url}')">`).join("") : `<div class="empty"><span class="pixel-ghost">[ ]</span>No photos</div>`;
  setTimeout(() => { window.swapMain = (u) => { $("#mainImg").src = u; }; });
  const negPanel = `<div class="neg-panel mt-4"><div class="grid md:grid-cols-2">
    <div class="p-4" style="border-right:1px solid rgba(45,212,191,.25)">
      <div class="neg-head">Asking price</div>
      <div class="neg-ask">${priceTag(l)}</div>
      ${origRef(l)
        ? `<div class="text-xs mt-1" style="color:var(--muted)">Seller asking: <b>${money(l)}</b> · shown in your ${viewCurrency()} (indicative rate)</div>`
        : `<div class="text-xs mt-1" style="color:var(--muted)">Priced in ${esc(l.currency || "USD")}</div>`}
      <div class="text-xs mt-1" style="color:var(--muted)">${l.allow_offers ? "Seller accepts offers — bid on the right, or buy now." : "Fixed price — no offers on this one."}</div>
      ${!mine && l.status === "active" ? `<button class="btn mt-3" style="width:100%" onclick="buyNow(${l.id})">Buy at asking price</button>` : ""}
    </div>
    <div class="p-4">
      <div class="neg-head">Live bid book · ${ladder.length}</div>
      ${sparkline(ladder, l.price)}
      <div class="neg-ladder">${ladderRows(ladder)}</div>
      ${!mine && l.status === "active" && l.allow_offers ? `<button class="btn teal mt-2" style="width:100%" onclick="offerModal(${l.id},${l.price},'${esc(l.currency || "USD")}')">Place a bid</button>` : ""}
    </div></div></div>`;
  return `<div class="grid md:grid-cols-2 gap-6">
   <div><img id="mainImg" src="${img0(l)}" class="rounded-xl" style="width:100%;aspect-ratio:1/1;object-fit:cover;border:1px solid var(--line)">
     <div class="grid grid-cols-4 gap-2 mt-2">${gallery}</div></div>
   <div><h1 class="text-2xl font-extrabold">${esc(l.title)}</h1>
     <div class="flex gap-2 mt-2 flex-wrap items-center">${gradeBadge(l.condition)}
     <span class="pill">${esc(l.category)}</span><span class="pill status-${l.status}">${esc(l.status)}</span>${distChip(l)}</div>
     <div class="text-sm mt-2" style="color:var(--muted)">📍 ${esc(l.city)}, ${esc(l.country)} ${l.ships ? "· 📦 ships" : "· 🤝 local pickup"} · 👁 ${l.views || 0} views</div>
     <p class="mt-3">${esc(l.description)}</p>
     ${negPanel}
     <div class="rounded-xl p-3 mt-3 flex items-center gap-3" style="background:var(--card);border:1px solid var(--line)">
       <div class="seller-ava" style="position:static;border:none;width:40px;height:40px">${esc((l.seller?.name || "?")[0])}</div>
       <div><a style="color:var(--amber)" href="#/profile/${l.seller_id}"><b>${esc(l.seller?.name)}</b></a>
       <div class="text-xs" style="color:var(--muted)">★ ${Number(l.seller?.rating_avg || 0).toFixed(1)} (${l.seller?.rating_count || 0}) · since ${(l.seller?.created_at || "").slice(0, 10)}</div></div>
       <button class="btn ghost ml-auto" onclick="toggleFav(${l.id})">${FAVS.has(l.id) ? "♥ Saved" : "♡ Save"}</button></div>
     ${mine ? `<div class="flex gap-2 mt-4 flex-wrap"><a class="btn ghost" href="#/sell/new?edit=${l.id}">Edit</a>
        <button class="btn ghost" onclick="markSold(${l.id})">Mark sold</button>
        <button class="btn ghost" onclick="renew(${l.id})">Renew (+60d)</button>
        <button class="btn danger" onclick="delListing(${l.id})">Delete</button></div>`
       : `${l.status === "active" ? `<div class="stickybar rounded-xl mt-4">
        ${l.allow_offers ? `<button class="btn flex-1" onclick="offerModal(${l.id},${l.price},'${esc(l.currency || "USD")}')">Make an Offer</button>` : ""}
        <button class="btn ghost flex-1" onclick="messageSeller(${l.id})">Message seller</button></div>`
        : `<div class="mt-4"><span class="pill status-${l.status}">This listing is ${l.status}</span></div>`}`}
     <button class="btn ghost mt-2" onclick="report('listing',${l.id})">🚩 Report listing</button>
   </div></div>
   <section>${rail("SIMILAR LISTINGS", l.brand || l.category, similar.filter((x) => x.id !== l.id).slice(0, 12), "sim")}</section>`;
}
window.markSold = async (id) => { await api(`/api/listings/${id}/sold`, { method: "POST" }); route(); };
window.renew = async (id) => { await api(`/api/listings/${id}/renew`, { method: "POST" }); toast("Renewed!", "success"); route(); };
window.delListing = async (id) => { if (confirm("Delete?")) { await api(`/api/listings/${id}`, { method: "DELETE" }); location.hash = "#/dashboard"; } };
window.report = (type, id) => {
  $("#modalRoot").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3 class="font-extrabold text-lg">Report ${esc(type)}</h3>
    <input id="rep-reason" class="input mt-2" placeholder="Reason?">
    <div class="flex gap-2 mt-3"><button class="btn danger flex-1" onclick="sendReport('${type}',${id})">Report</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div></div></div>`;
};
window.sendReport = async (type, id) => {
  try {
    await api("/api/reports", { method: "POST", body: JSON.stringify({ target_type: type, target_id: id, reason: $("#rep-reason").value }) });
    closeModal(); toast("Reported, thanks!", "success");
  } catch (e) { toast(e.message, "error"); }
};
window.buyNow = async (id) => {
  if (!ME) { location.hash = "#/auth"; return; }
  const l = await api(`/api/listings/${id}`);
  const c = await api("/api/conversations", { method: "POST", body: JSON.stringify({ listing_id: id }) });
  await api(`/api/listings/${id}/offers`, { method: "POST", body: JSON.stringify({ amount: l.price, message: "Buying at asking price!" }) }).catch(() => {});
  location.hash = `#/messages/${c.id}`;
};
window.messageSeller = async (id) => {
  if (!ME) { location.hash = "#/auth"; return; }
  const c = await api("/api/conversations", { method: "POST", body: JSON.stringify({ listing_id: id }) });
  location.hash = `#/messages/${c.id}`;
};
window.offerModal = (id, price, cur = "USD") => {
  if (!ME) { location.hash = "#/auth"; return; }
  const t = viewCurrency();
  const conv = cur !== t ? `<p class="text-sm" style="color:var(--muted)">≈ ${fmtCur(fxTo(price, cur, t), t)} in your currency — offers are placed in <b>${esc(cur)}</b>.</p>` : "";
  $("#modalRoot").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3 class="font-extrabold text-lg">Make an offer</h3><p class="text-sm" style="color:var(--muted)">Asking: <b style="color:var(--amber)">${Number(price).toLocaleString()} ${esc(cur)}</b></p>${conv}
    <input id="o-amount" type="number" class="input mt-2" placeholder="Your price in ${esc(cur)}" value="${Math.round(price * 0.9)}">
    <textarea id="o-msg" class="input mt-2" placeholder="Message (optional)"></textarea>
    <div class="flex gap-2 mt-3"><button class="btn flex-1" onclick="sendOffer(${id})">Send offer</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div></div></div>`;
};
window.closeModal = () => { $("#modalRoot").innerHTML = ""; };
window.sendOffer = async (id) => {
  try {
    const o = await api(`/api/listings/${id}/offers`, { method: "POST", body: JSON.stringify({ amount: Number($("#o-amount").value), message: $("#o-msg").value }) });
    closeModal();
    if (o.autoDeclined) toast("Offer was below the seller's hidden minimum and was auto-declined. Try higher!", "error");
    else toast("Offer sent! Watch your inbox for a counter.", "success");
    if (o.conversationId) location.hash = `#/messages/${o.conversationId}`;
    else route();
  } catch (e) { toast(e.message, "error"); }
};

 // ---------- sell (multi-step) ----------
let SELL = { step: 0, images: [], title: "", description: "", category: "console", brand: "", model: "", condition: "Good", price: "", currency: "USD", allow_offers: true, min_offer: "", country: "", city: "", ships: false };
async function sellPage(editId) {
  if (!ME) { location.hash = "#/auth"; return ""; }
  if (editId) { const l = await api(`/api/listings/${editId}`); SELL = { step: 0, images: l.images.map((i) => i.url), ...l, price: l.price, min_offer: l.min_offer || "" }; SELL.editId = editId; }
  else if (!SELL.title && !SELL.price && !SELL.country) { SELL.currency = homeCur(); SELL.country = ME.country || ""; SELL.city = ME.city || ""; }
  const steps = ["Details", "Photos", "Price & offers", "Location", "Review"];
  const s = SELL.step;
  let body = "";
  if (s === 0) body = `<input id="s-title" class="input" placeholder="Title e.g. SNES PAL + 2 pads, boxed" value="${esc(SELL.title)}">
    <textarea id="s-desc" class="input mt-2" rows="4" placeholder="Description, defects, what's included…">${esc(SELL.description)}</textarea>
    <div class="grid grid-cols-2 gap-2 mt-2">
    <select id="s-cat" class="input">${CATS.map(([v, l]) => `<option value="${v}" ${SELL.category === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input id="s-brand" class="input" placeholder="Brand (Nintendo, Sega, Sony…)" value="${esc(SELL.brand)}">
    <input id="s-model" class="input" placeholder="Model (SNES, Genesis, PS1…)" value="${esc(SELL.model)}"></div>
    <div class="mt-2"><div class="text-xs font-bold mb-1" style="color:var(--muted);letter-spacing:.1em">CONDITION GRADE</div>
    <div class="grade-pick" id="s-grade">${["Mint", "Good", "Fair", "For Parts"].map((c) => `<button type="button" data-g="${c}" class="${SELL.condition === c ? "on" : ""}">${gradeOf(c)[0]} · ${c}</button>`).join("")}</div>
    <input id="s-cond" type="hidden" value="${esc(SELL.condition || "Good")}"></div>`;
  if (s === 1) body = `<div id="drop" class="drop">📷 Drag & drop photos here or click to browse<input type="file" id="s-files" accept="image/*" multiple hidden></div>
    <div id="thumbs" class="flex gap-2 mt-3 flex-wrap">${SELL.images.map((u, i) => `<div class="relative"><img src="${u}" class="thumb ${i === 0 ? "cover" : ""}" title="${i === 0 ? "cover" : ""}"><button class="absolute top-0 right-0" onclick="rmImg(${i})">✕</button></div>`).join("")}</div>
    <p class="text-xs mt-2" style="color:var(--muted)">First photo = cover. Click "Set cover" via reorder: use ← →.</p>`;
  if (s === 2) body = `<div class="grid grid-cols-2 gap-2"><input id="s-price" type="number" class="input" placeholder="Asking price" value="${esc(SELL.price)}">
    <select id="s-cur" class="input">${CURRS.map((c) => `<option ${SELL.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="text-xs mt-1" style="color:var(--muted)">💱 Currency auto-follows your location (next step) — buyers abroad see an indicative conversion.</div>
    <label class="text-sm flex gap-2 mt-2 items-center"><input type="checkbox" id="s-allow" ${SELL.allow_offers ? "checked" : ""}> Accept offers</label>
    <input id="s-min" type="number" class="input mt-2" placeholder="Hidden minimum auto-decline (optional)" value="${esc(SELL.min_offer)}">`;
  if (s === 3) body = `<div class="grid grid-cols-2 gap-2"><select id="s-country" class="input"><option value="">Country</option>${Object.keys(GEO).map((c) => `<option ${SELL.country === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <select id="s-city" class="input"><option value="">City</option>${(GEO[SELL.country] || []).map((c) => `<option ${SELL.city === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <label class="text-sm flex gap-2 mt-2 items-center"><input type="checkbox" id="s-ships" ${SELL.ships ? "checked" : ""}> Willing to ship</label>
    <input id="s-pick" class="input mt-2" placeholder="Pickup hint (e.g. near Gare de Lyon — exact pin shared after contact)" value="${esc(SELL.pickup_location || "")}">`;
  if (s === 4) body = `<div class="rounded-xl p-4" style="background:var(--bg2);border:1px solid var(--line)">
    <b>${esc(SELL.title)}</b><div style="color:var(--amber)" class="text-xl font-extrabold">${esc(SELL.price)} ${esc(SELL.currency)}</div>
    <div class="text-sm" style="color:var(--muted)">${esc(SELL.brand)} ${esc(SELL.model)} · ${esc(SELL.condition)} · 📍 ${esc(SELL.city)}, ${esc(SELL.country)} · ${SELL.images.length} photos</div></div>`;
  setTimeout(() => {
    $("#s-country")?.addEventListener("change", (e) => {
      $("#s-city").innerHTML = `<option value="">City</option>` + (GEO[e.target.value] || []).map((c) => `<option>${c}</option>`).join("");
      const hc = COUNTRY_FX[e.target.value]; // location drives price currency
      if (hc) SELL.currency = hc;
    });
    $$("#s-grade button").forEach((b) => b.onclick = () => {
      $("#s-cond").value = b.dataset.g;
      $$("#s-grade button").forEach((x) => x.classList.toggle("on", x === b));
    });
    const dz = $("#drop");
    if (dz) {
      dz.onclick = () => $("#s-files").click();
      ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
      ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
      dz.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));
      $("#s-files").addEventListener("change", (e) => uploadFiles(e.target.files));
    }
  });
  return `<h1 class="text-2xl font-extrabold">${SELL.editId ? "Edit listing" : "Sell your gear"}</h1>
  <div class="flex gap-2 my-4 flex-wrap">${steps.map((t, i) => `<span class="chip ${i === s ? "active" : ""}">${i + 1}. ${t}</span>`).join("")}</div>
  <div class="rounded-xl p-4" style="background:var(--card);border:1px solid var(--line)">${body}</div>
  <div class="flex gap-2 mt-4">${s > 0 ? `<button class="btn ghost" onclick="sellNav(-1)">← Back</button>` : ""}
  ${s < 4 ? `<button class="btn ml-auto" onclick="sellNav(1)">Next →</button>` : `<button class="btn ml-auto" onclick="publishListing()">${SELL.editId ? "Save changes" : "Publish listing 🚀"}</button>`}</div>`;
}
window.rmImg = (i) => { SELL.images.splice(i, 1); route(); };
async function uploadFiles(files) {
  const fd = new FormData();
  [...files].slice(0, 8).forEach((f) => fd.append("photos", f));
  const d = await apiForm("/api/upload", fd);
  SELL.images.push(...d.urls);
  route();
}
function collectSell() {
  const v = (id) => $("#" + id)?.value;
  if (SELL.step === 0) Object.assign(SELL, { title: v("s-title"), description: v("s-desc"), category: v("s-cat"), brand: v("s-brand"), model: v("s-model"), condition: v("s-cond") });
  if (SELL.step === 2) Object.assign(SELL, { price: v("s-price"), currency: v("s-cur"), allow_offers: $("#s-allow").checked, min_offer: v("s-min") });
  if (SELL.step === 3) Object.assign(SELL, { country: v("s-country"), city: v("s-city"), ships: $("#s-ships").checked, pickup_location: v("s-pick") });
}
window.sellNav = (d) => { collectSell(); SELL.step = Math.min(4, Math.max(0, SELL.step + d)); route(false); $("#app").scrollIntoView(); };
window.publishListing = async () => {
  collectSell();
  if (!SELL.title || !SELL.price) { toast("Title + price required", "error"); return; }
  const payload = { ...SELL, images: SELL.images };
  const url = SELL.editId ? `/api/listings/${SELL.editId}` : "/api/listings";
  const l = await api(url, { method: SELL.editId ? "PUT" : "POST", body: JSON.stringify(payload) });
  SELL = { step: 0, images: [], currency: homeCur() };
  location.hash = `#/listing/${l.id}`;
};

// ---------- dashboard / offers inbox ----------
async function dashboardPage() {
  if (!ME) { location.hash = "#/auth"; return ""; }
  const [mine, received, sent] = await Promise.all([
    api(`/api/listings?seller=${ME.id}&status=any`).catch(() => []),
    api("/api/offers?role=received").catch(() => []),
    api("/api/offers?role=sent").catch(() => []),
  ]);
  const openOffers = received.filter((o) => o.status === "pending" || o.status === "countered");
  const offerRow = (o, canActRow) => `<div class="rounded-xl p-3 mb-2" style="background:var(--bg2);border:1px solid var(--line)">
    <div class="flex gap-2 items-center"><b style="color:var(--amber)">${o.amount}</b>
    <span class="pill">${o.status}</span><span class="text-xs" style="color:var(--muted)">listing #${o.listing_id} · buyer #${o.buyer_id} · ${o.created_at}</span></div>
    ${o.message ? `<div class="text-sm mt-1">“${esc(o.message)}”</div>` : ""}
    ${canActRow ? `<div class="flex gap-2 mt-2 flex-wrap">
      <button class="btn" onclick="offerAct(${o.id},'accept')">Accept</button>
      <button class="btn ghost" onclick="offerAct(${o.id},'reject')">Reject</button>
      <button class="btn teal" onclick="counterModal(${o.id})">Counter</button></div>` : ""}</div>`;
  return `<h1 class="text-2xl font-extrabold">Seller dashboard</h1>
  <h2 class="font-bold mt-4 mb-2">📥 Offers received (${openOffers.length} open)</h2>
  ${received.slice(0, 20).map((o) => offerRow(o, o.status === "pending" || o.status === "countered")).join("") || `<div class="empty">No offers yet. Share your listings!</div>`}
  <h2 class="font-bold mt-6 mb-2">📤 My sent offers</h2>
  ${sent.slice(0, 10).map((o) => offerRow(o, false)).join("") || `<div class="empty">No sent offers.</div>`}
  <h2 class="font-bold mt-6 mb-2">🎮 My listings (${mine.length})</h2>
  <div class="rail" style="flex-wrap:wrap">${mine.map((l) => `<div class="card" onclick="location.hash='#/listing/${l.id}'">
    <div class="imgwrap"><img src="${img0(l)}"><span class="price-tag">${priceTag(l)}</span></div>
    <div class="meta"><div class="t">${esc(l.title)}</div><div class="s"><span class="pill status-${l.status}">${l.status}</span> 👁${l.views || 0}</div>
    <div class="flex gap-1 mt-1"><button class="btn ghost" onclick="event.stopPropagation();location.hash='#/sell/new?edit=${l.id}'">Edit</button>
    ${l.status !== "active" ? `<button class="btn ghost" onclick="event.stopPropagation();relist(${l.id})">Relist</button>` : `<button class="btn ghost" onclick="event.stopPropagation();renew(${l.id})">Renew</button>`}</div></div></div>`).join("") || `<div class="empty"><span class="pixel-ghost">▞▞</span>No listings yet.</div>`}</div>`;
}
window.relist = async (id) => { await api(`/api/listings/${id}/relist`, { method: "POST" }); route(); };
window.offerAct = async (id, action) => {
  try { const o = await api(`/api/offers/${id}/${action}`, { method: "POST" }); toast(action === "accept" ? "Accepted! Chat opened 🤝" : "Done.", "success"); if (o.conversationId) location.hash = `#/messages/${o.conversationId}`; else route(); }
  catch (e) { toast(e.message, "error"); }
};
window.counterModal = (id) => {
  $("#modalRoot").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3 class="font-extrabold">Counter-offer</h3><input id="c-amount" type="number" class="input mt-2" placeholder="New price">
    <input id="c-msg" class="input mt-2" placeholder="Message (optional)">
    <div class="flex gap-2 mt-3"><button class="btn flex-1" onclick="sendCounter(${id})">Send counter</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div></div></div>`;
};
window.sendCounter = async (id) => {
  try { await api(`/api/offers/${id}/counter`, { method: "POST", body: JSON.stringify({ amount: Number($("#c-amount").value), message: $("#c-msg").value }) }); closeModal(); toast("Counter-offer sent.", "success"); route(); }
  catch (e) { toast(e.message, "error"); }
};

// ---------- messages ----------
let POLL = null;
async function messagesPage() {
  if (!ME) { location.hash = "#/auth"; return ""; }
  const convs = await api("/api/conversations").catch(() => []);
  return `<h1 class="text-2xl font-extrabold">Inbox</h1>
  ${convs.map((c) => `<div class="rowitem" onclick="location.hash='#/messages/${c.id}'">
    <div class="w-12 h-12 rounded-full flex items-center justify-center font-extrabold shrink-0" style="background:var(--purple);color:#fff">${esc((c.other?.name || "?")[0])}</div>
    <div class="flex-1"><b>${esc(c.other?.name)} · ${esc(c.listing?.title)}</b>
    <div class="text-sm" style="color:var(--muted)">${esc(c.last_message?.content || "(offer card)")} ${c.agreed_price ? `· ✅ agreed ${c.agreed_price}` : ""}</div></div>
    <span class="pill">${esc(c.listing?.status || "")}</span></div>`).join("") || `<div class="empty"><span class="pixel-ghost">✉_✉</span>No conversations yet — make an offer on something!</div>`}`;
}
async function threadPage(cid) {
  if (!ME) { location.hash = "#/auth"; return ""; }
  const t = await api(`/api/conversations/${cid}`);
  clearInterval(POLL);
  POLL = setInterval(async () => {
    try {
      const fresh = await api(`/api/conversations/${cid}`);
      if (fresh.messages.length !== t.messages.length) route(false);
    } catch {}
  }, 4000);
  const isSeller = ME.id === t.seller_id;
  const msgs = t.messages.map((m) => {
    if (m.type === "offer_card") {
      const o = t.offers.find((x) => x.id === m.offer_id);
      if (!o) return "";
      const mine = m.sender_id === ME.id;
      const actionable = (o.status === "pending" || o.status === "countered") &&
        ((isSeller && m.sender_id !== ME.id) || (!isSeller && m.sender_id !== ME.id));
      return `<div class="offer-card"><div class="text-xs" style="color:var(--muted)">${mine ? "You" : esc(m.sender_name)} proposed ${o.status === "countered" ? "a counter" : "an offer"}</div>
        <div class="new">${o.amount} ${esc(t.listing.currency)}</div><div class="text-xs">status: <b>${o.status}</b></div>
        ${o.message ? `<div class="text-sm">“${esc(o.message)}”</div>` : ""}
        ${actionable ? `<div class="flex gap-2 mt-2"><button class="btn" onclick="offerAct(${o.id},'accept')">Accept</button>
        <button class="btn ghost" onclick="offerAct(${o.id},'reject')">Reject</button>
        <button class="btn teal" onclick="counterModal(${o.id})">Counter</button></div>` : ""}</div>`;
    }
    return `<div class="chat-b ${m.sender_id === ME.id ? "me" : "them"}">${esc(m.content)}</div>`;
  }).join("");
  return `<a class="text-sm" style="color:var(--amber)" href="#/messages">← Inbox</a>
  <div class="rounded-xl p-3 mt-2 flex gap-3 items-center" style="background:var(--card);border:1px solid var(--line)">
    <img src="${img0(t.listing)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px">
    <div><b>${esc(t.listing.title)}</b><div style="color:var(--amber)" class="font-extrabold">${t.agreed_price ? `✅ Agreed: ${t.agreed_price}` : money(t.listing)} </div></div>
    <a class="btn ghost ml-auto" href="#/listing/${t.listing.id}">View</a>
    <button class="btn teal" onclick="completeThread(${t.id})">Mark completed</button></div>
  <div class="rounded-xl p-3 mt-2" style="background:var(--bg2);border:1px solid var(--line);min-height:300px">${msgs || `<div class="empty">Say hi! Negotiate with offer cards above.</div>`}</div>
  <div class="stickybar rounded-xl mt-2"><input id="chat-in" class="input" placeholder="Write a message…" onkeydown="if(event.key==='Enter')sendMsg(${t.id})">
  <button class="btn" onclick="sendMsg(${t.id})">Send</button></div>`;
}
window.sendMsg = async (cid) => {
  const v = $("#chat-in").value;
  if (!v.trim()) return;
  await api(`/api/conversations/${cid}/messages`, { method: "POST", body: JSON.stringify({ content: v }) });
  route(false);
};
window.completeThread = async (cid) => {
  const c = await api(`/api/conversations/${cid}/complete`, { method: "POST" });
  toast(c.completed_by_buyer && c.completed_by_seller ? "Both confirmed — marked SOLD! 🎉 Please leave a review." : "Marked complete on your side. Waiting on the other party.", "success");
  route();
};

// ---------- profile / settings / favorites / admin / auth ----------
async function profilePage(id) {
  const d = await api(`/api/users/${id}`);
  const revs = await api(`/api/users/${id}/reviews`).catch(() => []);
  const mine = ME && ME.id === Number(id);
  return `<div class="rounded-xl p-5 flex gap-4 items-center" style="background:var(--card);border:1px solid var(--line)">
    <div class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-extrabold" style="background:var(--teal)">${esc(d.user.name[0])}</div>
    <div><h1 class="text-xl font-extrabold">${esc(d.user.name)}</h1>
    <div class="text-sm" style="color:var(--muted)">★ ${Number(d.user.rating_avg || 0).toFixed(1)} (${d.user.rating_count} trades) · 📍 ${esc(d.user.city)}, ${esc(d.user.country)} · since ${(d.user.created_at || "").slice(0, 10)}</div>
    <div class="text-sm mt-1">${esc(d.user.bio)}</div></div>
    ${mine ? `<a class="btn ghost ml-auto" href="#/settings">Edit</a>` : `<button class="btn ghost ml-auto" onclick="report('user',${id})">🚩 Report</button>`}</div>
  <h2 class="font-bold mt-4">Active listings</h2><div class="rail">${d.active_listings.map(card).join("") || "—"}</div>
  <h2 class="font-bold mt-4">Reviews</h2>${revs.map((r) => `<div class="rounded-xl p-3 mb-2" style="background:var(--card);border:1px solid var(--line)">★${r.rating} by <b>${esc(r.reviewer_name)}</b> — ${esc(r.comment)}</div>`).join("") || `<div class="empty">No reviews yet.</div>`}
  ${!mine && ME ? `<div class="rounded-xl p-3 mt-3" style="background:var(--bg2);border:1px solid var(--line)"><b>Leave a review</b>
    <div class="flex gap-2 mt-2"><select id="rv-s" class="input" style="max-width:100px"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    <input id="rv-c" class="input" placeholder="Comment"><button class="btn" onclick="sendReview(${id})">Post</button></div></div>` : ""}`;
}
window.sendReview = async (id) => {
  await api("/api/reviews", { method: "POST", body: JSON.stringify({ listing_id: 0, reviewee_id: id, rating: Number($("#rv-s").value), comment: $("#rv-c").value }) });
  route();
};
async function settingsPage() {
  if (!ME) { location.hash = "#/auth"; return ""; }
  setTimeout(() => {
    $("#set-country")?.addEventListener("change", (e) => { $("#set-city").innerHTML = (GEO[e.target.value] || []).map((c) => `<option>${c}</option>`).join(""); });
  });
  return `<h1 class="text-2xl font-extrabold">Settings</h1><div class="rounded-xl p-4 mt-3 grid gap-2" style="background:var(--card);border:1px solid var(--line);max-width:520px">
  <input id="set-name" class="input" value="${esc(ME.name)}" placeholder="Display name">
  <input id="set-bio" class="input" value="${esc(ME.bio || "")}" placeholder="Bio">
  <select id="set-country" class="input">${Object.keys(GEO).map((c) => `<option ${ME.country === c ? "selected" : ""}>${c}</option>`).join("")}</select>
  <select id="set-city" class="input">${(GEO[ME.country] || []).map((c) => `<option ${ME.city === c ? "selected" : ""}>${c}</option>`).join("")}</select>
  <label class="text-xs font-bold" style="color:var(--muted);letter-spacing:.1em">PRICES SHOWN IN</label>
  <select id="set-cur" class="input">
    <option value="">💱 Auto from my location (${homeCur()})</option>
    ${CURRS.map((c) => `<option value="${c}" ${localStorage.getItem("rt_currency") === c ? "selected" : ""}>${c}</option>`).join("")}
  </select>
  <button class="btn" onclick="saveSettings()">Save</button>
  <button class="btn ghost" onclick="toggleTheme()">Toggle light/dark</button></div>`;
}
window.saveSettings = async () => {
  const d = await api("/api/users/me", { method: "PUT", body: JSON.stringify({ name: $("#set-name").value, bio: $("#set-bio").value, country: $("#set-country").value, city: $("#set-city").value }) });
  ME = d.user;
  const c = $("#set-cur").value;
  if (c) localStorage.setItem("rt_currency", c); else localStorage.removeItem("rt_currency");
  toast("Saved!", "success"); route();
};
window.toggleTheme = () => {
  const h = document.documentElement;
  h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("rt_theme", h.dataset.theme);
};
async function favoritesPage() {
  if (!ME) { location.hash = "#/auth"; return ""; }
  const ids = [...FAVS];
  const list = ids.length ? await api(`/api/listings?ids=${ids.join(",")}&status=any`).catch(() => []) : [];
  return `<h1 class="text-2xl font-extrabold">♥ Watchlist</h1><div class="rail mt-3" style="flex-wrap:wrap">${list.map(card).join("") || `<div class="empty"><span class="pixel-ghost">♥_♥</span>Nothing saved yet.</div>`}</div>`;
}
async function adminPage() {
  if (!ME?.is_admin) return `<div class="empty">Admin only. Login as admin@retrotrade.gg / admin123</div>`;
  const [stats, reps] = await Promise.all([api("/api/admin/stats"), api("/api/admin/reports")]);
  return `<h1 class="text-2xl font-extrabold">Moderation</h1>
  <div class="flex gap-2 mt-2">${["users", "listings", "offers", "open_reports"].map((k) => `<span class="pill">${k}: <b>${stats[k]}</b></span>`).join("")}</div>
  ${reps.map((r) => `<div class="rounded-xl p-3 mt-2 flex gap-2 items-center" style="background:var(--card);border:1px solid var(--line)">
    <span class="pill">${r.status}</span><b>${esc(r.target_type)} #${r.target_id}</b><span class="text-sm">${esc(r.reason)}</span>
    <span class="ml-auto flex gap-2"><button class="btn ghost" onclick="resolveRep(${r.id},'dismiss')">Dismiss</button>
    <button class="btn danger" onclick="resolveRep(${r.id},'remove')">Remove</button></span></div>`).join("") || `<div class="empty"><span class="pixel-ghost">★彡</span>No reports — the arcade is peaceful.</div>`}`;
}
window.resolveRep = async (id, action) => { await api(`/api/admin/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ action }) }); route(); };
function authPage() {
  // NOTE: no <script> tags here — scripts injected via innerHTML never execute.
  setTimeout(() => {
    document.getElementById("a-country")?.addEventListener("change", (e) => {
      document.getElementById("a-city").innerHTML = (GEO[e.target.value] || []).map((c) => "<option>" + c + "</option>").join("");
    });
    renderGoogleBtn(0);
  }, 0);
  return `<div class="max-w-md mx-auto rounded-xl p-6" style="background:var(--card);border:1px solid var(--line)">
  <div class="rail-title" style="color:var(--amber)">LOGIN / SIGNUP</div>
  <input id="a-name" class="input mt-3" placeholder="Display name (signup only)">
  <input id="a-email" class="input mt-2" placeholder="Email" value="admin@retrotrade.gg">
  <input id="a-pass" type="password" class="input mt-2" placeholder="Password" value="admin123">
  <div class="grid grid-cols-2 gap-2 mt-2"><select id="a-country" class="input"><option value="">Country</option>${Object.keys(GEO).map((c) => `<option>${c}</option>`).join("")}</select>
  <select id="a-city" class="input"><option value="">City</option></select></div>
  <div class="flex gap-2 mt-3"><button class="btn flex-1" onclick="doLogin()">Login</button><button class="btn teal flex-1" onclick="doRegister()">Sign up</button></div>
  <div class="flex items-center gap-2 my-3"><span style="flex:1;border-top:1px solid var(--line)"></span><span class="text-xs" style="color:var(--muted)">or</span><span style="flex:1;border-top:1px solid var(--line)"></span></div>
  <div id="googleBtn" class="flex justify-center"></div>
  </div>`;
}
// Google Identity Services button (rendered only when a client ID is configured).
let GOOGLE_ID = "";
function renderGoogleBtn(tries = 0) {
  const el = document.getElementById("googleBtn");
  if (!el) return;
  if (!GOOGLE_ID) {
    el.innerHTML = `<p class="text-xs text-center" style="color:var(--muted)">Google login activates once a client ID is set in <b>.env</b>.</p>`;
    return;
  }
  if (!window.google?.accounts?.id) {
    if (tries < 10) return void setTimeout(() => renderGoogleBtn(tries + 1), 500); // GIS still loading
    el.innerHTML = `<p class="text-xs text-center" style="color:var(--muted)">Couldn't load Google's script — check connection/adblocker and refresh.</p>`;
    return;
  }
  try {
    window.google.accounts.id.initialize({ client_id: GOOGLE_ID, callback: onGoogleSignIn });
    window.google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with" });
  } catch (e) {
    el.innerHTML = `<p class="text-xs text-center" style="color:var(--muted)">Google button error: ${esc(e.message)} — verify the origin in Cloud Console.</p>`;
  }
}
window.onGoogleSignIn = async (resp) => {
  try {
    const d = await api("/api/auth/google", { method: "POST", body: JSON.stringify({ idToken: resp.credential }) });
    localStorage.setItem("rt_token", d.token); ME = d.user;
    location.hash = "#/"; location.reload();
  } catch (e) { toast(e.message, "error"); }
};
window.doLogin = async () => {
  try { const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("#a-email").value, password: $("#a-pass").value }) }); localStorage.setItem("rt_token", d.token); ME = d.user; location.hash = "#/"; location.reload(); }
  catch (e) { toast(e.message, "error"); }
};
window.doRegister = async () => {
  try { const d = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ name: $("#a-name").value || "Player1", email: $("#a-email").value, password: $("#a-pass").value, country: $("#a-country").value, city: $("#a-city").value }) }); localStorage.setItem("rt_token", d.token); ME = d.user; location.hash = "#/"; location.reload(); }
  catch (e) { toast(e.message, "error"); }
};

// ---------- router ----------
async function route(extra = {}) {
  clearInterval(POLL);
  const h = location.hash || "#/";
  const [pathQ] = [h.slice(1)];
  const qi = pathQ.indexOf("?");
  const path = qi >= 0 ? pathQ.slice(0, qi) : pathQ;
  const seg = path.split("/").filter(Boolean);
  const app = $("#app");
  app.innerHTML = `<div class="flex gap-3">${`<div class="skel"></div>`.repeat(4)}</div>`;
  try {
    if (seg.length === 0) app.innerHTML = await homePage();
    else if (seg[0] === "browse") app.innerHTML = await browsePage(extra);
    else if (seg[0] === "listing") app.innerHTML = await listingPage(seg[1]);
    else if (seg[0] === "sell") app.innerHTML = await sellPage(new URLSearchParams(location.hash.split("?")[1] || "").get("edit"));
    else if (seg[0] === "dashboard") app.innerHTML = await dashboardPage();
    else if (seg[0] === "messages" && seg[1]) app.innerHTML = await threadPage(seg[1]);
    else if (seg[0] === "messages") app.innerHTML = await messagesPage();
    else if (seg[0] === "profile") app.innerHTML = await profilePage(seg[1]);
    else if (seg[0] === "settings") app.innerHTML = await settingsPage();
    else if (seg[0] === "favorites") app.innerHTML = await favoritesPage();
    else if (seg[0] === "design") app.innerHTML = await designLabPage();
    else if (seg[0] === "admin") app.innerHTML = await adminPage();
    else if (seg[0] === "auth") app.innerHTML = authPage();
    else app.innerHTML = `<div class="empty">404 — <a href="#/">home</a></div>`;
  } catch (e) { app.innerHTML = `<div class="empty">⚠ ${esc(e.message)}</div>`; }
  refreshNotifs();
}
window.addEventListener("hashchange", () => route());

// ---------- boot ----------
(async () => {
  document.documentElement.dataset.theme = localStorage.getItem("rt_theme") || "dark";
  document.documentElement.dataset.design = designId();
  GEO = await api("/api/geo").catch(() => ({}));
  GOOGLE_ID = (await api("/api/config").catch(() => ({}))).googleClientId || "";
  await refreshMe();
  await refreshFavs();
  $("#themeBtn").onclick = () => window.toggleTheme();
  $("#notifBtn").onclick = async () => {
    const p = $("#notifPanel");
    p.style.display = p.style.display === "none" ? "" : "none";
    await api("/api/notifications/read", { method: "POST" }).catch(() => {});
    setTimeout(refreshNotifs, 1500);
  };
  let deb = null;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 2) { $("#suggest").style.display = "none"; return; }
      const s = await api(`/api/suggest?q=${encodeURIComponent(q)}`).catch(() => []);
      $("#suggest").innerHTML = s.map((x) => `<div class="p-2 hover:opacity-80 cursor-pointer" onclick="document.getElementById('search').value='${esc(x.brand)} ${esc(x.model)}';document.getElementById('suggest').style.display='none';location.hash='#/browse?brand=${encodeURIComponent(x.brand)}'"><b>${esc(x.brand)}</b> ${esc(x.model)}</div>`).join("");
      $("#suggest").style.display = s.length ? "" : "none";
    }, 250);
  });
  $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = `#/browse?search=${encodeURIComponent(e.target.value)}`; });
  setInterval(refreshNotifs, 15000);
  route();
})();
