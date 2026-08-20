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
  var ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === sessionId) return i + 2; // 1-indexed, +1 for header row
  }
  return -1;
}

function appendLogRow_(order, folder, dates) {
  var sheet = getLogSheet_();
  sheet.appendRow([
    order.sessionId,
    order.eventName,
    order.customerEmail,
    order.albumEmail,
    order.eventDate ? fmtISO_(order.eventDate) : '',
    folder.getId(),
    folder.getUrl(),
    fmtISO_(dates.close),
    fmtISO_(dates.claim),
    fmtISO_(dates.deleteOn),
    false,
    false,
    fmtISO_(new Date()),
  ]);
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
