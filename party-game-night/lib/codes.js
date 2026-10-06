// Purchase / unlock codes.
//
// A code looks like  CHRISTMAS-K7QX-3M9PTR8A  and reads as
//   <SCOPE>-<NONCE>-<SIGNATURE>
// SCOPE is what it unlocks: a pack id (CHRISTMAS-MOVIES), a collection
// (CHRISTMAS, every pack whose "collection" is Christmas), or ALL.
// SIGNATURE is an HMAC of scope+nonce under UNLOCK_SECRET, so codes can be
// minted anywhere that knows the secret (scripts/make-code.js, or the Stripe
// claim endpoint after a payment) and checked here with no database.
//
// UNLOCK_CODES adds hand-picked codes on top, e.g. for a giveaway:
//   UNLOCK_CODES="MERRY2026=all, CAROLS4FREE=christmas-songs"

const crypto = require('crypto');

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

function base32(buf, len) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < len) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= len) break;
  }
  return out;
}

function normalize(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Typing mistakes Crockford base32 forgives, applied only to the nonce and
// signature parts (never the scope, which is a real word).
function fixTail(part) {
  return part.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

function sign(scope, nonce, secret) {
  const mac = crypto.createHmac('sha256', secret).update(scope + '|' + nonce).digest();
  return base32(mac, 8);
}

function mint(scope, secret, nonce) {
  if (!secret) throw new Error('UNLOCK_SECRET is not set');
  const s = String(scope).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const n = nonce ? fixTail(String(nonce).toUpperCase()) : base32(crypto.randomBytes(4), 4);
  return s + '-' + n + '-' + sign(s, n, secret);
}

function manualCodes(env) {
  const out = {};
  String(env.UNLOCK_CODES || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const i = pair.indexOf('=');
      if (i < 0) return;
      out[normalize(pair.slice(0, i))] = pair.slice(i + 1).trim().toUpperCase();
    });
  return out;
}

/** Returns the scope a code unlocks (upper case), or null if it isn't valid. */
function verify(code, env) {
  const c = normalize(code);
  if (!c) return null;
  const manual = manualCodes(env);
  if (manual[c]) return manual[c];

  const secret = env.UNLOCK_SECRET;
  if (!secret) return null;
  const parts = c.split('-');
  if (parts.length < 3) return null;
  const sig = fixTail(parts.pop());
  const nonce = fixTail(parts.pop());
  const scope = parts.join('-');
  if (!scope || nonce.length !== 4 || sig.length !== 8) return null;
  const expected = sign(scope, nonce, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? scope : null;
}

function scopeCovers(scope, pack) {
  if (!scope) return false;
  const s = scope.toUpperCase();
  if (s === 'ALL') return true;
  if (s === String(pack.id).toUpperCase()) return true;
  return !!pack.collection && s === String(pack.collection).toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** Parse "a,b,c" (query string) into the list of scopes the valid codes grant. */
function scopesFrom(codesParam, env) {
  return String(codesParam || '')
    .split(',')
    .map((c) => verify(c, env))
    .filter(Boolean);
}

function isUnlocked(pack, scopes) {
  return !!pack.free || scopes.some((s) => scopeCovers(s, pack));
}

module.exports = { mint, verify, normalize, scopeCovers, scopesFrom, isUnlocked };
