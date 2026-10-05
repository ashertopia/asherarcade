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
  Logger.log('AUTO_SHARE_ALBUM = ' + cfg.AUTO_SHARE_ALBUM + ' (set the property to true to share album folders automatically).');
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
