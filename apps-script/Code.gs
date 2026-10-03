/**
 * KeepsakeDrop — Google Apps Script backend
 * Saves guest photos from keepsakedrop-site/drop.html into a Google Drive folder.
 *
 * SETUP — two options (see README.md in this folder for the clasp version):
 *
 * Manual (one time, ~3 minutes):
 * 1. Go to https://script.google.com and create a New Project.
 * 2. Paste this entire file into Code.gs (replace what's there).
 * 3. Click Deploy → New deployment → type: Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web app URL (ends in /exec).
 * 5. Create a folder in Google Drive for the event's photos and copy its
 *    folder ID (the long string after /folders/ in the address bar).
 * 6. Open drop.html with no URL parameters — the setup screen will
 *    ask for the script URL and folder ID and generate the guest QR code.
 *
 * WHICH FOLDERS THIS SCRIPT WILL WRITE TO
 * One deployment serves every KeepsakeDrop order, and each event's folder ID
 * is printed in the QR code on its public table sign, so the script should
 * only accept folders it knows about. Set either (or both) Script Properties
 * (Project Settings → Script Properties):
 *   LOG_SHEET_ID   — the "KeepsakeDrop Fulfillment Log" Sheet ID (the
 *                    fulfillment script's LOG_SHEET_ID). Every folder in it is
 *                    accepted until the end of its closeDate.
 *   EXTRA_FOLDERS  — hand-made albums, comma or newline separated, each
 *                    "FOLDER_ID" (no close date) or "FOLDER_ID=YYYY-MM-DD".
 * With neither set (and LOCKED_FOLDER_ID empty) the script behaves exactly as
 * before and accepts any folder ID — so deploying this version can't break a
 * live event link before the allowlist is configured.
 */

// Optional: lock this script to one folder so the folder ID in the guest
// URL can't be swapped for someone else's. Leave '' to accept the folder
// ID sent by the page (subject to the allowlist above, when configured).
var LOCKED_FOLDER_ID = '';

// Optional: last day uploads are accepted, e.g. '2026-09-15' (set this to
// the event date + 30 days to match the page's ?until= behavior). Leave ''
// to accept uploads forever. This is the real enforcement — the page-side
// check is just a friendly notice. Allowlisted folders also get their own
// close date from LOG_SHEET_ID / EXTRA_FOLDERS.
var UPLOAD_CLOSE_DATE = '';

// Reject any single request bigger than ~8 MB of base64 (one compressed
// photo is typically 200-600 KB, so this is generous).
var MAX_BODY_CHARS = 8 * 1024 * 1024;

// drop.html sends one photo per request; allow a few for older pages.
var MAX_PHOTOS_PER_REQUEST = 10;

// Per-folder rate limits (photos). Generous: a big reception where dozens of
// guests upload 30 photos each at once stays well under these.
var RATE_LIMITS = [
  { windowSec: 600, max: 1500 },    // 10 minutes
  { windowSec: 21600, max: 10000 }, // 6 hours (CacheService's longest TTL)
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: 'empty request' });
    }
    if (e.postData.contents.length > MAX_BODY_CHARS) {
      return jsonOut({ ok: false, error: 'request too large' });
    }

    if (UPLOAD_CLOSE_DATE && isPastClose_(UPLOAD_CLOSE_DATE, new Date())) {
      return jsonOut({ ok: false, error: 'closed' });
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOut({ ok: false, error: 'bad request' });
    }
    var folderId = LOCKED_FOLDER_ID || String(body.folder || '');
    if (!folderId) return jsonOut({ ok: false, error: 'missing folder' });

    if (!LOCKED_FOLDER_ID) {
      var allow = lookupFolder_(folderId);
      if (allow.configured) {
        if (!allow.found) return jsonOut({ ok: false, error: 'unknown folder' });
        if (allow.closeDate && isPastClose_(allow.closeDate, new Date())) {
          return jsonOut({ ok: false, error: 'closed' });
        }
      }
    }

    var photos = (body.photos || []).slice(0, MAX_PHOTOS_PER_REQUEST);
    if (!photos.length) return jsonOut({ ok: false, error: 'no photos' });

    if (!withinRateLimit_(folderId, photos.length)) {
      return jsonOut({ ok: false, error: 'rate limited' });
    }

    var folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (folderErr) {
      return jsonOut({ ok: false, error: 'unknown folder' });
    }

    var guest = String(body.name || 'Anonymous').replace(/[^\w\s&'.-]/g, '').slice(0, 60) || 'Anonymous';
    var saved = 0;
    var rejected = 0;

    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (!p || !p.data) continue;
      var bytes;
      try {
        bytes = Utilities.base64Decode(p.data);
      } catch (decodeErr) {
        rejected++;
        continue;
      }
      // Trust the file's own first bytes, not the type the page claims.
      var kind = sniffImage_(bytes);
      if (!kind) { rejected++; continue; }
      var stamp = Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd-HHmmss');
      var original = String(p.filename || 'photo').replace(/[^\w.-]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 70);
      var blob = Utilities.newBlob(bytes, kind.mime, guest + '_' + stamp + '_' + original + '.' + kind.ext);
      folder.createFile(blob);
      saved++;
    }

    if (!saved && rejected) return jsonOut({ ok: false, error: 'unsupported file' });
    return jsonOut({ ok: true, saved: saved, rejected: rejected });
  } catch (err) {
    // Details go to the execution log, not to whoever sent the request.
    console.error('doPost: ' + (err && err.stack || err));
    return jsonOut({ ok: false, error: 'server error' });
  }
}

