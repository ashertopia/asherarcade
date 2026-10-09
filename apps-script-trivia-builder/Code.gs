/**
 * Asher Arcade Trivia Builder: a Google Sheet that turns a trivia order into
 * a finished game file, with Gemini's =AI() function writing the wrong answers
 * the customer left blank.
 *
 * Questions tab:  A Question | B Right answer | C Wrong: close | D Wrong: opposite | E Wrong: funny | F Story
 * Game tab:       game id, name, occasion, colors, photo, leaderboard URL, closing date
 *
 * Menu (Asher Arcade):
 *   Load an order          paste the link to "<order id> trivia game.json" from the order's Drive folder
 *   Fill blanks with AI    puts an =AI() formula in every empty wrong-answer cell
 *   Make game file         checks every row and saves "<game id>.json" to Drive
 *
 * Wrong answers the customer typed fill C, then D, then E, in order. Only the
 * blanks after them get AI formulas. =AI() cells do not update on their own:
 * select them and click Generate (or Refresh) in Sheets. See README.md.
 */

var QUESTION_ROWS = 20;
var HEADERS = ['Question', 'Right answer', 'Wrong: close', 'Wrong: opposite', 'Wrong: funny', 'Story (optional)'];
var LIMIT = ' Reply with the answer only, 3 words or less, no quotes or punctuation at the end.';
var PROMPTS = [
  'This is a trivia question and its right answer. Write a believable WRONG answer that differs from the right answer in one small detail.' + LIMIT,
  'This is a trivia question and its right answer. Write a WRONG answer that is the opposite of the right answer but could still be true for someone.' + LIMIT,
  'This is a trivia question and its right answer. Write a funny, slightly ridiculous WRONG answer that is still possible.' + LIMIT
];
var SETTINGS = [
  ['Game id', 'Short, lowercase, dashes. Goes in the link: trivia.html?g=<id>'],
  ['Their name', 'First and last name'],
  ['Occasion', 'graduation, birthday, wedding, shower, anniversary, retirement or custom'],
  ['Title', 'Blank = "How Well Do You Know <first name>?"'],
  ['Small label above title', 'e.g. Class of 2026 · Graduation Party'],
  ['Main color', 'Hex, e.g. #0b1f4b'],
  ['Second color', 'Hex, e.g. #ffd200'],
  ['Photo (Drive link)', 'Link to their photo in Drive. Filled in when you load an order.'],
  ['Leaderboard URL', 'The trivia leaderboard /exec URL (apps-script-trivia). Saved for next time.'],
  ['Closes on', 'Optional, YYYY-MM-DD. New players are turned away after this day.'],
  ['Order folder', 'Filled in when you load an order. The game file is saved here.']
];

/* ---------- menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Asher Arcade')
    .addItem('Load an order', 'loadOrder')
    .addItem('Fill blank wrong answers with AI', 'fillBlanks')
    .addItem('Make game file', 'makeGameFile')
    .addSeparator()
    .addItem('Start a new game (clear the sheet)', 'resetSheet')
    .addToUi();
}

/* ---------- pure helpers (tested in test.js) ---------- */

function aiFormula_(col, row) {
  return '=AI("' + PROMPTS[col].replace(/"/g, '""') + '", A' + row + ':B' + row + ')';
}

/** Rows for the Questions tab from an order's game file. Given wrong answers first, AI formulas after. */
function rowsFromGame_(game) {
  var qs = (game && game.questions) || [];
  var rows = [];
  for (var i = 0; i < QUESTION_ROWS; i++) {
    var q = qs[i] || {}, r = i + 2;
    var answers = Array.isArray(q.answers) ? q.answers : [];
    var right = answers[Number.isInteger(q.correct) ? q.correct : 0] || '';
    var wrong = answers.filter(function (_, k) { return k !== (Number.isInteger(q.correct) ? q.correct : 0); });
    var row = [q.q || '', right];
    for (var c = 0; c < 3; c++) row.push(wrong[c] ? wrong[c] : (q.q ? aiFormula_(c, r) : ''));
    row.push(q.fact || '');
    rows.push(row);
  }
  return rows;
}

function clean_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/[.!]+$/, '');
}
function isError_(v) {
  var s = String(v || '');
  return /^#(N\/A|NAME\?|ERROR!|VALUE!|REF!)/.test(s) || /^(Loading|Generating)/i.test(s);
}

