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
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'server_error' });
  }
}

/* ---------- names + scoring: keep in step with trivia.html ---------- */

function cleanName_(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
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
  var base = PropertiesService.getScriptProperties().getProperty('GAMES_BASE_URL') || DEFAULT_GAMES_BASE_URL;
  var res = UrlFetchApp.fetch(base + id + '.json', { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;
  var c;
  try { c = JSON.parse(res.getContentText()); } catch (err) { return null; }
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
    clean.push({ c: c, ms: Math.round(Math.max(0, Math.min(limit, ms))) });
  }
  return withLock_(function () {
    var sh = tab_(id, false), rows = rows_(sh), at = -1;
    for (var j = 0; j < rows.length; j++) if (rows[j][COL.device] === device) at = j;
    if (at < 0) return { ok: false, error: 'not_started' };
    var row = rows[at];
    if (!row[COL.finished]) {
      // No closing check here: someone who started before the game closed
      // still gets their score posted. New players are turned away in start.
      var score = 0, right = 0, total = 0;
      clean.forEach(function (a, k) {
        var ok = a.c === game.key[k].correct;
        if (ok) right++;
        score += pointsFor_(ok, a.ms, game.secs);
        total += a.ms;
      });
      row[COL.finished] = new Date();
      row[COL.score] = score;
      row[COL.right] = right;
      row[COL.avg] = Math.round(total / clean.length / 100) / 10;
      row[COL.answers] = JSON.stringify(clean);
      sh.getRange(at + 2, 1, 1, HEADERS.length).setValues([row]);
      CacheService.getScriptCache().remove('board:' + id);
    }
    var list = ranked_(rows);
    var rank = list.indexOf(row) + 1;
    return { ok: true, score: Number(row[COL.score]), right: Number(row[COL.right]), rank: rank || list.length, count: list.length };
  });
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
