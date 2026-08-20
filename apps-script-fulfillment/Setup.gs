/**
 * One-time setup helpers. Run these from the Apps Script editor
 * (select the function in the toolbar dropdown, click Run) — see README.md.
 */

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
    Logger.log('Already fulfilled (delete the "Fake Test Party — KeepsakeDrop Album" Drive folder to re-test).');
    return;
  }
  var result = fulfillOrder_(order);
  Logger.log(JSON.stringify(result, null, 2));
}