/** Checks the Questions values and builds the game. Returns { game, errors, warnings }. */
function gameFromSheet_(settings, values) {
  var errors = [], warnings = [], questions = [];
  values.forEach(function (row, i) {
    var n = 'Row ' + (i + 2) + ': ';
    var q = clean_(row[0]);
    if (!q) return;
    var right = clean_(row[1]);
    if (!right) { errors.push(n + 'needs the right answer.'); return; }
    var wrong = [];
    for (var c = 2; c <= 4; c++) {
      if (isError_(row[c])) { errors.push(n + HEADERS[c] + ' did not generate (' + String(row[c]).slice(0, 20) + '). Select it and click Generate, or type one.'); continue; }
      var w = clean_(row[c]);
      if (!w) { errors.push(n + HEADERS[c] + ' is empty. Run "Fill blank wrong answers with AI" and Generate, or type one.'); continue; }
      wrong.push(w);
    }
    var all = [right].concat(wrong).map(function (a) { return a.toLowerCase(); });
    all.forEach(function (a, k) {
      if (all.indexOf(a) !== k) errors.push(n + '"' + [right].concat(wrong)[k] + '" appears twice. Change one of them.');
    });
    [right].concat(wrong).forEach(function (a) {
      if (a.split(' ').length > 3) warnings.push(n + '"' + a + '" is longer than 3 words. It will wrap on the button.');
    });
    var item = { q: q, answers: [right].concat(wrong), correct: 0 };
    var fact = String(row[5] || '').replace(/\s+/g, ' ').trim();   // a sentence: keep its punctuation
    if (fact) item.fact = fact;
    questions.push(item);
  });
  if (!questions.length) errors.push('No questions yet.');
  if (!/^[a-z0-9-]{1,60}$/.test(settings.id || '')) errors.push('Game id on the Game tab must be lowercase letters, numbers and dashes.');
  if (!settings.honoree) errors.push('Add their name on the Game tab.');
  if (!settings.leaderboardUrl) warnings.push('No Leaderboard URL on the Game tab. Scores will only show on each player\'s own phone.');
  var first = (settings.honoree || '').split(' ')[0] || 'Them';
  var game = {
    title: settings.title || ('How Well Do You Know ' + first + '?'),
    honoree: settings.honoree || '',
    occasion: settings.occasion || 'custom',
    secondsPerQuestion: 20,
    shuffleAnswers: true,
    leaderboardUrl: settings.leaderboardUrl || '',
    closesAt: settings.closesAt || '',
    questions: questions
  };
  if (settings.eyebrow) game.eyebrow = settings.eyebrow;
  if (settings.primary) game.theme = { primary: settings.primary, secondary: settings.secondary || settings.primary };
  if (settings.photo) game.photo = settings.photo;
  return { game: game, errors: errors, warnings: warnings };
}

/* ---------- sheet plumbing ---------- */

