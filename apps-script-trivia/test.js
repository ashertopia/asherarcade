// Tests Code.gs against fake Apps Script services. Run: node apps-script-trivia/test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

function makeEnv(gameJson) {
  const sheets = {};
  const cache = {};
  const props = {};
  function Sheet(name) {
    this.data = [];
    this.getLastRow = () => this.data.length;
    this.getRange = (r, c, nr, nc) => ({
      setValues: (v) => { v.forEach((row, i) => { this.data[r - 1 + i] = this.data[r - 1 + i] || []; row.forEach((x, j) => { this.data[r - 1 + i][c - 1 + j] = x; }); }); return { setFontWeight() {} }; },
      getValues: () => this.data.slice(r - 1, r - 1 + nr).map(row => { const out = []; for (let j = 0; j < nc; j++) out.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); return out; })
    });
    this.appendRow = (row) => this.data.push(row.slice());
    this.setFrozenRows = () => {};
  }
  const ss = { getId: () => 'SHEET1', getUrl: () => 'url', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)) };
  const fetched = [];
  const ctx = {
    console,
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url) => { fetched.push(url); const id = url.split('/').pop().replace('.json', ''); const g = gameJson[id]; return { getResponseCode: () => g ? 200 : 404, getContentText: () => JSON.stringify(g) }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
  const get = (q) => JSON.parse(ctx.doGet({ parameter: q }).body);
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).body);
  return { get, post, sheets, cache, fetched, ctx };
}

const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '../trivia/games/demo.json'), 'utf8'));
const closed = Object.assign({}, demo, { closesAt: '2000-01-01' });
const N = demo.questions.length;
const allRight = (ms) => demo.questions.map(q => ({ c: q.correct, ms }));

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('scoring formula: instant 1000, buzzer 500, wrong 0', () => {
  const { ctx } = makeEnv({});
  assert.strictEqual(ctx.pointsFor_(true, 0, 20), 1000);
  assert.strictEqual(ctx.pointsFor_(true, 20000, 20), 500);
  assert.strictEqual(ctx.pointsFor_(true, 10000, 20), 750);
  assert.strictEqual(ctx.pointsFor_(false, 0, 20), 0);
});

t('scoring matches trivia.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '../trivia.html'), 'utf8');
  const src = html.match(/function pointsFor\(isRight, ms, secs\)\{[\s\S]*?\n\}/)[0];
  const clientFn = new Function(src + '; return pointsFor;')();
  const { ctx } = makeEnv({});
  for (const ms of [0, 1, 999, 5000, 12345, 19999, 20000, 25000]) {
    for (const ok of [true, false]) assert.strictEqual(clientFn(ok, ms, 20), ctx.pointsFor_(ok, ms, 20));
  }
  const keySrc = html.match(/function cleanName\(s\)\{[\s\S]*?\n\}\nfunction nameKey\(s\)\{[\s\S]*?\n\}/)[0];
  const clientKey = new Function(keySrc + '; return nameKey;')();
  for (const n of ['Aunt Denise', ' aunt   denise ', 'José R.', '李小龙', '<b>x</b>']) assert.strictEqual(clientKey(n), ctx.nameKey_(n));
});

t('full game: start, finish, server scores it, board ranks', () => {
  const env = makeEnv({ demo });
  assert.deepStrictEqual(env.post({ action: 'start', game: 'demo', name: 'Aunt Denise', device: 'device-aaaa' }), { ok: true });
  const r = env.post({ action: 'finish', game: 'demo', name: 'Aunt Denise', device: 'device-aaaa', answers: allRight(0) });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.score, N * 1000); assert.strictEqual(r.right, N); assert.strictEqual(r.rank, 1);
  env.post({ action: 'start', game: 'demo', name: 'Bob', device: 'device-bbbb' });
  const r2 = env.post({ action: 'finish', game: 'demo', name: 'Bob', device: 'device-bbbb', answers: allRight(10000) });
  assert.strictEqual(r2.score, N * 750); assert.strictEqual(r2.rank, 2); assert.strictEqual(r2.count, 2);
  const b = env.get({ action: 'board', game: 'demo' });
  assert.deepStrictEqual(b.players.map(p => p.name), ['Aunt Denise', 'Bob']);
});

