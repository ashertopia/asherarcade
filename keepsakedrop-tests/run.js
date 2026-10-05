// Sanity tests for the KeepsakeDrop Apps Script + page logic that can run
// outside Google: date parsing, Stripe event routing, follow-up due dates,
// Sheet value normalising, upload checks. Run with:  node keepsakedrop-tests/run.js
// (Node 18+, no dependencies). Lives outside apps-script*/ so clasp never
// pushes it into a script project.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
process.env.TZ = 'America/Chicago'; // Apps Script projects here run in Chicago time

function fmt(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'long', day: 'numeric',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const num = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  if (pattern === 'yyyy-MM-dd') return num;
  if (pattern === 'MMMM d, yyyy') return `${parts.month} ${parts.day}, ${parts.year}`;
  throw new Error('pattern not stubbed: ' + pattern);
}

function load(files, extra) {
  const ctx = Object.assign({
    console,
    Utilities: { formatDate: (d, tz, p) => { if (isNaN(d.getTime())) throw new Error('Invalid argument: date'); return fmt(d, tz, p); } },
  }, extra || {});
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.message)); process.exitCode = 1; }
}

// ── fulfillment script ──
const F = load(['apps-script-fulfillment/Code.gs', 'apps-script-fulfillment/Fulfillment.gs',
  'apps-script-fulfillment/Sheet.gs', 'apps-script-fulfillment/Digest.gs']);

test('event date parsing: accepted formats', () => {
  const cases = {
    '06/06/2027': '2027-06-06', '6/6/2027': '2027-06-06', '6/6/27': '2027-06-06',
    '6-6-2027': '2027-06-06', '6.6.2027': '2027-06-06', '2027-06-06': '2027-06-06',
    '2027/6/6': '2027-06-06', 'June 6, 2027': '2027-06-06', 'june 6 2027': '2027-06-06',
    'Jun 6th, 2027': '2027-06-06', 'Sept 12 2026': '2026-09-12', 'Saturday, June 6, 2027': '2027-06-06',
    'Sat Jun 6 2027': '2027-06-06', '6 June 2027': '2027-06-06', '6th of': null,
    '25/12/2026': '2026-12-25', '12/25/2026': '2026-12-25', ' 10/3/2026 ': '2026-10-03',
    'Dec. 31, 2026': '2026-12-31', '2/29/2028': '2028-02-29',
    '11152026': '2026-11-15', '20261115': '2026-11-15', '10251975': null, '13152026': null,
  };
  for (const [input, want] of Object.entries(cases)) {
    const p = F.parseEventDateParts_(input);
    const got = p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null;
    assert.strictEqual(got, want, JSON.stringify(input));
  }
});

test('event date parsing: rejected (order is held instead of guessed)', () => {
  for (const bad of ['', 'TBD', 'next summer', 'June 6', '6/6', '2/30/2027', '2/29/2027', '13/13/2026',
    '0/5/2026', '6/6/1999', 'June 31 2027', 'Octember 3 2026', '2027-13-01']) {
    assert.strictEqual(F.parseEventDateParts_(bad), null, JSON.stringify(bad));
  }
});

test('past event dates (more than a week ago) are flagged; recent and future are not', () => {
  const now = new Date(2026, 9, 5, 15, 0);
  assert.strictEqual(F.isPastEventDate_(new Date(2025, 10, 15), now), true);   // typo'd year
  assert.strictEqual(F.isPastEventDate_(new Date(2026, 8, 27), now), true);    // 8 days ago
  assert.strictEqual(F.isPastEventDate_(new Date(2026, 8, 28), now), false);   // 7 days ago
  assert.strictEqual(F.isPastEventDate_(new Date(2026, 9, 5), now), false);    // today
  assert.strictEqual(F.isPastEventDate_(new Date(2026, 10, 15), now), false);  // future
});

test('parseEventDate_ gives local midnight that formats back to the same day', () => {
  assert.strictEqual(F.fmtISO_(F.parseEventDate_('June 6, 2027')), '2027-06-06');
  assert.strictEqual(F.fmtLong_(F.parseEventDate_('6/6/27')), 'June 6, 2027');
});

