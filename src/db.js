import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "retrotrade.db");

fs.mkdirSync(path.join(__dirname, "..", "uploads"), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'console',
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    condition TEXT DEFAULT 'Good',
    price REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    allow_offers INTEGER DEFAULT 1,
    min_offer REAL,
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    lat REAL, lng REAL,
    ships INTEGER DEFAULT 0,
    pickup_location TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    views INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS listing_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    parent_offer_id INTEGER REFERENCES offers(id),
    message TEXT DEFAULT '',
    last_actor_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    agreed_price REAL,
    completed_by_buyer INTEGER DEFAULT 0,
    completed_by_seller INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(listing_id, buyer_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL,
    type TEXT DEFAULT 'text',
    content TEXT DEFAULT '',
    offer_id INTEGER REFERENCES offers(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    reviewee_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now'))
  );
  `);
}

export function notify(userId, kind, title, body = "", link = "") {
  db.prepare("INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?,?,?,?,?)")
    .run(userId, kind, title, body, link);
}
