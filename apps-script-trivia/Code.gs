/**
 * Asher Arcade Trivia: leaderboard + one-try-per-person backend.
 *
 * One deployment serves every trivia game. Each game is a JSON file at
 * GAMES_BASE_URL + <id> + '.json' (trivia/games/<id>.json on the site), and
 * each game gets its own tab in the "Asher Arcade Trivia Scores" Sheet.
 *
 * The script reads the answer key from the game's JSON and scores every
 * player itself, so nobody can post a made-up score. See README.md.
 *
 * API (all responses are JSON):
 *   GET  ?action=board&game=<id>                         -> { ok, count, players:[{name,score,right}] }
 *   POST {action:'start',  game, name, device}           -> { ok } | { ok:false, error }
 *   POST {action:'finish', game, name, device, answers}  -> { ok, score, right, rank, count } | { ok:false, error }
 *   answers = [{ c: original answer index or -1, ms: time taken }, ...] one per question
 *
 * Errors: unknown_game, closed, bad_name, name_taken, already_played,
 *         not_started, bad_answers, full, busy, server_error
 */

var DEFAULT_GAMES_BASE_URL = 'https://www.asherarcade.com/trivia/games/';
var MAX_PLAYERS_PER_GAME = 1000;
var BOARD_SIZE = 100;
var HEADERS = ['Name', 'NameKey', 'Device', 'Started', 'Finished', 'Score', 'Right', 'AvgSeconds', 'Answers', 'Hide (type x)'];
var COL = { name: 0, key: 1, device: 2, started: 3, finished: 4, score: 5, right: 6, avg: 7, answers: 8, hide: 9 };

/* ---------- entry points ---------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'board') return json_(board_(String(p.game || '')));
    if (p.action === 'game') return json_(servedGame_(String(p.game || '')));
    return json_({ ok: true, service: 'asher-arcade-trivia' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'start') return json_(start_(body));
    if (body.action === 'finish') return json_(finish_(body));
    if (body.action === 'session') return json_(session_(body));
    if (body.action === 'build') return json_(build_(body));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'server_error' });
  }
}

/* ---------- names + scoring: keep in step with trivia.html ---------- */