const LINK = 'plink_live';
const ev = (type, s) => ({ id: 'evt_x', type, data: { object: Object.assign({ id: 'cs_1', payment_link: LINK, status: 'complete' }, s) } });
test('Stripe event routing', () => {
  const c = (e) => F.classifyEvent_(e, LINK).action;
  assert.strictEqual(c(ev('checkout.session.completed', { payment_status: 'paid' })), 'fulfill');
  assert.strictEqual(c(ev('checkout.session.completed', { payment_status: 'no_payment_required' })), 'fulfill', '100% promo');
  assert.strictEqual(c(ev('checkout.session.completed', { payment_status: 'unpaid' })), 'wait', 'delayed method');
  assert.strictEqual(c(ev('checkout.session.async_payment_succeeded', { payment_status: 'paid' })), 'fulfill');
  assert.strictEqual(c(ev('checkout.session.async_payment_failed', { payment_status: 'unpaid' })), 'ignore');
  assert.strictEqual(c(ev('checkout.session.completed', { payment_status: 'paid', payment_link: 'plink_other' })), 'ignore');
  assert.strictEqual(c(ev('checkout.session.completed', { payment_status: 'paid', status: 'open' })), 'ignore');
  assert.strictEqual(c(ev('charge.refunded', {})), 'ignore');
  assert.strictEqual(c({}), 'ignore');
});

test('extractOrder_: fields, held-order flags, sanitised reference id', () => {
  const s = (ref, fields) => ({ id: 'cs_1', client_reference_id: ref, customer_details: { email: 'a@b.co' },
    custom_fields: fields || [{ key: 'event_name', text: { value: ' Emma & Jake ' } }, { key: 'event_date', text: { value: 'June 6, 2027' } }] });
  let o = F.extractOrder_(s('wedding_blush'));
  assert.strictEqual(o.eventName, 'Emma & Jake'); assert.ok(o.eventNameProvided);
  assert.strictEqual(F.fmtISO_(o.eventDate), '2027-06-06'); assert.strictEqual(o.type, 'wedding'); assert.strictEqual(o.theme, 'blush');
  assert.strictEqual(o.albumEmail, 'a@b.co');
  o = F.extractOrder_(s('wedding_c8e6a8a')); assert.strictEqual(o.theme, 'custom'); assert.strictEqual(o.accentHex, '8E6A8A');
  o = F.extractOrder_(s('<script>_neon')); assert.strictEqual(o.type, 'event'); assert.strictEqual(o.theme, 'gold');
  o = F.extractOrder_(s(null, [{ key: 'event_date', text: { value: 'sometime in June' } }]));
  assert.strictEqual(o.eventDate, null); assert.strictEqual(o.eventNameProvided, false); assert.strictEqual(o.eventDateRaw, 'sometime in June');
});

test('Sheet values: text dates, Date objects and checkbox text all normalise', () => {
  assert.strictEqual(F.cellIso_('2026-10-15'), '2026-10-15');
  assert.strictEqual(F.cellIso_("'2026-10-15"), '2026-10-15');
  assert.strictEqual(F.cellIso_(new Date(2026, 9, 15)), '2026-10-15'); // what Sheets hands back after auto-converting
  assert.strictEqual(F.cellIso_(''), '');
  assert.strictEqual(F.asText_('2026-10-15'), "'2026-10-15");
  assert.ok(F.cellTrue_(true) && F.cellTrue_('TRUE') && !F.cellTrue_(false) && !F.cellTrue_('FALSE') && !F.cellTrue_(''));
  // The old reader: a Date cell + 'T00:00:00' is an Invalid Date, so follow-ups never fired.
  assert.ok(isNaN(new Date(new Date(2026, 9, 15) + 'T00:00:00').getTime()));
});

test('follow-ups fire on or after their day, once', () => {
  const close = '2026-10-15'; // handoff 10-16, last chance 12-10, delete 12-14
  let d = F.dueFollowUps_(close, '2026-10-15', false, false);
  assert.deepStrictEqual([d.handoff, d.lastChance], [false, false]);
  d = F.dueFollowUps_(close, '2026-10-16', false, false); assert.ok(d.handoff && !d.lastChance);
  d = F.dueFollowUps_(close, '2026-10-18', false, false); assert.ok(d.handoff, 'missed days still fire');
  d = F.dueFollowUps_(close, '2026-10-18', true, false); assert.ok(!d.handoff, 'not twice');
  d = F.dueFollowUps_(close, '2026-12-10', true, false); assert.ok(d.lastChance);
  assert.strictEqual(d.deleteDate, '2026-12-14');
  assert.strictEqual(F.dueFollowUps_(new Date(2026, 9, 15), '2026-10-16', false, false).handoff, true, 'Date cell');
  assert.strictEqual(F.dueFollowUps_('', '2026-10-16', false, false), null);
});

