// Unit tests: node --test test/unit.test.js   (or npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/js/engine.js');
const codes = require('../lib/codes');
const packs = require('../lib/packs');

// Deterministic randomness for repeatable tests.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function newGame(opts) {
  const rng = seeded(7);
  const pack = packs.getPack('christmas-movies');
  const st = E.createRoom({ room: 'BCDF', hostId: 'host-1', now: 0 });
  const rounds = E.buildRounds(pack.questions, { mode: (opts && opts.mode) || 'full', length: 'short', rng });
  E.setupGame(st, { pack: packs.meta(pack), mode: (opts && opts.mode) || 'full', length: 'short', rounds, now: 0, rng });
  return { st, rng };
}

test('every pack is valid and has 25+ questions', () => {
  const { packs: list, errors } = packs.loadAll();
  assert.deepEqual(errors, []);
  assert.ok(list.length >= 4);
  for (const p of list) assert.ok(p.questions.length >= 25, p.id);
});

test('scripture packs cite their references on every question', () => {
  for (const id of ['nativity', 'prophecies']) {
    const p = packs.getPack(id);
    for (const q of p.questions) {
      for (const label of p.requireRefs) assert.ok(q.refs.some((r) => r.label === label && r.ref), id + ' ' + q.id + ' ' + label);
    }
    assert.match(p.translation, /^(NIV|NLT)$/);
  }
});

test('full game: classic, speed, then a final with one hard question', () => {
  const { st } = newGame();
  assert.deepEqual(st.rounds.map((r) => r.type), ['classic', 'speed', 'final']);
  assert.equal(st.rounds[0].questions.length, 5);
  assert.equal(st.rounds.reduce((n, r) => n + r.questions.length, 0), 10, 'the Short game is 10 questions');
  assert.equal(st.rounds[2].questions[0].difficulty, 'hard');
  const ids = st.rounds.flatMap((r) => r.questions.map((q) => q.id));
  assert.equal(new Set(ids).size, ids.length, 'no repeated questions');
});

test('sample mode is a single round of the marked sample questions', () => {
  const { st } = newGame({ mode: 'sample' });
  assert.equal(st.rounds.length, 1);
  assert.equal(st.rounds[0].type, 'sample');
  assert.equal(st.rounds[0].questions.length, 5);
});

test('join rules: unique names, rejoin by id, bans, size limit, expiry', () => {
  const { st } = newGame();
  assert.equal(E.join(st, { pid: 'a', name: 'Ann' }, 1).ok, true);
  assert.equal(E.join(st, { pid: 'b', name: ' ann ' }, 1).reason, 'name-taken');
  assert.equal(E.join(st, { pid: 'a', name: 'Ann' }, 2).rejoined, true);
  assert.equal(E.join(st, { pid: 'c', name: '<b>x</b>' }, 2).ok, true);
  assert.equal(st.players.c.name, 'bx/b', 'angle brackets stripped');
  E.kick(st, 'c', true);
  assert.equal(E.join(st, { pid: 'c', name: 'Again' }, 3).reason, 'removed');
  E.kick(st, 'a', false); // a player leaving on their own can come back
  assert.equal(E.join(st, { pid: 'a', name: 'Ann' }, 3).ok, true);
  for (let i = 0; i < 230; i++) E.join(st, { pid: 'p' + i, name: 'P' + i }, 4);
  assert.equal(st.order.length, E.MAX_PLAYERS);
  assert.equal(E.join(st, { pid: 'late', name: 'Late' }, E.ROOM_TTL_MS + 1).reason, 'expired');
});

test('scoring: faster correct answers score more; speed round penalises wrong answers', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'fast', name: 'Fast' }, 0);
  E.join(st, { pid: 'slow', name: 'Slow' }, 0);
  E.join(st, { pid: 'wrong', name: 'Wrong' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng); // round intro -> question
  assert.equal(st.phase, 'question');
  const q = E.currentQuestion(st);
  const key = E.questionKey(st);
  const t = st.phaseStartedAt;
  assert.ok(E.answer(st, { pid: 'fast', qkey: key, choice: q.correct }, t + 1000));
  assert.ok(E.answer(st, { pid: 'slow', qkey: key, choice: q.correct }, t + 15000));
  assert.ok(E.answer(st, { pid: 'wrong', qkey: key, choice: (q.correct + 1) % 4 }, t + 2000));
  assert.equal(E.answer(st, { pid: 'fast', qkey: key, choice: 0 }, t + 3000), false, 'one answer per question');
  // Everyone answered: the question closes ~1.2s later, not at the full 20s.
  assert.ok(st.phaseEndsAt <= t + 15000 + 1300);
  E.tick(st, st.phaseEndsAt, rng);
  assert.equal(st.phase, 'reveal');
  assert.ok(st.players.fast.score > st.players.slow.score);
  assert.ok(st.players.slow.score >= 500);
  assert.equal(st.players.wrong.score, 0);
  assert.equal(E.scoreFor('speed', 10000, { ms: 1000 }, false, 0), -250);
  assert.equal(E.scoreFor('speed', 10000, null, false, 0), 0, 'no answer, no penalty');
  assert.equal(E.scoreFor('classic', 20000, { ms: 0 }, true, 0), 1000);
});