function cleanName_(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}
function nameKey_(s) {
  return cleanName_(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
// A right answer is worth 500 to 1,000: 1,000 the instant the answers appear,
// down to 500 at the buzzer. Wrong or no answer is 0.
function pointsFor_(isRight, ms, secs) {
  if (!isRight) return 0;
  var f = Math.max(0, Math.min(1, ms / (secs * 1000)));
  return Math.round(1000 - 500 * f);
}

/* ---------- game config ---------- */

function getGame_(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return null;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('game:' + id);
  if (hit) return JSON.parse(hit);
  var c = builtGame_(id);
  if (c === false) return null;   // built here but not ready to play yet
  if (!c) {
    var base = PropertiesService.getScriptProperties().getProperty('GAMES_BASE_URL') || DEFAULT_GAMES_BASE_URL;
    var res = UrlFetchApp.fetch(base + id + '.json', { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    try { c = JSON.parse(res.getContentText()); } catch (err) { return null; }
  }
  if (!c || !Array.isArray(c.questions) || !c.questions.length) return null;
  var key = [];
  for (var i = 0; i < c.questions.length; i++) {
    var q = c.questions[i];
    var ok = q && typeof q.q === 'string' && Array.isArray(q.answers) && q.answers.length >= 2 &&
      q.answers.length <= 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.answers.length;
    if (!ok) return null;
    key.push({ correct: q.correct, n: q.answers.length });
  }
  var game = {
    id: id,
    key: key,
    secs: Math.max(5, Math.min(60, Number(c.secondsPerQuestion) || 20)),
    closesAt: c.closesAt || ''
  };
  cache.put('game:' + id, JSON.stringify(game), 600);
  return game;
}

function isClosed_(game, now) {
  if (!game.closesAt) return false;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(game.closesAt);
  if (!m) return false;
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  return today > game.closesAt;
}

/* ---------- sheet ---------- */

function spreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create('Asher Arcade Trivia Scores');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
function tab_(id, create) {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(id);
  if (!sh && create) {
    sh = ss.insertSheet(id);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function rows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues();
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { return fn(); } finally { lock.releaseLock(); }
}
function ranked_(rows) {
  return rows.filter(function (r) { return r[COL.finished] && !String(r[COL.hide]).trim(); })
    .sort(function (a, b) {
      return (b[COL.score] - a[COL.score]) || (new Date(a[COL.finished]) - new Date(b[COL.finished]));
    });
}

/* ---------- actions ---------- */

function board_(id) {
  var game = getGame_(id);
  if (!game) return { ok: false, error: 'unknown_game' };
  var cache = CacheService.getScriptCache();
  var hit = cache.get('board:' + id);
  if (hit) return JSON.parse(hit);
  var list = ranked_(rows_(tab_(id, false)));
  var out = {
    ok: true,
    count: list.length,
    players: list.slice(0, BOARD_SIZE).map(function (r) {
      return { name: String(r[COL.name]), score: Number(r[COL.score]), right: Number(r[COL.right]) };
    })
  };
  cache.put('board:' + id, JSON.stringify(out), 5);
  return out;
}

function start_(b) {
  var id = String(b.game || '');
  var game = getGame_(id);
  if (!game) return { ok: false, error: 'unknown_game' };
  if (isClosed_(game, new Date())) return { ok: false, error: 'closed' };
  var name = cleanName_(b.name), key = nameKey_(b.name), device = String(b.device || '').slice(0, 64);
  if (name.length < 2 || !key) return { ok: false, error: 'bad_name' };
  if (device.length < 8) return { ok: false, error: 'bad_device' };
  return withLock_(function () {
    var sh = tab_(id, true), rows = rows_(sh);
    var mineAt = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][COL.device] === device) mineAt = i;
    }
    if (mineAt >= 0 && rows[mineAt][COL.finished]) return { ok: false, error: 'already_played' };
    for (var j = 0; j < rows.length; j++) {
      if (rows[j][COL.key] === key && rows[j][COL.device] !== device) return { ok: false, error: 'name_taken' };
    }
    if (mineAt >= 0) {
      // Same phone came back before finishing (reload, typo in name): keep its seat.
      sh.getRange(mineAt + 2, 1, 1, 2).setValues([[name, key]]);
      return { ok: true };
    }
    if (rows.length >= MAX_PLAYERS_PER_GAME) return { ok: false, error: 'full' };
    sh.appendRow([name, key, device, new Date(), '', '', '', '', '', '']);
    return { ok: true };
  });
}

function finish_(b) {
  var id = String(b.game || '');
  var game = getGame_(id);
  if (!game) return { ok: false, error: 'unknown_game' };
  var device = String(b.device || '').slice(0, 64);
  var answers = b.answers;
  if (!Array.isArray(answers) || answers.length !== game.key.length) return { ok: false, error: 'bad_answers' };
  var limit = game.secs * 1000, clean = [];
  for (var i = 0; i < answers.length; i++) {
    var a = answers[i] || {};
    var c = Number(a.c), ms = Number(a.ms);
    if (!Number.isInteger(c) || c < -1 || c >= game.key[i].n) return { ok: false, error: 'bad_answers' };
    if (!isFinite(ms)) return { ok: false, error: 'bad_answers' };
    var item = { c: c, ms: Math.round(Math.max(0, Math.min(limit, ms))) };
    if (a.x) { item = { c: -1, ms: 0, x: 1 }; }   // not in this player's set (question pools)
    clean.push(item);
  }
  return withLock_(function () {
    var sh = tab_(id, false), rows = rows_(sh), at = -1;
    for (var j = 0; j < rows.length; j++) if (rows[j][COL.device] === device) at = j;
    if (at < 0) return { ok: false, error: 'not_started' };
    var row = rows[at];
    if (!row[COL.finished]) {
      // No closing check here: someone who started before the game closed
      // still gets their score posted. New players are turned away in start.
      var score = 0, right = 0, total = 0, asked = 0;
      clean.forEach(function (a, k) {
        if (a.x) return;
        var ok = a.c === game.key[k].correct;
        if (ok) right++;
        score += pointsFor_(ok, a.ms, game.secs);
        total += a.ms; asked++;
      });
      row[COL.finished] = new Date();
      row[COL.score] = score;
      row[COL.right] = right;
      row[COL.avg] = Math.round(total / Math.max(1, asked) / 100) / 10;
      row[COL.answers] = JSON.stringify(clean);
      sh.getRange(at + 2, 1, 1, HEADERS.length).setValues([row]);
      CacheService.getScriptCache().remove('board:' + id);
    }
    var list = ranked_(rows);
    var rank = list.indexOf(row) + 1;
    return { ok: true, score: Number(row[COL.score]), right: Number(row[COL.right]), rank: rank || list.length, count: list.length };
  });
}

/* ---------- customer-built games: pay first, then build ----------
 *
 * Stripe sends the customer to trivia-build.html?session_id=cs_... after paying.
 *   POST {action:'session', session}              -> { ok, order, email, gameId, status, game }
 *   POST {action:'build', session, game, photo}   -> { ok, gameId, status:'live'|'writing', game }
 *   GET  ?action=game&game=<id>                   -> the full game (trivia.html loads it from here)
 * Missing wrong answers are written by Claude. If that fails, the game waits as
 * 'writing' and sweep() (every 10 minutes, see setupBuilder) tries again.
 *
 * Script Properties: STRIPE_KEY (restricted key, Checkout Sessions: Read),
 * ANTHROPIC_API_KEY, optional CLAUDE_MODEL, OWNER_EMAIL.
 */
var TRIVIA_PAYMENT_LINK = 'plink_1UOU5DRyTAXcMvg40XFeF5Bt';
var SITE_URL = 'https://www.asherarcade.com/';
var DEFAULT_MODEL = 'claude-haiku-5-5';
var MAX_PHOTO_CHARS = 400000;

function props_() { return PropertiesService.getScriptProperties(); }
function readRec_(k) { var v = props_().getProperty(k); return v ? JSON.parse(v) : null; }
function writeRec_(k, v) { props_().setProperty(k, JSON.stringify(v)); }
function owner_() { return props_().getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail(); }

/** The paid Stripe Checkout Session, or null. Checked once with Stripe, then remembered. */
function paidSession_(sid) {
  sid = String(sid || '');
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sid)) return null;
  var rec = readRec_('s_' + sid);
  if (rec) return rec;
  var key = props_().getProperty('STRIPE_KEY');
  if (!key) throw new Error('STRIPE_KEY is not set in Script Properties');
  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sid),
    { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    console.warn('stripe ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    return null;
  }
  var st = JSON.parse(res.getContentText());
  var paid = st.status === 'complete' && (st.payment_status === 'paid' || st.payment_status === 'no_payment_required');
  if (!paid || st.payment_link !== TRIVIA_PAYMENT_LINK) { console.warn('session not a paid trivia order: ' + sid); return null; }
  var cd = st.customer_details || {};
  rec = {
    sid: sid,
    order: /^AA-\d{6}-[A-Z0-9]{4}$/.test(st.client_reference_id || '') ? st.client_reference_id : '',
    email: String(cd.email || ''), name: String(cd.name || ''), game: '', t: Date.now()
  };
  writeRec_('s_' + sid, rec);
  try {
    if (rec.email) MailApp.sendEmail(rec.email, 'Build your trivia game',
      'Thanks for your order' + (rec.order ? ' (' + rec.order + ')' : '') + '!\n\n' +
      'Add the photo, colors and 20 questions here. You can come back to this link any time:\n' +
      SITE_URL + 'trivia-build.html?session_id=' + sid + '\n\n' +
      'Your game goes live the moment you finish, and we email you the link to share.\n\nAsher Arcade',
      { name: 'Asher Arcade', replyTo: owner_() });
  } catch (e) { console.error('build link mail: ' + e); }
  return rec;
}