test('no follow-ups on or after the delete date (close + 60), even if never sent', () => {
  const close = '2026-10-15'; // delete 12-14
  let d = F.dueFollowUps_(close, '2026-12-13', false, false);
  assert.ok(d.handoff && d.lastChance && !d.expired, 'day before delete: overdue ones still go out');
  d = F.dueFollowUps_(close, '2026-12-14', false, false);
  assert.ok(!d.handoff && !d.lastChance && d.expired, 'delete day');
  d = F.dueFollowUps_('2026-01-01', '2026-10-03', false, false);
  assert.ok(!d.handoff && !d.lastChance && d.expired, 'long-past row');
  d = F.dueFollowUps_(close, '2026-11-20', false, false);
  assert.ok(d.handoff && !d.lastChance, 'handoff a month late but before delete date: still sent');
});

test('releaseHeldOrders: one bad row does not block the others; owner is emailed', () => {
  const H = load(['apps-script-fulfillment/Code.gs', 'apps-script-fulfillment/Fulfillment.gs',
    'apps-script-fulfillment/Sheet.gs', 'apps-script-fulfillment/Digest.gs'], {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'OWNER_EMAIL' ? 'owner@example.com' : null) }) },
    MailApp: { sendEmail(to, subject, body) { mails.push({ to, subject, body }); } },
  });
  const mails = [];
  const hdr = H.HELD_HEADERS;
  const mk = (sid, name, fixedDate, json, status) => hdr.map((h) => ({ sessionId: sid, eventName: name,
    fixedEventDate: fixedDate, fixedEventName: '', status: status || 'held', orderJson: json })[h] || '');
  const order = (sid, name) => JSON.stringify({ sessionId: sid, eventName: name, eventNameProvided: true });
  const rows = [
    mk('cs_a', 'A', '2027-06-06', order('cs_a', 'A')),
    mk('cs_bad', 'Broken', '2027-06-07', '{not json'),
    mk('cs_boom', 'Boom', '2027-06-08', order('cs_boom', 'Boom')),
    mk('cs_c', 'C', '2027-06-09', order('cs_c', 'C')),
    mk('cs_wait', 'Wait', '', order('cs_wait', 'Wait')),
    mk('cs_done', 'Done', '2027-06-10', order('cs_done', 'Done'), 'released 2026-10-01'),
  ];
  const statusCol = hdr.indexOf('status') + 1;
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange(r, c, n, m) {
      if (n !== undefined) return { getValues: () => rows.slice(r - 2, r - 2 + n) };
      assert.strictEqual(c, statusCol);
      return { setValue: (v) => { rows[r - 2][c - 1] = v; } };
    },
  };
  H.getHeldSheet_ = () => sheet;
  H.isAlreadyFulfilled_ = () => false;
  const fulfilled = [];
  H.fulfillOrder_ = (o) => { if (o.sessionId === 'cs_boom') throw new Error('Drive hiccup'); fulfilled.push(o.sessionId + ':' + H.fmtISO_(o.eventDate)); };
  assert.strictEqual(H.releaseHeldOrders(), 2);
  assert.deepStrictEqual(fulfilled, ['cs_a:2027-06-06', 'cs_c:2027-06-09']);
  const status = (i) => rows[i][statusCol - 1];
  assert.ok(/^released /.test(status(0)) && /^released /.test(status(3)));
  assert.ok(/^error: /.test(status(1)) && /^error: Drive hiccup/.test(status(2)));
  assert.strictEqual(status(4), 'held', 'no fixed date yet: left alone');
  assert.strictEqual(mails.length, 1);
  assert.ok(/2 held order/.test(mails[0].subject) && /cs_bad/.test(mails[0].body) && /cs_boom/.test(mails[0].body));
});