/**
 * Image type from magic bytes, or null. drop.html always re-encodes to JPEG
 * on the phone before sending; the others are accepted so an older cached
 * page that sent originals keeps working.
 */
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
  if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

/**
 * True once the close day is over everywhere on Earth (end of that date at
 * UTC-12), so the server never closes earlier than the guest's own clock,
 * which is what drop.html's ?until= check uses.
 */
function isPastClose_(closeIso, now) {
  var mt = String(closeIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mt) return false;
  var endUtcMs = Date.UTC(+mt[1], +mt[2] - 1, +mt[3], 23, 59, 59) + 12 * 3600 * 1000;
  return now.getTime() > endUtcMs;
}

/**
 * Is this folder on the allowlist? Returns { configured, found, closeDate }.
 * The combined list is cached for 5 minutes so a busy reception doesn't
 * re-open the Sheet for every photo.
 */
function lookupFolder_(folderId) {
  var has = function (l) { return Object.prototype.hasOwnProperty.call(l, folderId); };
  var list = getAllowlist_(false);
  if (!list) return { configured: false };
  if (!has(list)) {
    // A just-fulfilled order may not be in the cached copy yet. Re-read the
    // Sheet, but at most once a minute so junk IDs can't hammer it.
    var cache = CacheService.getScriptCache();
    if (!cache.get('allowlist_refreshed')) {
      cache.put('allowlist_refreshed', '1', 60);
      list = getAllowlist_(true);
    }
  }
  if (!has(list)) return { configured: true, found: false };
  return { configured: true, found: true, closeDate: list[folderId] || '' };
}

function getAllowlist_(forceRefresh) {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('LOG_SHEET_ID');
  var extra = props.getProperty('EXTRA_FOLDERS');
  if (!sheetId && !extra) return null;

  var cache = CacheService.getScriptCache();
  var cached = forceRefresh ? null : cache.get('allowlist_v1');
  if (cached) return JSON.parse(cached);

  var list = {};
  String(extra || '').split(/[\s,]+/).forEach(function (entry) {
    if (!entry) return;
    var parts = entry.split('=');
    list[parts[0]] = parts[1] || '';
  });
  if (sheetId) {
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var fCol = headers.indexOf('folderId');
      var cCol = headers.indexOf('closeDate');
      var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      rows.forEach(function (r) {
        if (fCol === -1 || !r[fCol]) return;
        var c = r[cCol];
        list[String(r[fCol])] = Object.prototype.toString.call(c) === '[object Date]'
          ? Utilities.formatDate(c, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(c || '').replace(/^'/, '');
      });
    }
  }
  var json = JSON.stringify(list);
  if (json.length < 90000) cache.put('allowlist_v1', json, 300);
  return list;
}

/** Count photos per folder in fixed windows; false once a window is full. */
function withinRateLimit_(folderId, count) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  // Never drop a wedding photo because the counter was busy: if the lock
  // isn't free quickly, let the request through uncounted.
  if (!lock.tryLock(1500)) return true;
  try {
    var nowSec = Math.floor(Date.now() / 1000);
    var keys = RATE_LIMITS.map(function (r) {
      return 'rl_' + r.windowSec + '_' + Math.floor(nowSec / r.windowSec) + '_' + folderId;
    });
    var current = cache.getAll(keys);
    for (var i = 0; i < RATE_LIMITS.length; i++) {
      if ((+current[keys[i]] || 0) + count > RATE_LIMITS[i].max) return false;
    }
    var updated = {};
    keys.forEach(function (k) { updated[k] = String((+current[k] || 0) + count); });
    cache.putAll(updated, RATE_LIMITS[RATE_LIMITS.length - 1].windowSec);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
