// POST /api/checkout {product?, packId?, from?}  ->  {url}
//
// ============================================================================
//  STRIPE CHECKOUT GOES HERE
// ============================================================================
// This is the one place money comes in. It is wired for Stripe Checkout but
// stays switched off (501, and the Buy buttons say "opens soon") until these
// env vars are set in Vercel:
//
//   STRIPE_SECRET_KEY  sk_live_... (or sk_test_... while testing)
//   STRIPE_PRICES      JSON mapping each product to its Stripe Price id:
//                        {"christmas":"price_...",   Christmas Collection  $24.99 (the default)
//                         "group":"price_...",       Group License         $34.99
//                         "pack":"price_..."}        Single pack           $9.99 (any one pack)
//                      A pack id key (e.g. "nativity") overrides "pack" for
//                      that pack, if a pack ever needs its own Price.
//   UNLOCK_SECRET      the same secret scripts/make-code.js signs with
//
// Products and display prices live in lib/products.js; keep them matching the
// Stripe Prices.
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
const { resolvePurchase } = require('../lib/products');

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
  if (!key || !process.env.STRIPE_PRICES) return json(res, 501, { error: 'Checkout is not open yet.' });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return json(res, 400, { error: 'Bad JSON' });
  }
  const buy = resolvePurchase(body, prices(), getPack);
  if (buy.error) return json(res, 400, { error: buy.error });

  const base = origin(req);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price]', buy.priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[unlock_scope]', buy.scope);
  form.set('metadata[product]', buy.product);
  form.set('allow_promotion_codes', 'true');
  form.set('success_url', base + '/host?claim={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', base + (body.from === 'landing' ? '/#pricing' : '/host'));

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const session = await r.json();
  if (!r.ok) return json(res, 502, { error: (session.error && session.error.message) || 'Stripe error' });
  json(res, 200, { url: session.url });
};