test('a stale answer for an earlier question is ignored', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng);
  assert.equal(E.answer(st, { pid: 'a', qkey: 'old-key', choice: 0 }, 6500), false);
});

test('a phone cannot claim to be much faster than the host saw', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng);
  E.answer(st, { pid: 'a', qkey: E.questionKey(st), choice: 0, ms: 0 }, st.phaseStartedAt + 8000);
  assert.equal(st.answers.a.ms, 6500);
});

test('the final wager: clamp, win, lose', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.join(st, { pid: 'b', name: 'B' }, 0);
  E.start(st, 0, rng);
  let t = 0;
  // Fast-forward through rounds one and two with nobody answering.
  while (!(st.phase === 'roundIntro' && E.currentRound(st).type === 'final')) {
    t = st.phaseEndsAt;
    E.tick(st, t, rng);
  }
  st.players.a.score = 3000;
  st.players.b.score = 200;
  E.advance(st, t, rng);
  assert.equal(st.phase, 'wager');
  E.wager(st, { pid: 'a', amount: 99999 }, t);
  E.wager(st, { pid: 'b', amount: 1000 }, t);
  assert.equal(st.wagers.a, 3000, 'capped at score');
  assert.equal(st.wagers.b, 1000, 'low scores may still bet 1,000');
  t = st.phaseEndsAt;
  E.tick(st, t, rng);
  assert.equal(st.phase, 'question');
  const q = E.currentQuestion(st);
  E.answer(st, { pid: 'a', qkey: E.questionKey(st), choice: q.correct }, t + 100);
  E.answer(st, { pid: 'b', qkey: E.questionKey(st), choice: (q.correct + 1) % 4 }, t + 100);
  E.tick(st, st.phaseEndsAt, rng);
  assert.equal(st.players.a.score, 6000);
  assert.equal(st.players.b.score, -800);
  E.tick(st, st.phaseEndsAt, rng);
  assert.equal(st.phase, 'gameover');
});

test('public view hides the answer until the reveal', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng);
  const v = E.publicView(st, 6000);
  assert.equal(v.question.correct, undefined);
  assert.equal(v.question.reveal, undefined);
  assert.ok(!JSON.stringify(v).includes('"correct"'));
  E.advance(st, 7000, rng);
  assert.equal(typeof E.publicView(st, 7000).question.correct, 'number');
});

test('pause stops the clock and resume continues it', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng);
  const ends = st.phaseEndsAt;
  E.pause(st, 10000);
  assert.equal(E.tick(st, ends + 60000, rng), false);
  E.resume(st, 70000);
  assert.equal(st.phaseEndsAt, ends + 60000);
});

test('unlock codes: mint, verify, typo-tolerant, scoped, tamper-proof', () => {
  const env = { UNLOCK_SECRET: 's3cret', UNLOCK_CODES: 'MERRY2026=all' };
  const c = codes.mint('christmas', env.UNLOCK_SECRET);
  assert.equal(codes.verify(c, env), 'CHRISTMAS');
  assert.equal(codes.verify(c.toLowerCase().replace(/-/g, ' - '), env), 'CHRISTMAS');
  assert.equal(codes.verify(c.slice(0, -1) + (c.endsWith('A') ? 'B' : 'A'), env), null);
  assert.equal(codes.verify(c, { UNLOCK_SECRET: 'other' }), null);
  assert.equal(codes.verify('merry2026', env), 'ALL');
  const nativity = packs.getPack('nativity');
  assert.ok(codes.scopeCovers('CHRISTMAS', nativity));
  assert.ok(codes.scopeCovers('NATIVITY', nativity));
  assert.ok(!codes.scopeCovers('CHRISTMAS-MOVIES', nativity));
  const own = codes.mint('christmas-movies', env.UNLOCK_SECRET);
  assert.equal(codes.verify(own, env), 'CHRISTMAS-MOVIES');
});

