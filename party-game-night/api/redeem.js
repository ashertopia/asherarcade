// POST /api/redeem {code}
// Checks a purchase code and says which packs it opens.
const { json, readJson } = require('../lib/http');
const { loadAll } = require('../lib/packs');
const { verify, normalize, scopeCovers } = require('../lib/codes');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return json(res, 400, { error: 'Bad JSON' });
  }
  const code = normalize(body.code);
  const scope = verify(code, process.env);
  if (!scope) return json(res, 200, { valid: false });
  const unlocks = loadAll().packs.filter((p) => scopeCovers(scope, p)).map((p) => ({ id: p.id, title: p.title }));
  json(res, 200, { valid: true, code, scope, unlocks });
};
