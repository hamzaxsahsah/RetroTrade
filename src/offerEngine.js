// Offer state machine — isolated, testable negotiation engine.
// States: pending -> accepted | rejected | countered
//          countered -> accepted | rejected | countered (new row with parent_offer_id)
// Rules:
// - Only the seller of the listing can accept/reject/counter a pending/countered offer.
// - Only the buyer who made the root offer (or the countering party's counterpart) can accept/reject/counter a counter.
//   Simplified: participants = buyer + seller; the actor must be the party the offer is "awaiting".
// - amount must be > 0.
// - auto-decline: if listing.min_offer set and amount < min_offer -> auto-reject (handled by caller via checkAutoDecline).
// - Accepting an offer reserves the listing and rejects all other open offers on that listing.

export const OFFER_STATUS = ["pending", "countered", "accepted", "rejected"];
export const LISTING_STATUS = ["active", "reserved", "sold", "expired", "draft"];

/** Who should act next on an offer? The counterpart of whoever made the last move. */
export function awaitingParty(offer) {
  // offer: { buyer_id, seller_id, last_actor_id, status }
  if (offer.status !== "pending" && offer.status !== "countered") return null;
  if (!offer.last_actor_id) return "seller"; // fresh buyer offer awaits seller
  return offer.last_actor_id === offer.buyer_id ? "seller" : "buyer";
}

export function validateNewOffer({ listing, buyerId, amount }) {
  if (!listing) return { ok: false, error: "Listing not found" };
  if (listing.status !== "active") return { ok: false, error: `Listing is ${listing.status}, not open for offers` };
  if (listing.seller_id === buyerId) return { ok: false, error: "Cannot offer on your own listing" };
  if (!listing.allow_offers) return { ok: false, error: "Seller does not accept offers on this listing" };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Offer amount must be a positive number" };
  return { ok: true };
}

/** Hidden-minimum auto-decline check. Returns { autoReject: bool }. */
export function checkAutoDecline(listing, amount) {
  if (listing.min_offer != null && Number(amount) < Number(listing.min_offer)) return { autoReject: true };
  return { autoReject: false };
}

export function canAct(offer, actorId, action) {
  if (!["accept", "reject", "counter"].includes(action)) return { ok: false, error: "Unknown action" };
  if (offer.status !== "pending" && offer.status !== "countered")
    return { ok: false, error: `Offer is already ${offer.status}` };
  const awaiting = awaitingParty(offer);
  const actorRole = actorId === offer.buyer_id ? "buyer" : actorId === offer.seller_id ? "seller" : null;
  if (!actorRole) return { ok: false, error: "Only buyer or seller can act on this offer" };
  if (actorRole !== awaiting) return { ok: false, error: `Waiting on the ${awaiting}, not the ${actorRole}` };
  return { ok: true, actorRole };
}

/** Apply accept/reject locally (DB layer persists + handles side effects). */
export function transition(offer, action) {
  if (action === "accept") return { ...offer, status: "accepted" };
  if (action === "reject") return { ...offer, status: "rejected" };
  throw new Error("Use makeCounter for counter-offers (creates a new row)");
}

/** Build a counter-offer row chained to its parent. */
export function makeCounter({ parentOffer, actorId, amount, message = "" }) {
  const chk = canAct(parentOffer, actorId, "counter");
  if (!chk.ok) return chk;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Counter amount must be a positive number" };
  return {
    ok: true,
    row: {
      listing_id: parentOffer.listing_id,
      buyer_id: parentOffer.buyer_id,
      seller_id: parentOffer.seller_id,
      amount,
      message,
      status: "countered",
      parent_offer_id: parentOffer.id,
      last_actor_id: actorId,
    },
  };
}