function session_(b) {
  var rec = paidSession_(b.session);
  if (!rec) return { ok: false, error: 'not_paid' };
  var g = rec.game ? readRec_('g_' + rec.game) : null;
  return { ok: true, order: rec.order, email: rec.email, name: rec.name, gameId: rec.game,
           status: g ? g.status : '', game: g ? loadBuilt_(g) : null };
}

/** Built game from Drive: the game object, false if it isn't playable yet, null if not built here. */
function builtGame_(id) {
  var g = readRec_('g_' + id);
  if (!g) return null;
  if (g.status !== 'live') return false;
  return loadBuilt_(g);
}
function loadBuilt_(g) {
  try { return JSON.parse(DriveApp.getFileById(g.file).getBlob().getDataAsString()); } catch (e) { return null; }
}
function servedGame_(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return { ok: false, error: 'unknown_game' };
  var c = builtGame_(id);
  if (c === false) return { ok: false, error: 'not_ready' };
  if (!c) return { ok: false, error: 'unknown_game' };
  return { ok: true, game: c };
}

function slug_(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'game';
}
function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

/** Checks and tidies what the build page sent. Returns { game } or { error }. */
function cleanBuild_(src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.questions)) return { error: 'bad_game' };
  var honoree = str_(src.honoree, 60);
  if (!honoree) return { error: 'Please add who the game is about.' };
  var hex = /^#[0-9a-fA-F]{6}$/;
  var theme = src.theme || {};
  if (!hex.test(theme.primary || '') || !hex.test(theme.secondary || '')) return { error: 'Please pick two colors.' };
  if (src.questions.length < 5 || src.questions.length > 30) return { error: 'bad_game' };
  var qs = [];
  for (var i = 0; i < src.questions.length; i++) {
    var q = src.questions[i] || {};
    var text = str_(q.q, 200), ans = (Array.isArray(q.answers) ? q.answers : []).map(function (a) { return str_(a, 60); }).filter(Boolean);
    if (!text || !ans.length) return { error: 'Question ' + (i + 1) + ' needs a question and a right answer.' };
    var seen = {};
    ans = ans.filter(function (a) { var k = a.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 4);
    var item = { q: text, answers: ans, correct: 0 };
    var fact = str_(q.fact, 300);
    if (fact) item.fact = fact;
    qs.push(item);
  }
  var first = honoree.split(' ')[0];
  var occasion = /^(graduation|birthday|wedding|shower|anniversary|retirement|custom)$/.test(src.occasion) ? src.occasion : 'custom';
  var eyebrows = { graduation: 'Graduation Party', birthday: 'Happy Birthday, ' + first, wedding: 'Wedding Celebration',
    shower: 'Shower Celebration', anniversary: 'Anniversary Celebration', retirement: 'Retirement Party', custom: 'Party Trivia' };
  return { game: {
    title: 'How Well Do You Know ' + first + '?', honoree: honoree, occasion: occasion,
    eyebrow: str_(src.eyebrow, 50) || eyebrows[occasion], subtitle: 'Think you know ' + first + '? Prove it.',
    theme: { primary: theme.primary, secondary: theme.secondary },
    secondsPerQuestion: 20, shuffleAnswers: true, shuffleQuestions: true, closesAt: '', questions: qs
  } };
}

