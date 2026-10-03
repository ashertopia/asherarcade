/**
 * Fulfillment log — one row per order. Source of truth for dedup (alongside
 * the Drive folder-name check) and for the daily digest's due-today scan.
 * Auto-created on first use; its ID is cached in Script Properties.
 */

var LOG_HEADERS = [
  'sessionId', 'eventName', 'customerEmail', 'albumEmail', 'eventDate',
  'folderId', 'folderUrl', 'closeDate', 'claimDate', 'deleteDate',
  'handoffSent', 'lastChanceSent', 'createdAt',
];

function getLogSheet_() {
  var cfg = CFG_();
  var props = PropertiesService.getScriptProperties();
  var ss;
  if (cfg.LOG_SHEET_ID) {
    ss = SpreadsheetApp.openById(cfg.LOG_SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('KeepsakeDrop Fulfillment Log');
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logRowIndex_(sessionId) {
  var sheet = getLogSheet_();
  // getRange() throws "The number of rows in the range must be at least 1"
  // when the sheet holds only its header row, i.e. on the very first order.
  if (sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === sessionId) return i + 2; // 1-indexed, +1 for header row
  }
  return -1;
}

/**
 * Dates are written with a leading apostrophe so Sheets stores them as the
 * literal text "2026-10-15" instead of converting them to date cells (which
 * getValues() would hand back as Date objects). Readers go through
 * cellIso_() anyway, so rows written by the old code still work.
 */
function asText_(s) {
  return s ? "'" + s : '';
}

function appendLogRow_(order, folder, dates) {
  var sheet = getLogSheet_();
  sheet.appendRow([
    order.sessionId,
    order.eventName,
    order.customerEmail,
    order.albumEmail,
    asText_(order.eventDate ? fmtISO_(order.eventDate) : ''),
    folder.getId(),
    folder.getUrl(),
    asText_(fmtISO_(dates.close)),
    asText_(fmtISO_(dates.claim)),
    asText_(fmtISO_(dates.deleteOn)),
    false,
    false,
    asText_(fmtISO_(new Date())),
  ]);
}

/** A date cell's value as 'YYYY-MM-DD', whether Sheets kept text or made a Date. */
function cellIso_(v) {
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : fmtISO_(v);
  var mt = String(v || '').trim().match(/^'?(\d{4}-\d{2}-\d{2})/);
  return mt ? mt[1] : '';
}

/** Checkbox-ish cell: true, or the text TRUE. */
function cellTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function markLogFlag_(sessionId, columnName, value) {
  var sheet = getLogSheet_();
  var row = logRowIndex_(sessionId);
  if (row === -1) return;
  var col = LOG_HEADERS.indexOf(columnName) + 1;
  if (col === 0) return;
  sheet.getRange(row, col).setValue(value);
}

function getAllLogRows_() {
  var sheet = getLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  return values.map(function (row) {
    var obj = {};
    LOG_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function sessionAlreadyLogged_(sessionId) {
  return logRowIndex_(sessionId) !== -1;
}

// ── Held orders (paid, but event date/name unreadable) ──

var HELD_HEADERS = [
  'sessionId', 'eventName', 'eventDateAsTyped', 'customerEmail',
  'fixedEventDate', 'fixedEventName', 'status', 'heldAt', 'orderJson',
];

function getHeldSheet_() {
  var ss = getLogSheet_().getParent();
  var sheet = ss.getSheetByName('Held orders');
  if (!sheet) {
    sheet = ss.insertSheet('Held orders');
    sheet.appendRow(HELD_HEADERS);
    sheet.setFrozenRows(1);
    // Keep typed dates as text so "2027-06-06" is read back verbatim.
    sheet.getRange(1, HELD_HEADERS.indexOf('fixedEventDate') + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  }
  return sheet;
}

function findHeldRow_(sessionId) {
  var sheet = getHeldSheet_();
  if (sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === sessionId) return i + 2;
  }
  return -1;
}

function appendHeldRow_(order, event) {
  var stored = {};
  Object.keys(order).forEach(function (k) { stored[k] = order[k]; });
  stored.eventDate = null;
  getHeldSheet_().appendRow([
    order.sessionId, order.eventName, order.eventDateRaw, order.customerEmail,
    '', '', 'held', asText_(fmtISO_(new Date())), JSON.stringify(stored),
  ]);
}
