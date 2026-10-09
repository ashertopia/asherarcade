/**
 * Asher Arcade game orders.
 *
 * Receives orders from asherarcade.com/order.html. Each order gets its own
 * Google Drive folder (details + the customer's photos), a row in the
 * "Asher Arcade Orders" Sheet, and an email to you. The customer is then sent
 * to the Stripe Payment Link for that game, with the order ID attached as the
 * Stripe client_reference_id so the payment and the folder match up.
 *
 * The page talks to this script in two steps:
 *   1. {action:'order', ...details}  -> creates the folder, returns {ok, id, token}
 *   2. {action:'photo', id, token, filename, data}  (once per photo)
 *
 * SETUP: see README.md in this folder. Nothing needs editing in this file.
 * Optional Script Properties (Project Settings -> Script Properties):
 *   ORDERS_FOLDER_ID  Drive folder that holds one subfolder per order.
 *                     Created automatically ("Asher Arcade Orders") if unset.
 *   ORDERS_SHEET_ID   The orders Sheet. Created automatically if unset.
 *   OWNER_EMAIL       Where new-order emails go. Defaults to your account.
 */

var MAX_BODY_CHARS = 16 * 1024 * 1024;   // one photo per request
var MAX_PHOTOS_PER_ORDER = 12;
var PHOTO_WINDOW_HOURS = 6;              // photos must arrive this soon after the order

// Keys match order.html. Prices are for the email and Sheet only; Stripe
// charges whatever its Payment Link says.
var PRODUCTS = {
  'drop-catch':     { name: 'Drop & Catch',             price: '$79' },
  'memory-match':   { name: 'Memory Match',             price: '$79' },
  'puzzle-reveal':  { name: 'Reveal & Announce Puzzle', price: '$39' },
  'whack-a-mole':   { name: 'Whack-a-Mole',             price: '$99' },
  'trivia':         { name: 'Custom Trivia',            price: '$99' },
  'endless-runner': { name: 'Endless Runner',           price: '$129' },
  'platformer':     { name: 'Wedding Platformer',       price: '$129' },
  'original':       { name: 'Original Game',            price: 'from $249 (quote)' },
  'hosting':        { name: 'Hosting Renewal',          price: '$19/year' }
};

var SHEET_HEADERS = ['Received', 'Order ID', 'Game', 'Price', 'Name', 'Email',
  'Details', 'Extra customization', 'Photos', 'Folder', 'Paid (Stripe)'];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOut({ ok: false, error: 'empty request' });
    if (e.postData.contents.length > MAX_BODY_CHARS) return jsonOut({ ok: false, error: 'request too large' });
    var body;
    try { body = JSON.parse(e.postData.contents); } catch (parseErr) { return jsonOut({ ok: false, error: 'bad request' }); }

    if (body.action === 'order') return jsonOut(createOrder_(body));
    if (body.action === 'photo') return jsonOut(addPhoto_(body));
    return jsonOut({ ok: false, error: 'bad request' });
  } catch (err) {
    console.error('doPost: ' + (err && err.stack || err));
    return jsonOut({ ok: false, error: 'server error', detail: String(err && err.message || err).slice(0, 160) });
  }
}

/** A plain GET answers with a status line, so you can check the deployment in a browser. */
function doGet() {
  return jsonOut({ ok: true, service: 'asher-arcade-orders' });
}