function gamesFolder_() {
  var id = props_().getProperty('GAMES_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Asher Arcade Trivia Games');
  props_().setProperty('GAMES_FOLDER_ID', f.getId());
  return f;
}

function build_(b) {
  var rec = paidSession_(b.session);
  if (!rec) return { ok: false, error: 'not_paid' };
  var c = cleanBuild_(b.game);
  if (c.error) return { ok: false, error: c.error };
  var game = c.game;
  var photo = String(b.photo || '');
  if (photo && (photo.length > MAX_PHOTO_CHARS || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(photo))) {
    return { ok: false, error: 'That photo did not come through. Please pick it again.' };
  }

  var res = withLock_(function () {
    var id = rec.game, g = id ? readRec_('g_' + id) : null;
    if (g && ranked_(rows_(tab_(id, false))).length) return { ok: false, error: 'locked' };
    if (!id) {
      var base = slug_(game.honoree.split(' ')[0]) + '-' + (rec.order ? rec.order.slice(-4) : rec.sid.slice(-6)).toLowerCase();
      id = base;
      for (var n = 2; readRec_('g_' + id); n++) id = base + '-' + n;
      rec.game = id;
      writeRec_('s_' + rec.sid, rec);
    }
    var old = g ? loadBuilt_(g) : null;
    game.photo = photo || (old && old.photo) || '';
    var file = g && g.file ? DriveApp.getFileById(g.file) : null;
    if (file) file.setContent(JSON.stringify(game));
    else file = gamesFolder_().createFile(id + '.json', JSON.stringify(game), 'application/json');
    g = { sid: rec.sid, file: file.getId(), status: 'writing', tries: 0, mailed: g ? g.mailed : false, order: rec.order };
    writeRec_('g_' + id, g);
    return { ok: true, id: id };
  });
  if (!res.ok) return res;
  var out = finishBuild_(res.id);
  return { ok: true, gameId: res.id, status: out.status, game: out.game };
}

