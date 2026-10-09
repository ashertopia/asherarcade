// Tests the pay-first build flow in Code.gs with fake Stripe, Claude, Drive and Mail.
// Run: node apps-script-trivia/build-test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');

function env(opts) {
  const props = { STRIPE_KEY: 'rk_test', ANTHROPIC_API_KEY: 'sk-test' }, cache = {}, files = {}, mails = [], sheets = {};
  let fileN = 0, claudeCalls = 0;
  const File = (id) => ({ getId: () => id, setContent: c => { files[id] = c; }, getBlob: () => ({ getDataAsString: () => files[id] }) });
  const sessions = {
    cs_test_paid0000001: { status: 'complete', payment_status: 'paid', payment_link: 'plink_1UOU5DRyTAXcMvg40XFeF5Bt', client_reference_id: 'AA-261010-AB12', customer_details: { email: 'mom@example.com', name: 'Mom' } },
    cs_test_free0000001: { status: 'complete', payment_status: 'no_payment_required', payment_link: 'plink_1UOU5DRyTAXcMvg40XFeF5Bt', client_reference_id: null, customer_details: { email: 'a@b.co' } },
    cs_test_open0000001: { status: 'open', payment_status: 'unpaid', payment_link: 'plink_1UOU5DRyTAXcMvg40XFeF5Bt' },
    cs_test_other000001: { status: 'complete', payment_status: 'paid', payment_link: 'plink_other' }
  };
  const ctx = {
    console: { log() {}, warn() {}, error: m => process.env.DBG && process.stderr.write(m + '\n') },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => Object.assign({}, props) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    DriveApp: { getFileById: id => File(id), getFolderById: () => folder, createFolder: () => folder },
    MailApp: { sendEmail: (to, subj) => mails.push({ to, subj }) },
    Session: { getScriptTimeZone: () => 'America/Chicago', getEffectiveUser: () => ({ getEmail: () => 'owner@x.co' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ body: s, setMimeType() { return this; } }) },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    UrlFetchApp: { fetch: (url, o) => {
      if (url.indexOf('api.stripe.com') > 0) {
        const s = sessions[decodeURIComponent(url.split('/').pop())];
        return { getResponseCode: () => s ? 200 : 404, getContentText: () => JSON.stringify(s || {}) };
      }
      if (url.indexOf('api.anthropic.com') > 0) {
        claudeCalls++;
        if (opts && opts.claudeDown) return { getResponseCode: () => 529, getContentText: () => 'overloaded' };
        const prompt = JSON.parse(o.payload).messages[0].content, out = {};
        prompt.split('\n').forEach(l => { const m = l.match(/^(\d+)\. .*Write (\d)$/); if (m) out[m[1]] = ['Alpha ' + m[1], 'Beta ' + m[1], 'Gamma ' + m[1], 'way too many words here'].slice(0, Number(m[2])); });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(out) }] }) };
      }
      return { getResponseCode: () => 404, getContentText: () => '' };
    } }
  };
  const folder = { getId: () => 'FOLDER', getUrl: () => 'folder', createFile: (name, c) => { const id = 'F' + (++fileN); files[id] = c; return File(id); } };
  function Sheet() { this.data = []; this.getLastRow = () => this.data.length;
    this.getRange = (r, c, nr, nc) => ({ setValues: v => { v.forEach((row, i) => { this.data[r - 1 + i] = row.slice(); }); return { setFontWeight() {} }; },
      getValues: () => this.data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); return o; }) });
    this.appendRow = row => this.data.push(row.slice()); this.setFrozenRows = () => {}; }
  const ss = { getId: () => 'SS', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet()) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx);
  return {
    get: q => JSON.parse(ctx.doGet({ parameter: q }).body),
    post: b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).body),
    props, mails, ctx, claude: () => claudeCalls
  };
}

const game = n => ({
  honoree: 'J.D. Swilley', occasion: 'birthday', theme: { primary: '#111111', secondary: '#8a8d8f' },
  questions: Array.from({ length: n || 20 }, (_, i) => ({ q: 'Question ' + (i + 1) + '?', answers: i === 3 ? ['5'] : i === 0 ? ['Hats', 'Guitars', 'Books'] : ['Right ' + i] }))
});
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('unpaid, other-product and made-up sessions are refused', () => {
  const e = env();
  for (const s of ['cs_test_open0000001', 'cs_test_other000001', 'cs_test_nope0000001', 'not-a-session']) {
    assert.strictEqual(e.post({ action: 'session', session: s }).error, 'not_paid');
    assert.strictEqual(e.post({ action: 'build', session: s, game: game() }).error, 'not_paid');
  }
});

