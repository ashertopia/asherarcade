/**
 * One-time setup helpers. Run these from the Apps Script editor
 * (select the function in the toolbar dropdown, click Run) — see README.md.
 */

/**
 * One click after the two secret Script Properties are set: checks config,
 * installs the 8 AM trigger, and runs a fake order end to end. Read the
 * execution log, then check Drive for "Fake Test Party — KeepsakeDrop Album".
 */
function finishSetup() {
  var cfg = checkConfig();
  if (!cfg.ok) throw new Error('Set these Script Properties first: ' + cfg.missing.join(', '));
  installDailyTrigger();
  testFulfillOrder();
  Logger.log('Setup finished. LOG_SHEET_ID = ' + PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID'));
}

/** Run once after deploying. Installs the daily 8 AM America/Chicago trigger. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyCheck')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('America/Chicago')
    .create();
  Logger.log('Installed daily trigger for dailyCheck() at 8 AM America/Chicago.');
}

/**
 * Sanity-check that every required Script Property is set. Run this after
 * filling in Script Properties, before wiring the real Stripe webhook.
 */
function checkConfig() {
  var cfg = CFG_();
  var required = [
    'WEBHOOK_TOKEN', 'SIGN_PDF_ENDPOINT', 'SIGN_PDF_API_KEY',
    'GUEST_SCRIPT_EXEC_URL', 'README_TEMPLATE_DOC_ID', 'OWNER_EMAIL',
  ];
  var missing = required.filter(function (k) { return !cfg[k]; });
  if (missing.length) {
    Logger.log('Missing Script Properties: ' + missing.join(', '));
  } else {
    Logger.log('All required Script Properties are set.');
  }
  Logger.log('PAYMENT_LINK_ID = ' + cfg.PAYMENT_LINK_ID + ' (must match the live Payment Link, or every order is ignored).');
  Logger.log('AUTO_SHARE_ALBUM = ' + cfg.AUTO_SHARE_ALBUM + ' (on by default; set the property to false to share album folders by hand).');
  Logger.log('LOG_SHEET_ID = ' + (cfg.LOG_SHEET_ID || '(not created yet; first order or testFulfillOrder creates it)') +
    ' — copy this into the guest-upload script\'s Script Properties too.');
  return { ok: missing.length === 0, missing: missing };
}

/**
 * Fires the exact same pipeline as a real webhook, using a synthetic
 * checkout.session object you pass in — no Stripe call needed. Handy for
 * testing from the Apps Script editor directly (Run > testFulfillOrder).
 */
function testFulfillOrder() {
  var fakeSession = {
    id: 'cs_test_fake_' + new Date().getTime(),
    status: 'complete',
    payment_status: 'paid',
    payment_link: CFG_().PAYMENT_LINK_ID,
    client_reference_id: 'event_blush',
    customer_details: { email: 'scott+test@example.com' },
    custom_fields: [
      { key: 'event_name', text: { value: 'Fake Test Party' } },
      { key: 'event_date', text: { value: '12/31/2026' } },
      { key: 'album_email', text: { value: 'scott+test@example.com' } },
    ],
  };
  var order = extractOrder_(fakeSession);
  if (isAlreadyFulfilled_(order)) {
    Logger.log('Already fulfilled (session ' + order.sessionId + ').');
    return;
  }
  var result = fulfillOrder_(order);
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * Re-render just the table sign into the "Fake Test Party" test folder,
 * e.g. after a sign-pdf fix, without creating another fake order.
 */
function testSignPdf() {
  var it = DriveApp.getFoldersByName(albumFolderName_('Fake Test Party'));
  if (!it.hasNext()) throw new Error('Run testFulfillOrder first; no Fake Test Party folder found.');
  var folder = it.next();
  var order = extractOrder_({
    id: 'cs_test_sign_only',
    client_reference_id: 'event_blush',
    custom_fields: [
      { key: 'event_name', text: { value: 'Fake Test Party' } },
      { key: 'event_date', text: { value: '12/31/2026' } },
    ],
  });
  attachSignPdf_(folder, order, '');
  Logger.log('Sign PDF added to ' + folder.getUrl());
}

/**
 * One-time cleanup of the launch-test orders: trashes their album folders
 * (recoverable from Drive's Trash for 30 days), deletes their delivery
 * drafts and KeepsakeDrop calendar events, and removes their rows from the
 * log Sheet and the Held orders tab. Only rows whose event name AND email
 * both match the lists below are touched.
 */
var TEST_EVENT_NAMES_ = ['Fake Test Party', 'Scott & Test', "Eli's Graduation"];
var TEST_EMAILS_ = ['scott+test@example.com', 'ashertopia@gmail.com'];

function cleanupTestOrders() {
  var isTest = function (name, email) {
    return TEST_EVENT_NAMES_.indexOf(String(name)) !== -1 &&
      TEST_EMAILS_.indexOf(String(email).toLowerCase()) !== -1;
  };
  var done = [];

  var sheet = getLogSheet_();
  var last = sheet.getLastRow();
  var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues() : [];
  var col = function (h) { return LOG_HEADERS.indexOf(h); };
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (!isTest(r[col('eventName')], r[col('customerEmail')])) continue;
    try { DriveApp.getFolderById(r[col('folderId')]).setTrashed(true); done.push('trashed folder ' + r[col('folderId')]); }
    catch (e) { done.push('folder ' + r[col('folderId')] + ' not trashed: ' + e.message); }
    sheet.deleteRow(i + 2);
    done.push('removed log row ' + r[col('sessionId')] + ' (' + r[col('eventName')] + ')');
  }

  var held = getHeldSheet_();
  var hl = held.getLastRow();
  var hrows = hl >= 2 ? held.getRange(2, 1, hl - 1, HELD_HEADERS.length).getValues() : [];
  var hcol = function (h) { return HELD_HEADERS.indexOf(h); };
  for (var j = hrows.length - 1; j >= 0; j--) {
    if (!isTest(hrows[j][hcol('eventName')], hrows[j][hcol('customerEmail')])) continue;
    held.deleteRow(j + 2);
    done.push('removed held row ' + hrows[j][hcol('sessionId')]);
  }

  GmailApp.getDrafts().forEach(function (d) {
    var subject = d.getMessage().getSubject() || '';
    var hit = TEST_EVENT_NAMES_.some(function (n) { return subject.indexOf(n + ' — your KeepsakeDrop album') === 0; });
    if (hit) { d.deleteDraft(); done.push('deleted draft: ' + subject); }
  });

  var cal = CalendarApp.getDefaultCalendar();
  var from = new Date(Date.now() - 14 * 86400000), to = new Date(Date.now() + 200 * 86400000);
  TEST_EVENT_NAMES_.forEach(function (n) {
    cal.getEvents(from, to, { search: n }).forEach(function (ev) {
      var t = ev.getTitle();
      if (t.indexOf('KeepsakeDrop') !== -1 && t.indexOf(n) !== -1) { ev.deleteEvent(); done.push('deleted calendar event: ' + t); }
    });
  });

  Logger.log(done.length ? done.join('\n') : 'Nothing to clean up.');
  return done;
}
