// GET /api/ably-token?clientId=...&room=ABCD
// Hands the browser a short-lived Ably token request, scoped to one room's
// channel, so the Ably API key itself never reaches a phone.
// Env: ABLY_API_KEY  (Ably dashboard -> your app -> API Keys; the root key is fine)
const Ably = require('ably');
const { json, query } = require('../lib/http');

// Must match shardOf() in public/js/realtime.js.
const SHARDS = 8;
function shardOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % SHARDS;
}

const handler = async (req, res) => {
  const key = process.env.ABLY_API_KEY;
  if (!key) return json(res, 501, { error: 'Realtime is not configured: set ABLY_API_KEY.' });

  const q = query(req);
  const room = String(q.room || '').toUpperCase();
  const clientId = String(q.clientId || '');
  if (!/^[A-Z]{4}$/.test(room)) return json(res, 400, { error: 'Bad room code' });
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(clientId)) return json(res, 400, { error: 'Bad clientId' });

  try {
    // The TV broadcasts on pgn:ROOM and reads the four inboxes; a phone reads
    // pgn:ROOM and can only write to its own inbox (see public/js/realtime.js).
    const ch = 'pgn:' + room;
    const capability = {};
    if (clientId.startsWith('host-')) {
      capability[ch] = ['publish', 'subscribe'];
      for (let i = 0; i < SHARDS; i++) capability[ch + ':in' + i] = ['subscribe'];
    } else {
      capability[ch] = ['subscribe'];
      capability[ch + ':in' + shardOf(clientId)] = ['publish'];
    }
    const rest = new Ably.Rest({ key });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      ttl: 6 * 60 * 60 * 1000,
      capability: JSON.stringify(capability),
    });
    json(res, 200, tokenRequest);
  } catch (e) {
    json(res, 500, { error: 'Could not create token: ' + e.message });
  }
};

module.exports = handler;
module.exports.shardOf = shardOf;
