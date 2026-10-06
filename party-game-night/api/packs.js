// GET /api/packs?codes=CODE1,CODE2
// The pack picker: every pack's title, tagline and difficulty mix, and whether
// the codes the host has entered unlock it. No questions in here.
const { json, query } = require('../lib/http');
const { loadAll, summary } = require('../lib/packs');
const { scopesFrom, isUnlocked } = require('../lib/codes');

module.exports = (req, res) => {
  const scopes = scopesFrom(query(req).codes, process.env);
  const { packs } = loadAll();
  json(res, 200, { packs: packs.map((p) => summary(p, isUnlocked(p, scopes))) });
};
