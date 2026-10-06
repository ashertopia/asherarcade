// GET /api/ably-token?clientId=...&room=ABCD
// Hands the browser a short-lived Ably token request, scoped to one room's
// channel, so the Ably API key itself never reaches a phone.
// Env: ABLY_API_KEY  (Ably dashboard -> your app -> API Keys; the root key is fine)
const Ably = require('ably');
const { json, query } = require('../lib/http');

module.exports = async (req, res) => {
  const key = process.env.ABLY_API_KEY;
  if (!key) return json(res, 501, { error: 'Realtime is not configured: set ABLY_API_KEY.' });

  const q = query(req);
  const room = String(q.room || '').toUpperCase();
  const clientId = String(q.clientId || '');
  if (!/^[A-Z]{4}$/.test(room)) return json(res, 400, { error: 'Bad room code' });
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(clientId)) return json(res, 400, { error: 'Bad clientId' });

  try {
    const rest = new Ably.Rest({ key });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      ttl: 6 * 60 * 60 * 1000,
      capability: JSON.stringify({ ['pgn:' + room]: ['publish', 'subscribe'] }),
    });
    json(res, 200, tokenRequest);
  } catch (e) {
    json(res, 500, { error: 'Could not create token: ' + e.message });
  }
};
