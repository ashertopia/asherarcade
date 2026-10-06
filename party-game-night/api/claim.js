// GET /api/claim?session_id=cs_...  ->  {code, unlocks}
// Stripe sends the buyer back here (via /host?claim=...). We ask Stripe
// whether that Checkout Session was paid and, if so, mint the unlock code.
// The nonce comes from the session id, so reloading the page gives the same
// code instead of a new one. See api/checkout.js for setup.

const crypto = require('crypto');
const { json, query } = require('../lib/http');
const { mint, scopeCovers } = require('../lib/codes');
const { loadAll } = require('../lib/packs');

module.exports = async (req, res) => {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.UNLOCK_SECRET;
  if (!key || !secret) return json(res, 501, { error: 'Checkout is not set up yet.' });

  const id = String(query(req).session_id || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json(res, 400, { error: 'Bad session id' });

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + key },
  });
  const session = await r.json();
  if (!r.ok) return json(res, 502, { error: (session.error && session.error.message) || 'Stripe error' });
  if (session.payment_status !== 'paid') return json(res, 402, { error: 'That payment has not gone through.' });

  const scope = session.metadata && session.metadata.unlock_scope;
  if (!scope) return json(res, 500, { error: 'Session has no unlock scope.' });
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const h = crypto.createHash('sha256').update(id).digest();
  const nonce = Array.from(h.subarray(0, 4), (b) => B32[b & 31]).join('');
  const code = mint(scope, secret, nonce);
  const unlocks = loadAll().packs.filter((p) => scopeCovers(scope.toUpperCase(), p)).map((p) => ({ id: p.id, title: p.title }));
  json(res, 200, { code, unlocks });
};