/** Fill in missing wrong answers and go live. Safe to call again; sweep() does. */
function finishBuild_(id) {
  var g = readRec_('g_' + id), game = loadBuilt_(g);
  var missing = game.questions.some(function (q) { return q.answers.length < 4; });
  if (missing) {
    try { fillWrong_(game); } catch (e) { console.warn('wrong answers for ' + id + ': ' + e); }
    DriveApp.getFileById(g.file).setContent(JSON.stringify(game));
  }
  var ready = game.questions.every(function (q) { return q.answers.length === 4; });
  g = readRec_('g_' + id);
  g.status = ready ? 'live' : 'writing';
  if (!ready) g.tries = (g.tries || 0) + 1;
  writeRec_('g_' + id, g);
  CacheService.getScriptCache().remove('game:' + id);
  if (ready && !g.mailed) { mailLive_(id, g, game); g.mailed = true; writeRec_('g_' + id, g); }
  if (!ready && g.tries === 3) {
    try { MailApp.sendEmail(owner_(), 'Trivia game stuck: ' + id, 'Claude could not write the wrong answers for ' + id +
      ' (order ' + g.order + ') after 3 tries. Check ANTHROPIC_API_KEY, or add them by hand in the game file:\n' +
      'https://drive.google.com/file/d/' + g.file + '/view'); } catch (e) {}
  }
  return { status: g.status, game: game };
}

function mailLive_(id, g, game) {
  var link = SITE_URL + 'trivia.html?g=' + id;
  var rec = readRec_('s_' + g.sid) || {};
  try {
    if (rec.email) MailApp.sendEmail(rec.email, game.title + ' is ready!',
      'Your game is live. Send this link to everyone:\n' + link + '\n\n' +
      'Everyone plays on their own phone, once each, and the leaderboard updates live.\n' +
      'Need to change something? Use your build link again (before anyone plays):\n' +
      SITE_URL + 'trivia-build.html?session_id=' + g.sid + '\n\nAsher Arcade',
      { name: 'Asher Arcade', replyTo: owner_() });
    MailApp.sendEmail(owner_(), 'Trivia game live: ' + id, 'Order ' + (g.order || '(none)') + '\n' + link +
      '\nGame file: https://drive.google.com/file/d/' + g.file + '/view');
  } catch (e) { console.error('live mail: ' + e); }
}

