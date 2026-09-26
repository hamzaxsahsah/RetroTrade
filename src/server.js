import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { OAuth2Client } from "google-auth-library";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, initDb, notify } from "./db.js";
import { validateNewOffer, checkAutoDecline, canAct, makeCounter } from "./offerEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || "retrotrade-dev-secret";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const EXPIRY_DAYS = Number(process.env.LISTING_EXPIRY_DAYS || 60);

initDb();
// expire old listings opportunistically
try {
  db.prepare("UPDATE listings SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < datetime('now')").run();
} catch {}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(path.join(ROOT, "public")));

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".jpg");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- helpers ----------
const row = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}
function auth(required = true) {
  return (req, _res, next) => {
    const h = req.headers.authorization || "";
    const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
    req.user = null;
    if (tok) {
      try {
        const dec = jwt.verify(tok, JWT_SECRET);
        req.user = row("SELECT * FROM users WHERE id=?", dec.id) || null;
      } catch {}
    }
    if (required && !req.user) return next({ status: 401, message: "Login required" });
    next();
  };
}
function listingWithImages(l) {
  if (!l) return l;
  const imgs = all("SELECT * FROM listing_images WHERE listing_id=? ORDER BY sort_order, id", l.id);
  const seller = row("SELECT id,name,avatar_url,country,city,rating_avg,rating_count,created_at FROM users WHERE id=?", l.seller_id);
  return { ...l, allow_offers: !!l.allow_offers, ships: !!l.ships, images: imgs, seller };
}
function getOrCreateConversation(listingId, buyerId, sellerId) {
  let c = row("SELECT * FROM conversations WHERE listing_id=? AND buyer_id=?", listingId, buyerId);
  if (!c) {
    const r = db.prepare("INSERT INTO conversations (listing_id,buyer_id,seller_id) VALUES (?,?,?)").run(listingId, buyerId, sellerId);
    c = row("SELECT * FROM conversations WHERE id=?", r.lastInsertRowid);
  }
  return c;
}

// ---------- geo reference ----------
export const GEO = {
  France: ["Paris", "Lyon", "Marseille", "Bordeaux", "Lille", "Nantes"],
  Germany: ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt"],
  "United Kingdom": ["London", "Manchester", "Birmingham", "Glasgow", "Bristol"],
  Spain: ["Madrid", "Barcelona", "Valencia", "Seville"],
  Italy: ["Milan", "Rome", "Naples", "Turin"],
  USA: ["New York", "Los Angeles", "Chicago", "Austin", "Seattle"],
  Canada: ["Toronto", "Montreal", "Vancouver"],
  Japan: ["Tokyo", "Osaka", "Kyoto"],
  Morocco: ["Casablanca", "Rabat", "Marrakech", "Fes"],
};
app.get("/api/geo", (_req, res) => res.json(GEO));
// Public client config (safe to expose: client ID is public by design).
// Returns "" until a real ID is pasted into .env, so the UI shows setup hint.
app.get("/api/config", (_req, res) => res.json({
  googleClientId: GOOGLE_CLIENT_ID.includes("paste-your-client-id") ? "" : GOOGLE_CLIENT_ID,
}));