// A fake req/res pair for calling the Vercel functions directly.
function call(handler, url, opts) {
  return new Promise((resolve) => {
    const req = { url, method: (opts && opts.method) || 'GET', headers: { host: 'x' }, body: opts && opts.body };
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); },
    };
    handler(req, res);
  });
}

test('api/pack never leaks a locked pack beyond its sample', async () => {
  process.env.UNLOCK_SECRET = 's3cret';
  const handler = require('../api/pack.js');
  const locked = await call(handler, '/api/pack?id=prophecies');
  assert.equal(locked.body.mode, 'sample');
  assert.equal(locked.body.questions.length, 5);
  const code = codes.mint('all', 's3cret');
  const full = await call(handler, '/api/pack?id=prophecies&codes=' + code);
  assert.equal(full.body.mode, 'full');
  assert.equal(full.body.questions.length, packs.getPack('prophecies').questions.length);
  const missing = await call(handler, '/api/pack?id=nope');
  assert.equal(missing.status, 404);
});

test('api/redeem reports what a code unlocks', async () => {
  process.env.UNLOCK_SECRET = 's3cret';
  const handler = require('../api/redeem.js');
  const r = await call(handler, '/api/redeem', { method: 'POST', body: { code: codes.mint('christmas', 's3cret') } });
  assert.equal(r.body.valid, true);
  assert.equal(r.body.unlocks.length, 4);
  const bad = await call(handler, '/api/redeem', { method: 'POST', body: { code: 'NOPE-AAAA-BBBBBBBB' } });
  assert.equal(bad.body.valid, false);
});

test('api/ably-token: phones can only read the broadcast and write their own inbox', async () => {
  process.env.ABLY_API_KEY = 'appid.keyid:keysecret';
  const handler = require('../api/ably-token.js');
  const r = await call(handler, '/api/ably-token?clientId=player123&room=BCDF');
  assert.equal(r.status, 200);
  assert.equal(r.body.keyName, 'appid.keyid');
  assert.equal(r.body.clientId, 'player123');
  const shard = handler.shardOf('player123');
  assert.deepEqual(JSON.parse(r.body.capability), { 'pgn:BCDF': ['subscribe'], ['pgn:BCDF:in' + shard]: ['publish'] });
  assert.ok(r.body.mac);
  assert.ok(!JSON.stringify(r.body).includes('keysecret'));
  const host = await call(handler, '/api/ably-token?clientId=host-abc123&room=BCDF');
  const cap = JSON.parse(host.body.capability);
  assert.deepEqual(cap['pgn:BCDF'], ['publish', 'subscribe']);
  assert.deepEqual(cap['pgn:BCDF:in7'], ['subscribe'], 'the TV reads all eight inboxes');
  assert.equal(Object.keys(cap).length, 9);
  const bad = await call(handler, '/api/ably-token?clientId=player123&room=bad!');
  assert.equal(bad.status, 400);
  delete process.env.ABLY_API_KEY;
});

test('200 players: the game runs to the end and every broadcast stays within two 5 KiB Ably billing units', () => {
  const { st, rng } = newGame();
  const ids = [];
  for (let i = 0; i < 240; i++) {
    const pid = 'p' + Math.random().toString(36).slice(2, 9);
    if (E.join(st, { pid, name: 'Guest ' + i }, 0).ok) ids.push(pid);
  }
  assert.equal(st.order.length, 200, 'capped at 200');
  E.start(st, 0, rng);
  let t = 0;
  let biggest = 0;
  let phases = 0;
  while (st.phase !== 'gameover' && phases < 200) {
    if (st.phase === 'question') {
      for (const pid of ids) E.answer(st, { pid, qkey: E.questionKey(st), choice: Math.floor(rng() * 4) }, st.phaseStartedAt + 2000);
    }
    if (st.phase === 'wager') for (const pid of ids) E.wager(st, { pid, amount: 500 }, t);
    biggest = Math.max(biggest, JSON.stringify(E.publicView(st, t)).length);
    t = st.phaseEndsAt;
    E.tick(st, t, rng);
    phases++;
  }
  assert.equal(st.phase, 'gameover');
  assert.ok(biggest < 10 * 1024, 'largest broadcast was ' + biggest + ' bytes');
  const v = E.publicView(st, t);
  assert.equal(v.top.length, 10);
  assert.equal(Object.keys(v.scores).length, 200);
  // Each phone's place matches the TV's ranking.
  const { rank } = E.ranks(st);
  for (const pid of ids) assert.equal(E.placeOf(v.scores, pid), rank[pid]);
});