/** Ask Claude for the missing wrong answers. Fills game.questions in place. */
function fillWrong_(game) {
  try { askClaude_(game); } finally { fillNumbers_(game); }
}
function askClaude_(game) {
  var key = props_().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  for (var attempt = 0; attempt < 2; attempt++) {
    var need = [];
    game.questions.forEach(function (q, i) { if (q.answers.length < 4) need.push(i); });
    if (!need.length) return;
    var lines = need.map(function (i) {
      var q = game.questions[i];
      return (i + 1) + '. Q: ' + q.q + ' | Right answer: ' + q.answers[0] +
        (q.answers.length > 1 ? ' | Wrong answers already used: ' + q.answers.slice(1).join('; ') : '') +
        ' | Write ' + (4 - q.answers.length);
    });
    var prompt = 'You write the wrong answers for a multiple-choice party trivia game called "' + game.title +
      '". Friends and family guess facts about ' + game.honoree + ' (occasion: ' + game.occasion + ').\n\n' +
      'For each question, write exactly the number of wrong answers asked for. Each one must:\n' +
      '- be a believable answer for this person, the same kind of thing as the right answer (a number for a number, a brand for a brand, a place for a place), similar in length and style\n' +
      '- be clearly different from the right answer and the other answers\n' +
      '- be 3 words or fewer\n' +
      '- be playful only if the question itself is a joke; never mean, crude or sensitive\n\n' +
      lines.join('\n') + '\n\nReply with only a JSON object mapping each question number to its list of wrong answers, like {"3": ["A", "B"]}.';
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: props_().getProperty('CLAUDE_MODEL') || DEFAULT_MODEL, max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }] })
    });
    if (res.getResponseCode() !== 200) throw new Error('claude ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    var text = (JSON.parse(res.getContentText()).content || []).map(function (p) { return p.text || ''; }).join('');
    var m = text.match(/\{[\s\S]*\}/), got;
    try { got = m ? JSON.parse(m[0]) : {}; } catch (e) { got = {}; }
    need.forEach(function (i) {
      var q = game.questions[i], list = Array.isArray(got[i + 1]) ? got[i + 1] : [];
      list.forEach(function (w) {
        w = str_(w, 40);
        if (!w || w.split(' ').length > 4 || q.answers.length >= 4) return;
        if (q.answers.some(function (a) { return a.toLowerCase() === w.toLowerCase(); })) return;
        q.answers.push(w);
      });
    });
  }
}
// Numbers never need AI: nearby numbers make good wrong answers.
function fillNumbers_(game) {
  game.questions.forEach(function (q) {
    var n = /^\d{1,4}$/.test(q.answers[0]) ? Number(q.answers[0]) : null;
    if (n === null) return;
    [1, -1, 2, -2, 3, 5].forEach(function (d) {
      var v = String(n + d);
      if (q.answers.length < 4 && n + d >= 0 && q.answers.indexOf(v) < 0) q.answers.push(v);
    });
  });
}

/** Every 10 minutes: retry games still waiting on wrong answers. */
function sweep() {
  var all = props_().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('g_') !== 0) return;
    var g = JSON.parse(all[k]);
    if (g.status === 'writing' && (g.tries || 0) < 12) {
      try { finishBuild_(k.slice(2)); } catch (e) { console.error('sweep ' + k + ': ' + e); }
    }
  });
}

/** Run once from the editor: approves Drive + email + Stripe/Claude fetches and starts the 10-minute check. */
function setupBuilder() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sweep') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sweep').timeBased().everyMinutes(10).create();
  console.log('Games folder: ' + gamesFolder_().getUrl());
  console.log('STRIPE_KEY set: ' + !!props_().getProperty('STRIPE_KEY') + ', ANTHROPIC_API_KEY set: ' + !!props_().getProperty('ANTHROPIC_API_KEY'));
  if (props_().getProperty('ANTHROPIC_API_KEY')) {
    var t = { title: 'Test', honoree: 'Test Person', occasion: 'birthday', questions: [{ q: 'What is their favorite color?', answers: ['Blue'], correct: 0 }] };
    fillWrong_(t);
    console.log('Claude test: ' + t.questions[0].answers.join(', '));
  }
}

/* ---------- helpers ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: creates the Sheet and checks the demo game loads. */
function setup() {
  var ss = spreadsheet_();
  console.log('Scores Sheet: ' + ss.getUrl());
  console.log('Demo game loads: ' + !!getGame_('demo'));
}
