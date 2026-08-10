/**
 * KeepsakeDrop order fulfillment — Google Apps Script backend.
 *
 * Replaces the two Claude-Code Routines ("KeepsakeDrop order watcher" and
 * "KeepsakeDrop morning comms digest") with a zero-LLM-token pipeline:
 * Stripe -> this webhook -> Drive/Docs/Sheets/Gmail/Calendar, all native
 * Apps Script services. See README.md for one-time setup.
 *
 * IMPORTANT Apps Script limitation: doPost(e) does NOT expose incoming
 * HTTP headers, so we cannot read Stripe's `Stripe-Signature` header and
 * verify its HMAC the normal way. Instead the Stripe webhook URL itself
 * carries a shared secret as a query param (?token=...), which IS visible
 * via e.parameter. See README.md "Why a URL token instead of a signature".
 */

function CFG_() {
  var p = PropertiesService.getScriptProperties();
  return {
    WEBHOOK_TOKEN: p.getProperty('WEBHOOK_TOKEN'),
    PAYMENT_LINK_ID: p.getProperty('PAYMENT_LINK_ID') || 'plink_1U16AQRyTAXcMvg49vhhR39i',
    SIGN_PDF_ENDPOINT: p.getProperty('SIGN_PDF_ENDPOINT'),
    SIGN_PDF_API_KEY: p.getProperty('SIGN_PDF_API_KEY'),
    GUEST_SCRIPT_EXEC_URL: p.getProperty('GUEST_SCRIPT_EXEC_URL'),
    README_TEMPLATE_DOC_ID: p.getProperty('README_TEMPLATE_DOC_ID'),
    OWNER_EMAIL: p.getProperty('OWNER_EMAIL'),
    LOG_SHEET_ID: p.getProperty('LOG_SHEET_ID'),
    SITE_URL: p.getProperty('SITE_URL') || 'https://keepsakedrop.com',
  };
}

function doGet(e) {
  return json_({ ok: true, service: 'keepsakedrop-fulfillment' });
}

function doPost(e) {
  try {
    var cfg = CFG_();
    if (!cfg.WEBHOOK_TOKEN || !e || !e.parameter || e.parameter.token !== cfg.WEBHOOK_TOKEN) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (!e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty body' });
    }

    var event = JSON.parse(e.postData.contents);
    if (event.type !== 'checkout.session.completed') {
      return json_({ ok: true, ignored: 'event type ' + event.type });
    }

    var session = event.data && event.data.object;
    if (!session || session.status !== 'complete' || session.payment_status !== 'paid') {
      return json_({ ok: true, ignored: 'session not complete/paid' });
    }
    if (session.payment_link !== cfg.PAYMENT_LINK_ID) {
      return json_({ ok: true, ignored: 'different payment link' });
    }

    var order = extractOrder_(session);

    if (isAlreadyFulfilled_(order)) {
      return json_({ ok: true, ignored: 'already fulfilled', sessionId: order.sessionId });
    }

    var result = fulfillOrder_(order);
    return json_({ ok: true, result: result });
  } catch (err) {
    logError_('doPost', err);
    return json_({ ok: false, error: String(err && err.stack || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logError_(where, err) {
  try {
    var cfg = CFG_();
    if (cfg.OWNER_EMAIL) {
      MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop fulfillment error in ' + where,
        String(err && err.stack || err));
    }
  } catch (e2) { /* swallow — logging must never throw */ }
}

/** Pull the fields we need out of a Stripe checkout.session object. */
function extractOrder_(session) {
  var fields = {};
  (session.custom_fields || []).forEach(function (f) {
    fields[f.key] = (f.text && f.text.value) ? String(f.text.value).trim() : '';
  });

  var eventName = fields.event_name || 'Untitled Event';
  var eventDate = parseUsDate_(fields.event_date || '');
  var customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  var albumEmail = fields.album_email || customerEmail;

  var ref = session.client_reference_id || 'event_gold';
  var type, theme, accentHex;
  var customMatch = ref.match(/^([a-z]+)_c([0-9A-Fa-f]{6})$/);
  if (customMatch) {
    type = customMatch[1];
    theme = 'custom';
    accentHex = customMatch[2].toUpperCase();
  } else {
    var parts = ref.split('_');
    type = parts[0] || 'event';
    theme = parts.slice(1).join('_') || 'gold';
    accentHex = '';
  }

  return {
    sessionId: session.id,
    customerEmail: customerEmail,
    eventName: eventName,
    eventDate: eventDate, // Date object or null
    albumEmail: albumEmail,
    type: type,
    theme: theme,
    accentHex: accentHex,
  };
}

/** Stripe's custom_fields text arrives as MM/DD/YYYY (see book.html checkout). */
function parseUsDate_(mmddyyyy) {
  var m = String(mmddyyyy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

function addDays_(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function fmtISO_(date) {
  return Utilities.formatDate(date, 'America/Chicago', 'yyyy-MM-dd');
}

function fmtLong_(date) {
  return Utilities.formatDate(date, 'America/Chicago', 'MMMM d, yyyy');
}

function slugify_(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
