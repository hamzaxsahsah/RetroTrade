import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewOffer, checkAutoDecline, canAct, transition, makeCounter, awaitingParty,
} from "../src/offerEngine.js";

const listing = { seller_id: 1, status: "active", allow_offers: 1, min_offer: 100 };

test("validateNewOffer blocks self-offers, closed listings, bad amounts", () => {
  assert.equal(validateNewOffer({ listing, buyerId: 1, amount: 120 }).ok, false);
  assert.equal(validateNewOffer({ listing: { ...listing, status: "sold" }, buyerId: 2, amount: 120 }).ok, false);
  assert.equal(validateNewOffer({ listing: { ...listing, allow_offers: 0 }, buyerId: 2, amount: 120 }).ok, false);
  assert.equal(validateNewOffer({ listing, buyerId: 2, amount: -5 }).ok, false);
  assert.equal(validateNewOffer({ listing, buyerId: 2, amount: 120 }).ok, true);
});

test("auto-decline below hidden minimum", () => {
  assert.equal(checkAutoDecline(listing, 50).autoReject, true);
  assert.equal(checkAutoDecline(listing, 150).autoReject, false);
  assert.equal(checkAutoDecline({ ...listing, min_offer: null }, 1).autoReject, false);
});

test("full negotiation chain: offer -> counter -> accept", () => {
  const o1 = { id: 1, listing_id: 9, buyer_id: 2, seller_id: 1, amount: 120, status: "pending", last_actor_id: 2 };
  assert.equal(awaitingParty(o1), "seller");
  assert.equal(canAct(o1, 2, "accept").ok, false); // buyer can't act on own offer
  assert.equal(canAct(o1, 1, "accept").ok, true);

  const c = makeCounter({ parentOffer: o1, actorId: 1, amount: 140 });
  assert.equal(c.ok, true);
  const o2 = { id: 2, ...c.row };
  assert.equal(awaitingParty(o2), "buyer");
  assert.equal(canAct(o2, 1, "accept").ok, false);
  assert.equal(canAct(o2, 2, "accept").ok, true);
  assert.equal(transition(o2, "accept").status, "accepted");
});

test("closed offers cannot be acted on", () => {
  const done = { id: 3, buyer_id: 2, seller_id: 1, status: "accepted", last_actor_id: 2 };
  assert.equal(canAct(done, 1, "counter").ok, false);
});
