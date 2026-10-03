// Stripe webhook relay for KeepsakeDrop orders.
//
// Why this exists: the fulfillment pipeline is a Google Apps Script web app
// (apps-script-fulfillment/), and Apps Script can't do two things Stripe
// needs: it can't read request headers (so it can't check Stripe-Signature),
// and it answers every POST with a 302 redirect, which Stripe counts as a
// failed delivery ("We consider redirect responses to webhook requests as
// failures", docs.stripe.com/webhooks). So Stripe calls this function instead:
//
//   1. read the raw body and verify Stripe-Signature with STRIPE_WEBHOOK_SECRET
//   2. forward the verified event to FULFILLMENT_SCRIPT_URL?token=FULFILLMENT_TOKEN
//      (following Apps Script's redirect to read its JSON answer)
//   3. answer Stripe:
//      - Apps Script answered ok within a few seconds      -> 200
//      - Apps Script answered with an error (bad token, crash, busy) -> 502,
//        so Stripe retries and its dashboard shows the failure
//      - still working after FAST_ACK_MS (a real order: Drive, Docs, the sign
//        PDF...) -> 200 now, and the forward keeps running via waitUntil.
//        Apps Script emails the owner the result either way.
//
// Env vars (Vercel → Settings → Environment Variables, Production):
//   STRIPE_WEBHOOK_SECRET   whsec_... from the Stripe webhook endpoint
//                           (comma-separate two values while rotating)
//   FULFILLMENT_SCRIPT_URL  the fulfillment Apps Script /exec URL
//   FULFILLMENT_TOKEN       the same value as its WEBHOOK_TOKEN Script Property

const crypto = require('crypto');

let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch (e) {
  waitUntil = null; // fall back to finishing the forward before answering
}

const TOLERANCE_SEC = 300; // same replay window Stripe's own libraries use
const FAST_ACK_MS = 8000;
const ATTEMPT_TIMEOUT_MS = 50000;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Stripe's documented scheme: HMAC-SHA256 of "<t>.<raw body>", hex, in v1=. */
function verifyStripeSignature(rawBody, header, secrets, nowSec) {
  if (!header || !secrets.length) return false;
  let t = null;
  const v1 = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return false;
  if (Math.abs(nowSec - Number(t)) > TOLERANCE_SEC) return false;
  return secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(t + '.').update(rawBody).digest();
    return v1.some((sig) => {
      const got = Buffer.from(sig, 'hex');
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function forwardOnce(rawBody) {
  const url = new URL(process.env.FULFILLMENT_SCRIPT_URL);
  url.searchParams.set('token', process.env.FULFILLMENT_TOKEN);
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
    redirect: 'follow', // Apps Script answers 302 -> script.googleusercontent.com
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  const text = await resp.text();
  let out = null;
  try { out = JSON.parse(text); } catch (e) { out = null; }
  return { status: resp.status, out, text };
}

/** Resolves { ok, out } — retries network errors and "busy" a couple of times. */
async function forwardWithRetry(rawBody, eventId) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      last = await forwardOnce(rawBody);
      if (last.out && last.out.ok) {
        console.log('fulfillment ok', eventId, JSON.stringify(last.out).slice(0, 500));
        return { ok: true, out: last.out };
      }
      console.error('fulfillment answered', eventId, last.status, String(last.text).slice(0, 500));
      if (!(last.out && last.out.error === 'busy, retry')) return { ok: false, out: last.out };
    } catch (err) {
      console.error('fulfillment forward failed', eventId, 'attempt', attempt, String(err && err.message || err));
    }
    if (attempt < 3) await sleep(1500 * attempt);
  }
  return { ok: false, out: last && last.out };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const secrets = String(process.env.STRIPE_WEBHOOK_SECRET || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!secrets.length || !process.env.FULFILLMENT_SCRIPT_URL || !process.env.FULFILLMENT_TOKEN) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET / FULFILLMENT_SCRIPT_URL / FULFILLMENT_TOKEN not set');
    res.status(500).json({ error: 'not configured' });
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], secrets, Math.floor(Date.now() / 1000))) {
    res.status(400).json({ error: 'bad signature' });
    return;
  }

  let eventId = '';
  try { eventId = JSON.parse(rawBody.toString('utf8')).id || ''; } catch (e) { /* forwarded as-is */ }

  const forwarding = forwardWithRetry(rawBody, eventId);
  const TIMEOUT = Symbol('timeout');
  const first = await Promise.race([forwarding, sleep(FAST_ACK_MS).then(() => TIMEOUT)]);

  if (first === TIMEOUT) {
    if (waitUntil) {
      waitUntil(forwarding);
    } else {
      await forwarding;
    }
    res.status(200).json({ received: true, forwarded: 'in progress' });
    return;
  }
  if (first.ok) {
    res.status(200).json({ received: true });
    return;
  }
  res.status(502).json({ error: 'fulfillment did not accept the event' });
}

module.exports = handler;
// Signature checks need the exact bytes Stripe sent, so never let a body
// parser touch the request first.
module.exports.config = { api: { bodyParser: false } };
module.exports.verifyStripeSignature = verifyStripeSignature;