t('paid session: build link emailed once, $0 promo sessions count as paid', () => {
  const e = env();
  const r = e.post({ action: 'session', session: 'cs_test_paid0000001' });
  assert.ok(r.ok); assert.strictEqual(r.order, 'AA-261010-AB12'); assert.strictEqual(r.gameId, '');
  e.post({ action: 'session', session: 'cs_test_paid0000001' });
  assert.strictEqual(e.mails.filter(m => m.subj === 'Build your trivia game').length, 1);
  assert.ok(e.post({ action: 'session', session: 'cs_test_free0000001' }).ok);
});

t('build: Claude fills the gaps, game goes live, playable, emails sent', () => {
  const e = env();
  const r = e.post({ action: 'build', session: 'cs_test_paid0000001', game: game(), photo: 'data:image/jpeg;base64,/9j/AAAA' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.gameId, 'j-d-ab12'.replace('j-d', 'j-d')); assert.strictEqual(r.status, 'live');
  r.game.questions.forEach(q => { assert.strictEqual(q.answers.length, 4); assert.strictEqual(q.correct, 0); assert.ok(q.answers.every(a => a.split(' ').length <= 4)); });
  assert.deepStrictEqual(r.game.questions[0].answers, ['Hats', 'Guitars', 'Books', 'Alpha 1']);
  const served = e.get({ action: 'game', game: r.gameId });
  assert.ok(served.ok); assert.strictEqual(served.game.photo, 'data:image/jpeg;base64,/9j/AAAA');
  assert.strictEqual(served.game.eyebrow, 'Happy Birthday, J.D.');
  assert.ok(e.post({ action: 'start', game: r.gameId, name: 'Grandma', device: 'device-123' }).ok, 'leaderboard works on built games');
  assert.ok(e.mails.some(m => m.to === 'mom@example.com' && /is ready/.test(m.subj)));
  assert.ok(e.mails.some(m => m.to === 'owner@x.co' && /live/.test(m.subj)));
  assert.strictEqual(e.post({ action: 'session', session: 'cs_test_paid0000001' }).status, 'live');
});

t('edits keep the same id and photo, and lock once someone has played', () => {
  const e = env();
  const r1 = e.post({ action: 'build', session: 'cs_test_paid0000001', game: game(), photo: 'data:image/jpeg;base64,/9j/AAAA' });
  const g2 = game(); g2.questions[5].q = 'Changed?';
  const r2 = e.post({ action: 'build', session: 'cs_test_paid0000001', game: g2 });
  assert.strictEqual(r2.gameId, r1.gameId); assert.strictEqual(r2.game.questions[5].q, 'Changed?');
  assert.strictEqual(e.get({ action: 'game', game: r1.gameId }).game.photo, 'data:image/jpeg;base64,/9j/AAAA');
  const answers = r2.game.questions.map(() => ({ c: 0, ms: 1000 }));
  e.post({ action: 'start', game: r1.gameId, name: 'Grandma', device: 'device-123' });
  assert.ok(e.post({ action: 'finish', game: r1.gameId, name: 'Grandma', device: 'device-123', answers }).ok);
  assert.strictEqual(e.post({ action: 'build', session: 'cs_test_paid0000001', game: game() }).error, 'locked');
});

t('Claude down: game waits, numbers still filled, sweep finishes it later', () => {
  const opts = { claudeDown: true }, e = env(opts);
  const r = e.post({ action: 'build', session: 'cs_test_paid0000001', game: game() });
  assert.ok(r.ok); assert.strictEqual(r.status, 'writing');
  assert.deepStrictEqual(r.game.questions[3].answers, ['5', '6', '4', '7']);
  assert.strictEqual(e.get({ action: 'game', game: r.gameId }).error, 'not_ready');
  assert.strictEqual(e.post({ action: 'start', game: r.gameId, name: 'Early Bird', device: 'device-999' }).error, 'unknown_game');
  opts.claudeDown = false; e.ctx.sweep();
  assert.ok(e.get({ action: 'game', game: r.gameId }).ok);
  assert.ok(e.mails.some(m => /is ready/.test(m.subj)));
});

t('bad input is refused', () => {
  const e = env();
  const g = game(); g.theme.primary = 'red';
  assert.ok(e.post({ action: 'build', session: 'cs_test_paid0000001', game: g }).error);
  const g2 = game(); g2.questions[2].answers = [];
  assert.ok(/Question 3/.test(e.post({ action: 'build', session: 'cs_test_paid0000001', game: g2 }).error));
  assert.ok(e.post({ action: 'build', session: 'cs_test_paid0000001', game: game(), photo: 'javascript:alert(1)' }).error);
});

console.log(passed + ' passed');