// ---------- auth ----------
app.post("/api/auth/register", (req, res, next) => {
  try {
    const { name, email, password, country = "", city = "" } = req.body;
    if (!name || !email || !password) return next({ status: 400, message: "name, email, password required" });
    if (row("SELECT id FROM users WHERE email=?", email)) return next({ status: 400, message: "Email already registered" });
    const hash = bcrypt.hashSync(password, 10);
    const isAdmin = email === "admin@retrotrade.gg" ? 1 : 0;
    const r = db.prepare("INSERT INTO users (name,email,password_hash,country,city,is_admin) VALUES (?,?,?,?,?,?)")
      .run(name, email, hash, country, city, isAdmin);
    const user = row("SELECT * FROM users WHERE id=?", r.lastInsertRowid);
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) { next(e); }
});
app.post("/api/auth/login", (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = row("SELECT * FROM users WHERE email=?", email);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return next({ status: 401, message: "Invalid email or password" });
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) { next(e); }
});
app.get("/api/auth/me", auth(), (req, res) => res.json({ user: publicUser(req.user) }));
// Google login: frontend sends the GIS ID token, we verify signature+audience,
// then find-or-create the user (matched by google_id, else verified email).
app.post("/api/auth/google", async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return next({ status: 400, message: "idToken required" });
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes("paste-your-client-id"))
      return next({ status: 503, message: "Google login not configured — set GOOGLE_CLIENT_ID in .env" });
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.email_verified || !p?.email) return next({ status: 401, message: "Google email not verified" });
    let user = row("SELECT * FROM users WHERE google_id=?", p.sub)
      || row("SELECT * FROM users WHERE email=?", p.email);
    if (!user) {
      const r = db.prepare("INSERT INTO users (name,email,password_hash,avatar_url,google_id) VALUES (?,?,?,?,?)")
        .run(p.name || p.email.split("@")[0], p.email, bcrypt.hashSync(Math.random().toString(36), 8), p.picture || "", p.sub);
      user = row("SELECT * FROM users WHERE id=?", r.lastInsertRowid);
    } else if (!user.google_id) {
      db.prepare("UPDATE users SET google_id=? WHERE id=?").run(p.sub, user.id);
      if (!user.avatar_url && p.picture) db.prepare("UPDATE users SET avatar_url=? WHERE id=?").run(p.picture, user.id);
      user = row("SELECT * FROM users WHERE id=?", user.id);
    }
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) {
    console.error("Google auth failed:", e.message);
    next({ status: 401, message: "Google sign-in failed — try again" });
  }
});
function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, is_admin: !!rest.is_admin };
}

