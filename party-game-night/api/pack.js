// GET /api/pack?id=christmas-movies&codes=CODE1,CODE2[&mode=sample]
// The questions for one game. A locked pack only ever returns its free
// sample round, so the full question set can't be read without a valid code.
const { json, query } = require('../lib/http');
const { getPack, sampleQuestions, meta } = require('../lib/packs');
const { scopesFrom, isUnlocked } = require('../lib/codes');

module.exports = (req, res) => {
  const q = query(req);
  const pack = getPack(String(q.id || ''));
  if (!pack) return json(res, 404, { error: 'No pack called "' + q.id + '".' });

  const unlocked = isUnlocked(pack, scopesFrom(q.codes, process.env));
  const mode = unlocked && q.mode !== 'sample' ? 'full' : 'sample';
  json(res, 200, {
    pack: meta(pack),
    mode,
    unlocked,
    questions: mode === 'full' ? pack.questions : sampleQuestions(pack),
  });
};