t('cannot post a made-up score: server ignores client score fields and clamps time', () => {
  const env = makeEnv({ demo });
  env.post({ action: 'start', game: 'demo', name: 'Cheater', device: 'device-cccc' });
  const wrong = demo.questions.map(q => ({ c: (q.correct + 1) % q.answers.length, ms: -5000 }));
  const r = env.post({ action: 'finish', game: 'demo', name: 'Cheater', device: 'device-cccc', answers: wrong, score: 999999 });
  assert.strictEqual(r.score, 0);
});

t('one try per phone: finished device cannot start again, even with a new name', () => {
  const env = makeEnv({ demo });
  env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' });
  env.post({ action: 'finish', game: 'demo', name: 'Amy', device: 'device-aaaa', answers: allRight(0) });
  assert.strictEqual(env.post({ action: 'start', game: 'demo', name: 'Amy Two', device: 'device-aaaa' }).error, 'already_played');
});

t('one try per name: same name on another phone is refused, case/spacing ignored', () => {
  const env = makeEnv({ demo });
  env.post({ action: 'start', game: 'demo', name: 'Amy R', device: 'device-aaaa' });
  assert.strictEqual(env.post({ action: 'start', game: 'demo', name: ' amy   r ', device: 'device-zzzz' }).error, 'name_taken');
});

t('second finish is ignored: score cannot be replaced', () => {
  const env = makeEnv({ demo });
  env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' });
  const wrong = demo.questions.map(() => ({ c: -1, ms: 20000 }));
  env.post({ action: 'finish', game: 'demo', name: 'Amy', device: 'device-aaaa', answers: wrong });
  const again = env.post({ action: 'finish', game: 'demo', name: 'Amy', device: 'device-aaaa', answers: allRight(0) });
  assert.strictEqual(again.score, 0);
});

t('same phone resuming before finishing keeps its seat', () => {
  const env = makeEnv({ demo });
  assert.ok(env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' }).ok);
  assert.ok(env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' }).ok);
  assert.strictEqual(env.sheets.demo.data.length, 2); // header + one player
});

t('bad input is rejected', () => {
  const env = makeEnv({ demo });
  assert.strictEqual(env.post({ action: 'start', game: 'nope', name: 'Amy', device: 'device-aaaa' }).error, 'unknown_game');
  assert.strictEqual(env.post({ action: 'start', game: '../x', name: 'Amy', device: 'device-aaaa' }).error, 'unknown_game');
  assert.strictEqual(env.post({ action: 'start', game: 'demo', name: '!', device: 'device-aaaa' }).error, 'bad_name');
  assert.strictEqual(env.post({ action: 'finish', game: 'demo', name: 'Amy', device: 'device-qqqq', answers: allRight(0) }).error, 'not_started');
  env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' });
  assert.strictEqual(env.post({ action: 'finish', game: 'demo', device: 'device-aaaa', answers: allRight(0).slice(1) }).error, 'bad_answers');
  assert.strictEqual(env.post({ action: 'finish', game: 'demo', device: 'device-aaaa', answers: allRight(0).map(a => ({ c: 9, ms: 1 })) }).error, 'bad_answers');
});

t('closed game turns away new players', () => {
  const env = makeEnv({ closed });
  assert.strictEqual(env.post({ action: 'start', game: 'closed', name: 'Amy', device: 'device-aaaa' }).error, 'closed');
});

t('hidden rows drop off the board', () => {
  const env = makeEnv({ demo });
  env.post({ action: 'start', game: 'demo', name: 'Rude Name', device: 'device-aaaa' });
  env.post({ action: 'finish', game: 'demo', device: 'device-aaaa', answers: allRight(0) });
  env.sheets.demo.data[1][9] = 'x';
  delete env.cache['board:demo'];
  assert.strictEqual(env.get({ action: 'board', game: 'demo' }).count, 0);
});

t('game file is fetched once and cached', () => {
  const env = makeEnv({ demo });
  env.get({ action: 'board', game: 'demo' });
  env.post({ action: 'start', game: 'demo', name: 'Amy', device: 'device-aaaa' });
  assert.strictEqual(env.fetched.length, 1);
});

console.log(`\n${passed} passed`);