test('other payment links (e.g. PackLocker) are ignored quietly; other ignores still email the owner', () => {
  const mails = [];
  const H = load(['apps-script-fulfillment/Code.gs', 'apps-script-fulfillment/Fulfillment.gs',
    'apps-script-fulfillment/Sheet.gs', 'apps-script-fulfillment/Digest.gs'], {
    console: { log() {}, error: console.error },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'OWNER_EMAIL' ? 'owner@example.com' : null) }) },
    MailApp: { sendEmail(to, subject, body) { mails.push({ to, subject, body }); } },
  });
  const cfg = { PAYMENT_LINK_ID: LINK };
  const packLocker = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
  for (const type of packLocker) {
    const r = H.handleStripeEvent_(ev(type, { payment_status: 'paid', payment_link: 'plink_packlocker' }), cfg);
    assert.ok(r.ok && /different payment link/.test(r.ignored), type);
  }
  const r2 = H.handleStripeEvent_(ev('checkout.session.completed', { payment_status: 'paid', payment_link: null }), cfg);
  assert.ok(r2.ok && r2.ignored, 'checkout without a payment link (API/test event)');
  assert.strictEqual(mails.length, 0, 'no owner email for other-link events');
  assert.strictEqual(F.classifyEvent_(ev('checkout.session.completed', { payment_status: 'paid' }), LINK).quiet, undefined);

  const loud = [
    ev('checkout.session.async_payment_failed', { payment_status: 'unpaid' }),
    ev('checkout.session.completed', { payment_status: 'unpaid' }),
    ev('checkout.session.completed', { payment_status: 'paid', status: 'open' }),
    ev('charge.refunded', {}),
  ];
  for (const e of loud) assert.ok(H.handleStripeEvent_(e, cfg).ok);
  assert.strictEqual(mails.length, loud.length, 'every other ignored reason still emails the owner');
  assert.ok(mails.every((m) => m.to === 'owner@example.com' && /not fulfilled/.test(m.subject)));
});

test('logRowIndex_ on a header-only sheet returns -1 instead of throwing', () => {
  // Fake sheet that behaves like Apps Script: zero-row ranges throw.
  const sheet = {
    rows: [['sessionId']],
    getLastRow() { return this.rows.length; },
    getRange(r, c, n) {
      if (n < 1) throw new Error('The number of rows in the range must be at least 1.');
      return { getValues: () => sheet.rows.slice(r - 1, r - 1 + n).map((x) => [x[0]]) };
    },
  };
  const G = load(['apps-script-fulfillment/Code.gs', 'apps-script-fulfillment/Sheet.gs']);
  G.getLogSheet_ = () => sheet;
  assert.strictEqual(G.logRowIndex_('cs_1'), -1);
  sheet.rows.push(['cs_1']);
  assert.strictEqual(G.logRowIndex_('cs_1'), 2);
});

test('guest URL carries the same name= the printed sign uses', () => {
  const G = load(['apps-script-fulfillment/Code.gs', 'apps-script-fulfillment/Fulfillment.gs'],
    { PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GUEST_SCRIPT_EXEC_URL: 'https://script.google.com/macros/s/AKfyc/exec' })[k] || null }) } });
  const url = new URL(G.buildGuestUrl_({ eventName: 'Emma & Jake', type: 'wedding', theme: 'gold' }, 'FOLDER', new Date(2027, 6, 6)));
  assert.strictEqual(url.searchParams.get('name'), 'Emma & Jake');
  assert.strictEqual(url.searchParams.get('event'), 'emma-and-jake');
  assert.strictEqual(url.searchParams.get('until'), '2027-07-06');
});

// ── guest upload script ──
const U = load(['apps-script/Code.gs']);
const bytes = (arr) => arr.map((b) => (b > 127 ? b - 256 : b)); // Apps Script byte[] is signed
const ascii = (s) => Array.from(s).map((ch) => ch.charCodeAt(0));
test('upload magic-byte check', () => {
  const pad = new Array(16).fill(0);
  assert.strictEqual(U.sniffImage_(bytes([0xFF, 0xD8, 0xFF, 0xE0].concat(pad))).mime, 'image/jpeg');
  assert.strictEqual(U.sniffImage_(bytes([0x89].concat(ascii('PNG\r\n'), pad))).mime, 'image/png');
  assert.strictEqual(U.sniffImage_(bytes(ascii('RIFF\0\0\0\0WEBPVP8 '))).mime, 'image/webp');
  assert.strictEqual(U.sniffImage_(bytes([0, 0, 0, 0x18].concat(ascii('ftypheic'), pad))).mime, 'image/heic');
  assert.strictEqual(U.sniffImage_(bytes(ascii('<html><script>alert(1)</script>'))), null);
  assert.strictEqual(U.sniffImage_(bytes(ascii('MZ\x90\0\x03\0\0\0\x04\0\0\0'))), null);
  assert.strictEqual(U.sniffImage_(bytes([0xFF, 0xD8])), null);
});