function createOrder_(b) {
  if (b.website) return { ok: true, id: 'AA-000000-TEST', token: 'x' };   // honeypot: pretend it worked
  var product = PRODUCTS[String(b.product || '')];
  if (!product) return { ok: false, error: 'unknown game' };
  var name = clean_(b.name, 80);
  var email = clean_(b.email, 120);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'name and email required' };

  var details = b.details && typeof b.details === 'object' ? b.details : {};
  var lines = [];
  Object.keys(details).forEach(function (k) {
    var v = clean_(details[k], 2000);
    if (v) lines.push(clean_(k, 60) + ': ' + v);
  });
  var extra = clean_(b.extra, 3000);
  var photosExpected = Math.max(0, Math.min(MAX_PHOTOS_PER_ORDER, parseInt(b.photoCount, 10) || 0));

  var tz = Session.getScriptTimeZone() || 'America/Chicago';
  var now = new Date();
  var id = 'AA-' + Utilities.formatDate(now, tz, 'yyMMdd') + '-' + randomCode_(4);
  var token = Utilities.getUuid();

  var root = getRoot_();
  var folder = root.createFolder(id + ' - ' + product.name + ' - ' + name);
  var text = [
    'Order ' + id,
    'Received: ' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm z'),
    'Game: ' + product.name + ' (' + product.price + ')',
    'Name: ' + name,
    'Email: ' + email,
    ''
  ].concat(lines).concat(extra ? ['', 'Extra customization requested (quote separately):', extra] : [])
   .concat(['', 'Photos expected: ' + photosExpected,
            'Stripe: search Payments for client_reference_id ' + id]).join('\n');
  folder.createFile(id + ' order details.txt', text, MimeType.PLAIN_TEXT);
  // Custom Trivia: the questions and colors as a game file. Open it in
  // trivia-studio.html ("Open a game file"), add the photo, and download.
  if (b.triviaGame && typeof b.triviaGame === 'object') {
    var game = JSON.stringify(b.triviaGame, null, 2);
    if (game.length < 200000) folder.createFile(id + ' trivia game.json', game, MimeType.PLAIN_TEXT);
  }

  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    props.setProperty('o_' + id, JSON.stringify({ f: folder.getId(), k: token, t: now.getTime(), n: 0 }));
    pruneOld_(props);
  } finally {
    lock.releaseLock();
  }

  try {
    getSheet_().appendRow([now, id, product.name, product.price, name, email, lines.join('\n'),
      extra, photosExpected, folder.getUrl(), '']);
  } catch (sheetErr) {
    console.error('sheet: ' + sheetErr);
  }

  try {
    var owner = props.getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({
      to: owner,
      replyTo: email,
      subject: 'New order ' + id + ' - ' + product.name + ' - ' + name,
      body: text + '\n\nFolder: ' + folder.getUrl() +
        '\n\nThe customer was sent to Stripe next. Stripe emails you separately when the payment goes through.'
    });
  } catch (mailErr) {
    console.error('mail: ' + mailErr);
  }

  return { ok: true, id: id, token: token };
}

function addPhoto_(b) {
  var id = String(b.id || '');
  if (!/^AA-\d{6}-[A-Z0-9]{4}$/.test(id)) return { ok: false, error: 'unknown order' };
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var rec, folderId;
  try {
    var raw = props.getProperty('o_' + id);
    if (!raw) return { ok: false, error: 'unknown order' };
    rec = JSON.parse(raw);
    if (rec.k !== String(b.token || '')) return { ok: false, error: 'unknown order' };
    if (Date.now() - rec.t > PHOTO_WINDOW_HOURS * 3600 * 1000) return { ok: false, error: 'closed' };
    if (rec.n >= MAX_PHOTOS_PER_ORDER) return { ok: false, error: 'too many photos' };
    rec.n++;
    props.setProperty('o_' + id, JSON.stringify(rec));
    folderId = rec.f;
  } finally {
    lock.releaseLock();
  }

  var bytes;
  try { bytes = Utilities.base64Decode(String(b.data || '')); } catch (decodeErr) { return { ok: false, error: 'unsupported file' }; }
  var kind = sniffImage_(bytes);
  if (!kind) return { ok: false, error: 'unsupported file' };
  var label = clean_(b.label, 40).replace(/[^\w -]/g, '').trim();
  var original = String(b.filename || 'photo').replace(/[^\w.-]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 60);
  var fname = (label ? label + ' - ' : '') + original + '.' + kind.ext;
  DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, kind.mime, fname));
  return { ok: true, n: rec.n };
}

function getRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ORDERS_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { console.error('ORDERS_FOLDER_ID not found, creating a new folder'); }
  }
  var folder = DriveApp.createFolder('Asher Arcade Orders');
  props.setProperty('ORDERS_FOLDER_ID', folder.getId());
  return folder;
}

function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ORDERS_SHEET_ID');
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Asher Arcade Orders');
    props.setProperty('ORDERS_SHEET_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(getRoot_()); } catch (e) {}
  }
  var sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(SHEET_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

/** Drop photo-window records older than a week so Script Properties stays small. */
function pruneOld_(props) {
  var all = props.getProperties();
  var cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('o_') !== 0) return;
    try { if (JSON.parse(all[k]).t < cutoff) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function randomCode_(n) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** Image type from the file's first bytes, or null. */
function sniffImage_(bytes) {
  var b = function (i) { return bytes[i] & 0xFF; };
  var ascii = function (from, to) {
    var s = '';
    for (var i = from; i < to && i < bytes.length; i++) s += String.fromCharCode(b(i));
    return s;
  };
  if (!bytes || bytes.length < 12) return null;
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor after pasting the code: approves permissions and creates the folder and Sheet. */
function setup() {
  var root = getRoot_();
  var sh = getSheet_();
  console.log('Orders folder: ' + root.getUrl());
  console.log('Orders sheet: ' + sh.getParent().getUrl());
}