function tabs_() {
  var ss = SpreadsheetApp.getActive();
  var qs = ss.getSheetByName('Questions') || ss.insertSheet('Questions', 0);
  var gm = ss.getSheetByName('Game') || ss.insertSheet('Game', 1);
  if (qs.getRange(1, 1).getValue() !== HEADERS[0]) {
    qs.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    qs.setFrozenRows(1);
    qs.setColumnWidth(1, 320); qs.setColumnWidths(2, 4, 170); qs.setColumnWidth(6, 280);
  }
  if (gm.getRange(1, 1).getValue() !== SETTINGS[0][0]) {
    gm.getRange(1, 1, SETTINGS.length, 1).setValues(SETTINGS.map(function (s) { return [s[0]]; })).setFontWeight('bold');
    gm.getRange(1, 3, SETTINGS.length, 1).setValues(SETTINGS.map(function (s) { return [s[1]]; })).setFontColor('#777777');
    gm.setColumnWidth(1, 190); gm.setColumnWidth(2, 360);
    var lb = PropertiesService.getDocumentProperties().getProperty('LEADERBOARD_URL');
    if (lb) gm.getRange(9, 2).setValue(lb);
  }
  return { qs: qs, gm: gm };
}
function settings_(gm) {
  var v = gm.getRange(1, 2, SETTINGS.length, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
  return { id: v[0].toLowerCase(), honoree: v[1], occasion: v[2].toLowerCase(), title: v[3], eyebrow: v[4],
    primary: v[5], secondary: v[6], photoLink: v[7], leaderboardUrl: v[8], closesAt: v[9], folderLink: v[10] };
}
function fileId_(link) {
  var m = /[-\w]{25,}/.exec(String(link || ''));
  return m ? m[0] : '';
}
function slug_(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* ---------- menu actions ---------- */

function loadOrder() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Load an order',
    'Paste the Drive link to the order\'s "trivia game.json" file (in the order folder), or paste the order folder link.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var id = fileId_(res.getResponseText());
  if (!id) return ui.alert('That does not look like a Drive link.');
  var file, folder;
  try {
    folder = DriveApp.getFolderById(id);
    var it = folder.getFiles();
    while (it.hasNext()) { var f = it.next(); if (/trivia game\.json$/i.test(f.getName())) { file = f; break; } }
    if (!file) return ui.alert('No "trivia game.json" in that folder. If the order came in before the order script was updated, type the questions in from the order details file.');
  } catch (notFolder) {
    file = DriveApp.getFileById(id);
    var parents = file.getParents();
    folder = parents.hasNext() ? parents.next() : null;
  }
  var game = JSON.parse(file.getBlob().getDataAsString());
  var t = tabs_();
  var rows = rowsFromGame_(game);
  t.qs.getRange(2, 1, QUESTION_ROWS, HEADERS.length).clearContent();
  t.qs.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);

  var photo = '';
  if (folder) {
    var imgs = folder.getFiles();
    while (imgs.hasNext()) { var im = imgs.next(); if (/^image\//.test(im.getMimeType())) { photo = im.getUrl(); break; } }
  }
  var first = (game.honoree || '').split(' ')[0];
  var vals = [
    slug_(first + '-' + (game.occasion === 'graduation' ? 'grad' : game.occasion || 'trivia') + '-' + new Date().getFullYear()),
    game.honoree || '', game.occasion || '', game.title || '', '',
    (game.theme && game.theme.primary) || '', (game.theme && game.theme.secondary) || '',
    photo, t.gm.getRange(9, 2).getValue() || '', '', folder ? folder.getUrl() : ''
  ];
  t.gm.getRange(1, 2, vals.length, 1).setValues(vals.map(function (v) { return [v]; }));
  var blanks = rows.reduce(function (n, r) { return n + r.slice(2, 5).filter(function (c) { return /^=AI\(/.test(c); }).length; }, 0);
  ui.alert('Order loaded',
    'Loaded ' + (game.questions || []).length + ' questions. ' + blanks + ' wrong answers are set to be written by AI.\n\n' +
    'Next: on the Questions tab, select columns C to E and click Generate (or Refresh) so the AI fills them. ' +
    'Read them over, fix anything odd, then choose Asher Arcade > Make game file.', ui.ButtonSet.OK);
}

function fillBlanks() {
  var t = tabs_();
  var range = t.qs.getRange(2, 1, QUESTION_ROWS, HEADERS.length);
  var v = range.getValues(), f = range.getFormulas(), n = 0;
  for (var i = 0; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    for (var c = 2; c <= 4; c++) {
      if (!f[i][c] && !String(v[i][c]).trim()) { t.qs.getRange(i + 2, c + 1).setFormula(aiFormula_(c - 2, i + 2)); n++; }
    }
  }
  SpreadsheetApp.getUi().alert(n ? n + ' AI formulas added. Select them and click Generate (or Refresh) to fill them.' : 'No blank wrong answers found.');
}

function makeGameFile() {
  var ui = SpreadsheetApp.getUi();
  var t = tabs_();
  var s = settings_(t.gm);
  if (s.leaderboardUrl) PropertiesService.getDocumentProperties().setProperty('LEADERBOARD_URL', s.leaderboardUrl);
  var values = t.qs.getRange(2, 1, QUESTION_ROWS, HEADERS.length).getDisplayValues();
  var settings = { id: s.id, honoree: s.honoree, occasion: s.occasion, title: s.title, eyebrow: s.eyebrow,
    primary: s.primary, secondary: s.secondary, leaderboardUrl: s.leaderboardUrl, closesAt: s.closesAt };
  if (s.photoLink) {
    try { settings.photo = photoDataUri_(fileId_(s.photoLink)); }
    catch (err) { return ui.alert('Could not read the photo from the Drive link on the Game tab: ' + err.message); }
  }
  var out = gameFromSheet_(settings, values);
  if (!settings.photo) out.warnings.push('No photo. The start screen will show an emoji instead of their face.');
  if (out.errors.length) return ui.alert('Fix these first', out.errors.join('\n'), ui.ButtonSet.OK);

  var json = JSON.stringify(out.game, null, 2);
  var folder = s.folderLink ? DriveApp.getFolderById(fileId_(s.folderLink)) : DriveApp.getRootFolder();
  var name = s.id + '.json';
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var file = folder.createFile(name, json, MimeType.PLAIN_TEXT);
  ui.alert('Game file ready',
    (out.warnings.length ? 'Heads up:\n' + out.warnings.join('\n') + '\n\n' : '') +
    'Saved ' + name + ' in Drive:\n' + file.getUrl() + '\n\n' +
    'To make it live: download it and put it in the asherarcade repo at trivia/games/' + name + '.\n' +
    'Guests play at https://www.asherarcade.com/trivia.html?g=' + s.id, ui.ButtonSet.OK);
}

/** The Drive photo, shrunk to about 600px, as a JPEG data URI so the game file is self-contained. */
function photoDataUri_(id) {
  var res = UrlFetchApp.fetch('https://drive.google.com/thumbnail?sz=w600&id=' + id, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  var blob = res.getResponseCode() === 200 ? res.getBlob() : DriveApp.getFileById(id).getBlob();
  if (blob.getBytes().length > 1500000) throw new Error('photo is over 1.5 MB; use a smaller one');
  return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function resetSheet() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Clear the questions and game settings?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var t = tabs_();
  t.qs.getRange(2, 1, QUESTION_ROWS, HEADERS.length).clearContent();
  var lb = t.gm.getRange(9, 2).getValue();
  t.gm.getRange(1, 2, SETTINGS.length, 1).clearContent();
  t.gm.getRange(9, 2).setValue(lb);
}
