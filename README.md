# RetroTrade — Peer-to-Peer Retro Console Marketplace

List retro consoles, haggle with offers/counter-offers in-chat, meet up & play.

## Run

```bash
npm install
node src/seed.js   # demo data (16 listings, 5 users)
npm start          # http://localhost:3000
npm test           # offer-engine unit tests
```

Demo logins: `admin@retrotrade.gg / admin123` (admin), `marta@retro.gg / password123` (seller).

## How it works

- **Offer engine** (`src/offerEngine.js`): `pending → accepted | rejected`, counters create a chained row (`parent_offer_id`). Only the awaiting party can act; hidden `min_offer` auto-declines lowballs. Fully unit-tested.
- **API** (`src/server.js`): auth (JWT), listing CRUD + photo upload + auto-expire/renew/relist, offers, conversations/messages (poll every 4s), favorites, reviews, notifications, reports + admin moderation, country→city geo + autosuggest.
- **Frontend** (`public/`): SPA with signature **horizontal-scroll rails** (category chips, themed rails, arrows, scroll-snap), browse with dependent country→city filters + Leaflet map toggle, listing detail with sticky offer bar, multi-step sell form with drag-drop upload, dashboard offers inbox, negotiation thread with inline offer cards, profiles, watchlist, admin view. Dark charcoal + amber/teal retro theme, light/dark toggle.
- **Location-based pricing**: every country has a home currency (FR→EUR, UK→GBP, MA→MAD, JP→JPY…); a static indicative FX table converts any listing price into the viewer's currency (override > profile country > browser locale). Cards, rows, map pins and the bid panel show the converted price with the seller's original as reference; the sell form auto-sets currency from the chosen country. Picker lives in browse topbar + settings.

- **DB**: SQLite via `node:sqlite` (zero setup). Swap `src/db.js` for Postgres in production.

## End-to-end loop (verified)

List item → buyer offers → seller counters → buyer accepts → listing `reserved` → chat → both "mark completed" → `sold` + review.