// ---------- listings ----------
app.get("/api/listings", (req, res) => {
  const q = req.query;
  const conds = ["1=1"];
  const p = [];
  if (q.country) { conds.push("country=?"); p.push(q.country); }
  if (q.city) { conds.push("city=?"); p.push(q.city); }
  if (q.category) { conds.push("category=?"); p.push(q.category); }
  if (q.brand) { conds.push("(brand LIKE ? OR model LIKE ? OR title LIKE ?)"); p.push(`%${q.brand}%`, `%${q.brand}%`, `%${q.brand}%`); }
  if (q.condition) { conds.push("condition=?"); p.push(q.condition); }
  if (q.minPrice) { conds.push("price>=?"); p.push(Number(q.minPrice)); }
  if (q.maxPrice) { conds.push("price<=?"); p.push(Number(q.maxPrice)); }
  if (q.allowOffers === "1") { conds.push("allow_offers=1"); }
  if (q.ships === "1") { conds.push("ships=1"); }
  if (q.pickup === "1") { conds.push("ships=0"); }
  if (q.search) { conds.push("(title LIKE ? OR description LIKE ? OR brand LIKE ? OR model LIKE ?)"); p.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  if (q.seller) { conds.push("seller_id=?"); p.push(Number(q.seller)); }
  if (!q.status) { conds.push("status='active'"); }
  else if (q.status !== "any") { conds.push("status=?"); p.push(q.status); }
  if (q.ids) {
    const ids = String(q.ids).split(",").map(Number).filter(Boolean);
    if (ids.length) { conds.push(`id IN (${ids.map(() => "?").join(",")})`); p.push(...ids); }
  }
  let order = "created_at DESC";
  if (q.sort === "price_asc") order = "price ASC";
  if (q.sort === "price_desc") order = "price DESC";
  const rows = all(`SELECT * FROM listings WHERE ${conds.join(" AND ")} ORDER BY ${order} LIMIT 200`, ...p);
  let out = rows.map(listingWithImages);
  // nearest sort (optional lat/lng query)
  if (q.sort === "nearest" && q.lat && q.lng) {
    const la = Number(q.lat), ln = Number(q.lng);
    const dist = (l) => (l.lat != null && l.lng != null)
      ? Math.hypot(l.lat - la, l.lng - ln) : 1e9;
    out = out.sort((a, b) => dist(a) - dist(b));
  }
  res.json(out);
});

app.get("/api/listings/:id", (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Listing not found" });
  try { db.prepare("UPDATE listings SET views=views+1 WHERE id=?").run(l.id); } catch {}
  res.json(listingWithImages(l));
});

app.post("/api/listings", auth(), (req, res, next) => {
  try {
    const b = req.body;
    if (!b.title || !b.price) return next({ status: 400, message: "title and price required" });
    const exp = new Date(Date.now() + EXPIRY_DAYS * 864e5).toISOString().slice(0, 19).replace("T", " ");
    const r = db.prepare(`INSERT INTO listings
      (seller_id,title,description,category,brand,model,condition,price,currency,allow_offers,min_offer,
       country,city,lat,lng,ships,pickup_location,status,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      req.user.id, b.title, b.description || "", b.category || "console", b.brand || "", b.model || "",
      b.condition || "Good", Number(b.price), b.currency || "USD", b.allow_offers === false ? 0 : 1,
      b.min_offer != null && b.min_offer !== "" ? Number(b.min_offer) : null,
      b.country || req.user.country || "", b.city || req.user.city || "",
      b.lat ?? null, b.lng ?? null, b.ships ? 1 : 0, b.pickup_location || "",
      b.status || "active", exp);
    const imgs = Array.isArray(b.images) ? b.images : [];
    imgs.forEach((url, i) => db.prepare("INSERT INTO listing_images (listing_id,url,sort_order) VALUES (?,?,?)").run(r.lastInsertRowid, url, i));
    res.json(listingWithImages(row("SELECT * FROM listings WHERE id=?", r.lastInsertRowid)));
  } catch (e) { next(e); }
});

app.put("/api/listings/:id", auth(), (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Not found" });
  if (l.seller_id !== req.user.id && !req.user.is_admin) return next({ status: 403, message: "Not yours" });
  const b = req.body;
  const fields = ["title", "description", "category", "brand", "model", "condition", "price", "currency",
    "country", "city", "lat", "lng", "pickup_location", "status"];
  const sets = [], vals = [];
  for (const f of fields) if (b[f] !== undefined) { sets.push(`${f}=?`); vals.push(b[f]); }
  if (b.allow_offers !== undefined) { sets.push("allow_offers=?"); vals.push(b.allow_offers ? 1 : 0); }
  if (b.min_offer !== undefined) { sets.push("min_offer=?"); vals.push(b.min_offer === "" || b.min_offer == null ? null : Number(b.min_offer)); }
  if (b.ships !== undefined) { sets.push("ships=?"); vals.push(b.ships ? 1 : 0); }
  if (sets.length) db.prepare(`UPDATE listings SET ${sets.join(",")} WHERE id=?`).run(...vals, l.id);
  if (Array.isArray(b.images)) {
    db.prepare("DELETE FROM listing_images WHERE listing_id=?").run(l.id);
    b.images.forEach((url, i) => db.prepare("INSERT INTO listing_images (listing_id,url,sort_order) VALUES (?,?,?)").run(l.id, url, i));
  }
  res.json(listingWithImages(row("SELECT * FROM listings WHERE id=?", l.id)));
});

app.delete("/api/listings/:id", auth(), (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Not found" });
  if (l.seller_id !== req.user.id && !req.user.is_admin) return next({ status: 403, message: "Not yours" });
  db.prepare("DELETE FROM listings WHERE id=?").run(l.id);
  res.json({ ok: true });
});

app.post("/api/listings/:id/relist", auth(), (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Not found" });
  if (l.seller_id !== req.user.id) return next({ status: 403, message: "Not yours" });
  const exp = new Date(Date.now() + EXPIRY_DAYS * 864e5).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("UPDATE listings SET status='active', expires_at=? WHERE id=?").run(exp, l.id);
  res.json(listingWithImages(row("SELECT * FROM listings WHERE id=?", l.id)));
});
app.post("/api/listings/:id/renew", auth(), (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Not found" });
  if (l.seller_id !== req.user.id) return next({ status: 403, message: "Not yours" });
  const exp = new Date(Date.now() + EXPIRY_DAYS * 864e5).toISOString().slice(0, 19).replace("T", " ");
  db.prepare("UPDATE listings SET expires_at=? WHERE id=?").run(exp, l.id);
  notify(l.seller_id, "listing", "Listing renewed", l.title, `#/listing/${l.id}`);
  res.json(listingWithImages(row("SELECT * FROM listings WHERE id=?", l.id)));
});
app.post("/api/listings/:id/sold", auth(), (req, res, next) => {
  const l = row("SELECT * FROM listings WHERE id=?", req.params.id);
  if (!l) return next({ status: 404, message: "Not found" });
  if (l.seller_id !== req.user.id) return next({ status: 403, message: "Not yours" });
  db.prepare("UPDATE listings SET status='sold' WHERE id=?").run(l.id);
  res.json(listingWithImages(row("SELECT * FROM listings WHERE id=?", l.id)));
});

app.post("/api/upload", auth(), upload.array("photos", 8), (req, res) => {
  res.json({ urls: req.files.map((f) => `/uploads/${f.filename}`) });
});

// ---------- offers (negotiation core) ----------
// Public anonymized offer ladder for the StockX-style panel on the listing page.
app.get("/api/listings/:id/offers", (req, res) => {
  const rows = all(
    "SELECT amount, status, created_at FROM offers WHERE listing_id=? ORDER BY id ASC LIMIT 20",
    req.params.id
  );
  res.json(rows);
});
app.get("/api/offers", auth(), (req, res) => {
  const { listingId, role } = req.query;
  let sql = "SELECT * FROM offers WHERE 1=1", p = [];
  if (listingId) { sql += " AND listing_id=?"; p.push(listingId); }
  if (role === "received") { sql += " AND seller_id=?"; p.push(req.user.id); }
  else if (role === "sent") { sql += " AND buyer_id=?"; p.push(req.user.id); }
  else { sql += " AND (buyer_id=? OR seller_id=?)"; p.push(req.user.id, req.user.id); }
  sql += " ORDER BY created_at DESC";
  res.json(all(sql, ...p));
});

app.post("/api/listings/:id/offers", auth(), (req, res, next) => {
  try {
    const listing = row("SELECT * FROM listings WHERE id=?", req.params.id);
    const v = validateNewOffer({ listing, buyerId: req.user.id, amount: Number(req.body.amount) });
    if (!v.ok) return next({ status: 400, message: v.error });
    const amount = Number(req.body.amount);
    if (checkAutoDecline(listing, amount).autoReject) {
      const r = db.prepare(`INSERT INTO offers (listing_id,buyer_id,seller_id,amount,status,message,last_actor_id)
        VALUES (?,?,?,?,?,?,?)`).run(listing.id, req.user.id, listing.seller_id, amount, "rejected", req.body.message || "", req.user.id);
      const off = row("SELECT * FROM offers WHERE id=?", r.lastInsertRowid);
      notify(req.user.id, "offer", "Offer auto-declined", `Below seller minimum on "${listing.title}"`, `#/listing/${listing.id}`);
      return res.json({ ...off, autoDeclined: true });
    }
    const r = db.prepare(`INSERT INTO offers (listing_id,buyer_id,seller_id,amount,status,message,last_actor_id)
      VALUES (?,?,?,?,?,?,?)`).run(listing.id, req.user.id, listing.seller_id, amount, "pending", req.body.message || "", req.user.id);
    const offer = row("SELECT * FROM offers WHERE id=?", r.lastInsertRowid);
    const conv = getOrCreateConversation(listing.id, req.user.id, listing.seller_id);
    db.prepare("INSERT INTO messages (conversation_id,sender_id,type,content,offer_id) VALUES (?,?,?,?,?)")
      .run(conv.id, req.user.id, "offer_card", req.body.message || "", offer.id);
    notify(listing.seller_id, "offer", "New offer received", `${req.user.name} offered ${amount} on "${listing.title}"`, `#/messages/${conv.id}`);
    res.json(offer);
  } catch (e) { next(e); }
});

function actOnOffer(req, res, next, action) {
  try {
    const offer = row("SELECT * FROM offers WHERE id=?", req.params.id);
    if (!offer) return next({ status: 404, message: "Offer not found" });
    const listing = row("SELECT * FROM listings WHERE id=?", offer.listing_id);
    const chk = canAct(offer, req.user.id, action);
    if (!chk.ok) return next({ status: 400, message: chk.error });

    const conv = getOrCreateConversation(offer.listing_id, offer.buyer_id, offer.seller_id);
    const other = req.user.id === offer.buyer_id ? offer.seller_id : offer.buyer_id;

    if (action === "accept") {
      db.prepare("UPDATE offers SET status='accepted' WHERE id=?").run(offer.id);
      db.prepare("UPDATE offers SET status='rejected' WHERE listing_id=? AND id<>? AND (status='pending' OR status='countered')").run(offer.listing_id, offer.id);
      db.prepare("UPDATE listings SET status='reserved' WHERE id=?").run(offer.listing_id);
      db.prepare("UPDATE conversations SET agreed_price=? WHERE id=?").run(offer.amount, conv.id);
      db.prepare("INSERT INTO messages (conversation_id,sender_id,type,content,offer_id) VALUES (?,?,?,?,?)")
        .run(conv.id, req.user.id, "offer_card", `Accepted at ${offer.amount}`, offer.id);
      notify(other, "offer", "Offer accepted!", `Agreed price ${offer.amount} on "${listing.title}"`, `#/messages/${conv.id}`);
      return res.json({ ...row("SELECT * FROM offers WHERE id=?", offer.id), conversationId: conv.id });
    }
    if (action === "reject") {
      db.prepare("UPDATE offers SET status='rejected' WHERE id=?").run(offer.id);
      db.prepare("INSERT INTO messages (conversation_id,sender_id,type,content,offer_id) VALUES (?,?,?,?,?)")
        .run(conv.id, req.user.id, "offer_card", "Rejected", offer.id);
      notify(other, "offer", "Offer rejected", `On "${listing.title}"`, `#/messages/${conv.id}`);
      return res.json(row("SELECT * FROM offers WHERE id=?", offer.id));
    }
    // counter
    const amount = Number(req.body.amount);
    const built = makeCounter({ parentOffer: offer, actorId: req.user.id, amount, message: req.body.message || "" });
    if (!built.ok) return next({ status: 400, message: built.error });
    db.prepare("UPDATE offers SET status='rejected' WHERE id=?").run(offer.id); // parent superseded (kept in chain via parent_offer_id)
    const r = db.prepare(`INSERT INTO offers (listing_id,buyer_id,seller_id,amount,status,parent_offer_id,message,last_actor_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(built.row.listing_id, built.row.buyer_id, built.row.seller_id,
      built.row.amount, "countered", built.row.parent_offer_id, built.row.message, built.row.last_actor_id);
    const fresh = row("SELECT * FROM offers WHERE id=?", r.lastInsertRowid);
    db.prepare("INSERT INTO messages (conversation_id,sender_id,type,content,offer_id) VALUES (?,?,?,?,?)")
      .run(conv.id, req.user.id, "offer_card", req.body.message || "", fresh.id);
    notify(other, "offer", "Counter-offer received", `${amount} on "${listing.title}"`, `#/messages/${conv.id}`);
    res.json(fresh);
  } catch (e) { next(e); }
}
app.post("/api/offers/:id/accept", auth(), (req, res, next) => actOnOffer(req, res, next, "accept"));
app.post("/api/offers/:id/reject", auth(), (req, res, next) => actOnOffer(req, res, next, "reject"));
app.post("/api/offers/:id/counter", auth(), (req, res, next) => actOnOffer(req, res, next, "counter"));

// ---------- conversations & messages ----------
app.get("/api/conversations", auth(), (req, res) => {
  const convs = all("SELECT * FROM conversations WHERE buyer_id=? OR seller_id=? ORDER BY created_at DESC", req.user.id, req.user.id);
  res.json(convs.map((c) => {
    const last = row("SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC", c.id);
    const listing = row("SELECT id,title,price,currency,status FROM listings WHERE id=?", c.listing_id);
    const unread = db.prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id=? AND sender_id<>?").get(c.id, req.user.id);
    const otherId = req.user.id === c.buyer_id ? c.seller_id : c.buyer_id;
    return { ...c, last_message: last, listing, other: row("SELECT id,name,avatar_url FROM users WHERE id=?", otherId), unread: 0 };
  }));
});
app.get("/api/conversations/:id", auth(), (req, res, next) => {
  const c = row("SELECT * FROM conversations WHERE id=?", req.params.id);
  if (!c) return next({ status: 404, message: "Not found" });
  if (c.buyer_id !== req.user.id && c.seller_id !== req.user.id) return next({ status: 403, message: "Not a participant" });
  const msgs = all(`SELECT m.*, u.name sender_name FROM messages m LEFT JOIN users u ON u.id=m.sender_id
    WHERE conversation_id=? ORDER BY id ASC`, c.id);
  const offers = all("SELECT * FROM offers WHERE listing_id=? AND ((buyer_id=? AND seller_id=?) OR (buyer_id=? AND seller_id=?)) ORDER BY id ASC",
    c.listing_id, c.buyer_id, c.seller_id, c.buyer_id, c.seller_id);
  res.json({ ...c, messages: msgs, offers, listing: listingWithImages(row("SELECT * FROM listings WHERE id=?", c.listing_id)) });
});
app.post("/api/conversations", auth(), (req, res, next) => {
  const listing = row("SELECT * FROM listings WHERE id=?", req.body.listing_id);
  if (!listing) return next({ status: 404, message: "Listing not found" });
  if (listing.seller_id === req.user.id) return next({ status: 400, message: "Cannot message yourself" });
  res.json(getOrCreateConversation(listing.id, req.user.id, listing.seller_id));
});
app.post("/api/conversations/:id/messages", auth(), (req, res, next) => {
  const c = row("SELECT * FROM conversations WHERE id=?", req.params.id);
  if (!c) return next({ status: 404, message: "Not found" });
  if (c.buyer_id !== req.user.id && c.seller_id !== req.user.id) return next({ status: 403, message: "Not a participant" });
  const { content = "" } = req.body;
  if (!content.trim()) return next({ status: 400, message: "Empty message" });
  const r = db.prepare("INSERT INTO messages (conversation_id,sender_id,type,content) VALUES (?,?,?,?)")
    .run(c.id, req.user.id, "text", content);
  const other = req.user.id === c.buyer_id ? c.seller_id : c.buyer_id;
  notify(other, "message", "New message", content.slice(0, 80), `#/messages/${c.id}`);
  res.json(row("SELECT * FROM messages WHERE id=?", r.lastInsertRowid));
});
app.post("/api/conversations/:id/complete", auth(), (req, res, next) => {
  const c = row("SELECT * FROM conversations WHERE id=?", req.params.id);
  if (!c) return next({ status: 404, message: "Not found" });
  if (c.buyer_id === req.user.id) db.prepare("UPDATE conversations SET completed_by_buyer=1 WHERE id=?").run(c.id);
  else if (c.seller_id === req.user.id) db.prepare("UPDATE conversations SET completed_by_seller=1 WHERE id=?").run(c.id);
  else return next({ status: 403, message: "Not a participant" });
  const upd = row("SELECT * FROM conversations WHERE id=?", c.id);
  if (upd.completed_by_buyer && upd.completed_by_seller)
    db.prepare("UPDATE listings SET status='sold' WHERE id=?").run(c.listing_id);
  res.json(upd);
});

// ---------- favorites / watchlist ----------
app.get("/api/favorites", auth(), (req, res) => {
  const favs = all("SELECT listing_id FROM favorites WHERE user_id=?", req.user.id);
  res.json(favs.map((f) => f.listing_id));
});
app.post("/api/favorites/:listingId", auth(), (req, res) => {
  try {
    db.prepare("INSERT INTO favorites (user_id,listing_id) VALUES (?,?)").run(req.user.id, req.params.listingId);
  } catch {}
  res.json({ ok: true });
});
app.delete("/api/favorites/:listingId", auth(), (req, res) => {
  db.prepare("DELETE FROM favorites WHERE user_id=? AND listing_id=?").run(req.user.id, req.params.listingId);
  res.json({ ok: true });
});

// ---------- reviews ----------
app.get("/api/users/:id/reviews", (req, res) => {
  res.json(all("SELECT r.*, u.name reviewer_name FROM reviews r LEFT JOIN users u ON u.id=r.reviewer_id WHERE reviewee_id=? ORDER BY created_at DESC", req.params.id));
});
app.post("/api/reviews", auth(), (req, res, next) => {
  const { listing_id, reviewee_id, rating, comment = "" } = req.body;
  if (!rating || rating < 1 || rating > 5) return next({ status: 400, message: "rating 1-5 required" });
  const r = db.prepare("INSERT INTO reviews (listing_id,reviewer_id,reviewee_id,rating,comment) VALUES (?,?,?,?,?)")
    .run(listing_id, req.user.id, reviewee_id, rating, comment);
  const agg = row("SELECT AVG(rating) a, COUNT(*) c FROM reviews WHERE reviewee_id=?", reviewee_id);
  db.prepare("UPDATE users SET rating_avg=?, rating_count=? WHERE id=?").run(agg.a || 0, agg.c, reviewee_id);
  res.json(row("SELECT * FROM reviews WHERE id=?", r.lastInsertRowid));
});
app.get("/api/users/:id", (req, res, next) => {
  const u = row("SELECT * FROM users WHERE id=?", req.params.id);
  if (!u) return next({ status: 404, message: "User not found" });
  const active = all("SELECT * FROM listings WHERE seller_id=? AND status='active' ORDER BY created_at DESC LIMIT 20", u.id).map(listingWithImages);
  res.json({ user: publicUser(u), active_listings: active });
});
app.put("/api/users/me", auth(), (req, res) => {
  const b = req.body;
  db.prepare("UPDATE users SET name=COALESCE(?,name), country=COALESCE(?,country), city=COALESCE(?,city), bio=COALESCE(?,bio), avatar_url=COALESCE(?,avatar_url) WHERE id=?")
    .run(b.name ?? null, b.country ?? null, b.city ?? null, b.bio ?? null, b.avatar_url ?? null, req.user.id);
  res.json({ user: publicUser(row("SELECT * FROM users WHERE id=?", req.user.id)) });
});

// ---------- notifications ----------
app.get("/api/notifications", auth(), (req, res) => {
  res.json(all("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", req.user.id));
});
app.post("/api/notifications/read", auth(), (_req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(_req.user.id);
  res.json({ ok: true });
});

// ---------- reports + admin ----------
app.post("/api/reports", auth(false), (req, res) => {
  const { target_type, target_id, reason = "" } = req.body;
  db.prepare("INSERT INTO reports (reporter_id,target_type,target_id,reason) VALUES (?,?,?,?)")
    .run(req.user?.id ?? null, target_type, target_id, reason);
  res.json({ ok: true });
});
app.get("/api/admin/reports", auth(), (req, res, next) => {
  if (!req.user.is_admin) return next({ status: 403, message: "Admin only" });
  res.json(all("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100"));
});
app.post("/api/admin/reports/:id/resolve", auth(), (req, res, next) => {
  if (!req.user.is_admin) return next({ status: 403, message: "Admin only" });
  const { action } = req.body; // 'dismiss' | 'remove'
  const rep = row("SELECT * FROM reports WHERE id=?", req.params.id);
  if (!rep) return next({ status: 404, message: "Not found" });
  if (action === "remove" && rep.target_type === "listing") db.prepare("DELETE FROM listings WHERE id=?").run(rep.target_id);
  if (action === "remove" && rep.target_type === "user") db.prepare("DELETE FROM users WHERE id=?").run(rep.target_id);
  db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(rep.id);
  res.json({ ok: true });
});
app.get("/api/admin/stats", auth(), (req, res, next) => {
  if (!req.user.is_admin) return next({ status: 403, message: "Admin only" });
  res.json({
    users: row("SELECT COUNT(*) c FROM users").c,
    listings: row("SELECT COUNT(*) c FROM listings").c,
    offers: row("SELECT COUNT(*) c FROM offers").c,
    open_reports: row("SELECT COUNT(*) c FROM reports WHERE status='open'").c,
  });
});

// ---------- autosuggest ----------
app.get("/api/suggest", (req, res) => {
  const q = `%${req.query.q || ""}%`;
  const rows = all("SELECT DISTINCT brand, model FROM listings WHERE brand LIKE ? OR model LIKE ? OR title LIKE ? LIMIT 8", q, q, q);
  res.json(rows);
});

// ---------- fallback + errors ----------
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));
app.use((err, _req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RetroTrade on http://localhost:${PORT}`));
