import bcrypt from "bcryptjs";
import { db, initDb } from "./db.js";

initDb();
const has = db.prepare("SELECT COUNT(*) c FROM users").get().c;
if (has > 0) { console.log("DB already seeded, skipping"); process.exit(0); }

const hash = bcrypt.hashSync("password123", 10);
const adminHash = bcrypt.hashSync("admin123", 10);
const users = [
  ["Marta Pixel", "marta@retro.gg", hash, "Spain", "Madrid", "CRT enjoyer, ships fast 📦"],
  ["Karim Joystick", "karim@retro.gg", hash, "Morocco", "Casablanca", "Sega kid forever"],
  ["Léa 16-bit", "lea@retro.gg", hash, "France", "Paris", "Nintendo collector"],
  ["Tom Cartridge", "tom@retro.gg", hash, "United Kingdom", "London", "PS1 doctor 🔧"],
  ["Admin", "admin@retrotrade.gg", adminHash, "France", "Paris", "Moderator"],
];
const ids = users.map((u) => db.prepare("INSERT INTO users (name,email,password_hash,country,city,bio,is_admin) VALUES (?,?,?,?,?,?,?)")
  .run(u[0], u[1], u[2], u[3], u[4], u[5], u[1].startsWith("admin") ? 1 : 0).lastInsertRowid);

const L = [
  ["SNES PAL + 2 pads, boxed", "Super clean Super Nintendo, recapped, with Super Mario World.", "console", "Nintendo", "SNES", "Mint", 189, "EUR", 1, 150, "France", "Paris", 48.85, 2.35, 1, 1],
  ["Sega Mega Drive II + Sonic", "Genesis model 2, RGB cable, one 6-button pad.", "console", "Sega", "Genesis", "Good", 129, "EUR", 1, 100, "France", "Lyon", 45.76, 4.83, 0, 0],
  ["PlayStation 1 modded + 10 games", "PS1 SCPH-5502, XStation ODE, silent fan mod.", "console", "Sony", "PS1", "Good", 159, "EUR", 1, 120, "Spain", "Madrid", 40.41, -3.7, 1, 2],
  ["Game Boy DMG backlit", "Original DMG with IPS backlight mod, new shell.", "console", "Nintendo", "Game Boy", "Mint", 139, "EUR", 1, null, "Spain", "Barcelona", 41.38, 2.17, 1, 0],
  ["Nintendo 64 + EverDrive", "Atomic Berry N64, expansion pak, EverDrive X5.", "bundle", "Nintendo", "N64", "Good", 249, "USD", 1, 200, "USA", "New York", 40.71, -74.0, 1, 0],
  ["Dreamcast VA1 + GD-EMU", "Dreamcast with GD-EMU, new PSU, 2 VMUs.", "console", "Sega", "Dreamcast", "Good", 229, "GBP", 1, 180, "United Kingdom", "London", 51.5, -0.12, 1, 1],
  ["NES front-loader, refurbished", "72-pin replaced, blinking-light-win installed.", "console", "Nintendo", "NES", "Fair", 119, "USD", 1, 80, "USA", "Austin", 30.26, -97.74, 0, 3],
  ["PS2 fat + network adapter", "PS2 SCPH-39004, HDD loaded, FreeHDBoot.", "console", "Sony", "PS2", "Good", 99, "EUR", 0, null, "Germany", "Berlin", 52.52, 13.4, 1, 0],
  ["Atari 2600 Woody + 8 carts", "Six-switch woody, joysticks, Combat, Pitfall…", "bundle", "Atari", "2600", "Fair", 149, "EUR", 1, 110, "Italy", "Milan", 45.46, 9.19, 0, 0],
  ["SNES controller — 2× OEM", "Two original pads, tight D-pads.", "controller", "Nintendo", "SNES", "Good", 45, "EUR", 1, null, "France", "Marseille", 43.29, 5.36, 1, 0],
  ["Mega Drive 6-button pad (new)", "Retro-Bit reproduction, sealed.", "controller", "Sega", "Genesis", "Mint", 29, "MAD", 1, null, "Morocco", "Casablanca", 33.57, -7.58, 0, 0],
  ["Chrono Trigger SNES (repro cart)", "English repro, plays on PAL with adapter.", "game", "Nintendo", "SNES", "Good", 35, "EUR", 1, null, "France", "Bordeaux", 44.83, -0.57, 1, 0],
  ["Game Boy Camera + Printer", "Working camera + printer, fresh paper roll.", "accessory", "Nintendo", "Game Boy", "Fair", 89, "JPY", 1, 60, "Japan", "Tokyo", 35.68, 139.69, 1, 0],
  ["PS1 DualShock OEM gray", "No stick drift, rumble works.", "controller", "Sony", "PS1", "Good", 25, "EUR", 0, null, "Morocco", "Rabat", 34.02, -6.84, 0, 0],
  ["N64 CIB: Ocarina of Time", "Boxed, manual, poster — collector grade.", "game", "Nintendo", "N64", "Mint", 79, "USD", 1, 60, "Canada", "Toronto", 43.65, -79.38, 1, 0],
  ["Sega Saturn JP + Action Replay", "Gray JP Saturn, FRAM mod, 4MB cart.", "console", "Sega", "Saturn", "Good", 199, "EUR", 1, 150, "France", "Nantes", 47.21, -1.55, 0, 0],
];
const exp = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 19).replace("T", " ");
L.forEach((l, i) => {
  const r = db.prepare(`INSERT INTO listings (seller_id,title,description,category,brand,model,condition,price,currency,allow_offers,min_offer,country,city,lat,lng,ships,status,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ids[i % 4], l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], l[9], l[10], l[11], l[12], l[13], l[14], "active", exp);
  [0, 1].forEach((k) => db.prepare("INSERT INTO listing_images (listing_id,url,sort_order) VALUES (?,?,?)")
    .run(r.lastInsertRowid, `https://picsum.photos/seed/rt${r.lastInsertRowid}${k}/640/420`, k));
});
console.log(`Seeded ${ids.length} users, ${L.length} listings`);