test('checkout stays off until Stripe is configured', async () => {
  const handler = require('../api/checkout.js');
  const r = await call(handler, '/api/checkout', { method: 'POST', body: { packId: 'nativity' } });
  assert.equal(r.status, 501);
});

test('products: prices, Collection is the default, scopes still unlock the right packs', () => {
  const products = require('../lib/products');
  const byId = Object.fromEntries(products.catalog().map((p) => [p.id, p]));
  assert.equal(byId.pack.price, '$9.99');
  assert.equal(byId.christmas.price, '$24.99');
  assert.equal(byId.group.price, '$34.99');
  assert.ok(byId.christmas.default);
  for (const p of packs.loadAll().packs) assert.equal(p.price.usd, 9.99, p.id + ' shows the single-pack price');

  const prices = { pack: 'price_pack', christmas: 'price_col', group: 'price_grp' };
  const get = packs.getPack;
  assert.deepEqual(products.resolvePurchase({}, prices, get), { product: 'christmas', scope: 'christmas', priceId: 'price_col' }, 'no product = Collection');
  assert.deepEqual(products.resolvePurchase({ product: 'group' }, prices, get), { product: 'group', scope: 'christmas', priceId: 'price_grp' }, 'Group License unlocks the same four packs');
  assert.deepEqual(products.resolvePurchase({ product: 'pack', packId: 'nativity' }, prices, get), { product: 'pack', scope: 'nativity', priceId: 'price_pack' });
  assert.equal(products.resolvePurchase({ product: 'pack', packId: 'nativity' }, Object.assign({ nativity: 'price_nat' }, prices), get).priceId, 'price_nat', 'a per-pack Price overrides "pack"');
  assert.ok(products.resolvePurchase({ product: 'pack' }, prices, get).error, 'single pack needs a packId');
  assert.ok(products.resolvePurchase({ product: 'bundle-x' }, prices, get).error, 'unknown products are refused');
  assert.ok(products.resolvePurchase({ product: 'group' }, { christmas: 'p' }, get).error, 'no Price configured = not for sale');

  // The codes those purchases mint unlock what was paid for.
  const col = codes.mint('christmas', 's');
  const env = { UNLOCK_SECRET: 's' };
  assert.equal(packs.loadAll().packs.filter((p) => codes.isUnlocked(p, codes.scopesFrom(col, env))).length, 4);
  const one = codes.mint('nativity', 's');
  assert.deepEqual(packs.loadAll().packs.filter((p) => codes.isUnlocked(p, codes.scopesFrom(one, env))).map((p) => p.id), ['nativity']);
});

test('api/config lists the products for the buy buttons', async () => {
  const r = await call(require('../api/config.js'), '/api/config');
  assert.deepEqual(r.body.products.map((p) => p.id + ' ' + p.price), ['pack $9.99', 'christmas $24.99', 'group $34.99']);
  assert.equal(r.body.checkout, false);
});

test('game length: the host picks 10 or 20 questions', () => {
  const pack = packs.getPack('nativity');
  assert.deepEqual(Object.keys(E.LENGTHS), ['short', 'long']);
  for (const [len, n] of [['short', 10], ['long', 20]]) {
    const rounds = E.buildRounds(pack.questions, { mode: 'full', length: len, rng: seeded(3) });
    const ids = rounds.flatMap((r) => r.questions.map((q) => q.id));
    assert.equal(ids.length, n, len + ' game is ' + n + ' questions');
    assert.equal(new Set(ids).size, n, 'no repeats');
    assert.deepEqual(rounds.map((r) => r.type), ['classic', 'speed', 'final']);
  }
});

test('phones get the explanation at the reveal (for games with no TV)', () => {
  const { st, rng } = newGame();
  E.join(st, { pid: 'a', name: 'A' }, 0);
  E.start(st, 0, rng);
  E.advance(st, 6000, rng);
  assert.equal(E.publicView(st, 6000).question.reveal, undefined, 'not before the answer is out');
  E.advance(st, 7000, rng);
  const q = E.publicView(st, 7000).question;
  assert.ok(q.reveal && q.reveal.length > 10);
  assert.ok(Array.isArray(q.refs));
});