test('server-side close never earlier than the guest page', () => {
  assert.strictEqual(U.isPastClose_('2026-10-15', new Date('2026-10-16T05:00:00Z')), false, 'still the 15th in Chicago');
  assert.strictEqual(U.isPastClose_('2026-10-15', new Date('2026-10-16T11:59:00Z')), false, 'still the 15th at UTC-12');
  assert.strictEqual(U.isPastClose_('2026-10-15', new Date('2026-10-16T12:00:00Z')), true);
  assert.strictEqual(U.isPastClose_('', new Date()), false);
});

test('guest allowlist: log Sheet close dates, EXTRA_FOLDERS overrides with a date only', () => {
  const props = { LOG_SHEET_ID: 'SHEET', EXTRA_FOLDERS: 'LOGGED_A=2026-12-31, HANDMADE\nLOGGED_B , HANDMADE2=2026-11-01' };
  const sheetRows = [['sessionId', 'folderId', 'closeDate'], ['cs1', 'LOGGED_A', '2026-10-15'], ['cs2', 'LOGGED_B', "'2026-10-20"], ['cs3', 'LOGGED_C', new Date(2026, 9, 25)]];
  const store = {};
  const A = load(['apps-script/Code.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    CacheService: { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'America/Chicago' },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [{
      getLastRow: () => sheetRows.length, getLastColumn: () => 3,
      getRange: (r, c, n) => ({ getValues: () => sheetRows.slice(r - 1, r - 1 + n) }),
    }] }) },
  });
  const look = (id) => JSON.parse(JSON.stringify(A.lookupFolder_(id)));
  assert.deepStrictEqual(look('LOGGED_A'), { configured: true, found: true, closeDate: '2026-12-31' }, 'dated EXTRA entry overrides the Sheet');
  assert.deepStrictEqual(look('LOGGED_B'), { configured: true, found: true, closeDate: '2026-10-20' }, 'bare EXTRA entry keeps the Sheet date');
  assert.deepStrictEqual(look('LOGGED_C'), { configured: true, found: true, closeDate: '2026-10-25' }, 'Date cell');
  assert.deepStrictEqual(look('HANDMADE'), { configured: true, found: true, closeDate: '' });
  assert.deepStrictEqual(look('HANDMADE2'), { configured: true, found: true, closeDate: '2026-11-01' });
  assert.deepStrictEqual(look('RANDOM'), { configured: true, found: false });
  props.LOG_SHEET_ID = ''; props.EXTRA_FOLDERS = '';
  assert.deepStrictEqual(look('ANY'), { configured: false }, 'unconfigured = old open behaviour');
});

// ── drop.html script URL allowlist ──
test('drop.html only sends photos to Apps Script URLs', () => {
  const html = fs.readFileSync(path.join(root, 'keepsakedrop-site/drop.html'), 'utf8');
  const src = html.match(/function isAllowedScriptUrl\(u\) \{[\s\S]*?\n\}/)[0];
  const ok = vm.runInNewContext(src + '; isAllowedScriptUrl', { URL });
  assert.ok(ok('https://script.google.com/macros/s/AKfycbwYabc_-123/exec'));
  assert.ok(ok('https://script.google.com/a/macros/asherarcade.com/s/AKfycb123/exec'));
  assert.ok(ok('demo'));
  for (const bad of ['https://evil.example/exec', 'http://script.google.com/macros/s/AK/exec',
    'https://script.google.com.evil.example/macros/s/AK/exec', 'https://script.google.com/macros/s/AK/dev',
    'javascript:alert(1)', 'https://evil.example/?https://script.google.com/macros/s/AK/exec']) {
    assert.ok(!ok(bad), bad);
  }
});

console.log(`${passed} test groups passed${process.exitCode ? ' (with failures above)' : ''}`);
