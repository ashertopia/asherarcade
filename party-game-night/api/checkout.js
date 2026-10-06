// POST /api/checkout {packId}  ->  {url}
//
// ============================================================================
//  STRIPE CHECKOUT GOES HERE
// ============================================================================
// This is the one place money comes in. It is wired for Stripe Checkout but
// stays switched off (501, and the Buy button is hidden) until both env vars
// are set in Vercel:
//
//   STRIPE_SECRET_KEY  sk_live_... (or sk_test_... while testing)
//   STRIPE_PRICES      JSON mapping what can be bought to a Stripe Price id:
//                      {"christmas-movies":"price_123","christmas":"price_456","all":"price_789"}
//                      Keys are a pack id, a collection name, or "all";
//                      the key is the scope the code it mints will unlock.
//   UNLOCK_SECRET      the same secret scripts/make-code.js signs with
//
// Flow: the host taps Buy -> this creates a Checkout Session -> Stripe sends
// them back to /host?claim={CHECKOUT_SESSION_ID} -> api/claim.js confirms
// payment with Stripe and returns an unlock code, which the host page saves
// and shows (so they can unlock on another device too).
//
// Before going live: create the Products/Prices in Stripe, test with test
// keys, and add the products to policies.html. No webhook is needed for this
// flow, because claim.js asks Stripe directly whether the session was paid.
// ============================================================================

const { json, readJson, origin } = require('../lib/http');
const { getPack } = require('../lib/packs');

function prices() {
  try {
    return JSON.parse(process.env.STRIPE_PRICES || '{}');
  } catch (e) {
    return {};
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !process.env.STRIPE_PRICES) return json(res, 501, { error: 'Checkout is not set up yet.' });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return json(res, 400, { error: 'Bad JSON' });
  }
  // Buy the pack itself if it has a price, else its whole collection.
  const pack = getPack(String(body.packId || ''));
  const table = prices();
  const scope = body.scope && table[body.scope] ? body.scope
    : pack && table[pack.id] ? pack.id
    : pack && table[String(pack.collection).toLowerCase()] ? String(pack.collection).toLowerCase()
    : null;
  if (!scope) return json(res, 400, { error: 'That pack is not for sale yet.' });

  const base = origin(req);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price]', table[scope]);
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[unlock_scope]', scope);
  form.set('allow_promotion_codes', 'true');
  form.set('success_url', base + '/host?claim={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', base + '/host');

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const session = await r.json();
  if (!r.ok) return json(res, 502, { error: (session.error && session.error.message) || 'Stripe error' });
  json(res, 200, { url: session.url });
};
