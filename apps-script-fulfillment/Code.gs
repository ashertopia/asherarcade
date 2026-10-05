/**
 * KeepsakeDrop order fulfillment — Google Apps Script backend.
 *
 * Replaces the two Claude-Code Routines ("KeepsakeDrop order watcher" and
 * "KeepsakeDrop morning comms digest") with a zero-LLM-token pipeline:
 * Stripe -> this webhook -> Drive/Docs/Sheets/Gmail/Calendar, all native
 * Apps Script services. See README.md for one-time setup.
 *
 * IMPORTANT Apps Script limitations: doPost(e) does NOT expose incoming
 * HTTP headers, so it cannot read Stripe's `Stripe-Signature` header, and it
 * can only answer a POST with a 302 redirect, which Stripe counts as a failed
 * delivery. So Stripe calls keepsakedrop-site/api/stripe-webhook.js, which
 * verifies the signature, answers 200, and forwards the event here with a
 * shared secret as a query param (?token=...), visible via e.parameter.
 * See README.md "How Stripe reaches this script".
 */

function CFG_() {
  var p = PropertiesService.getScriptProperties();
  return {
    WEBHOOK_TOKEN: p.getProperty('WEBHOOK_TOKEN'),
    PAYMENT_LINK_ID: p.getProperty('PAYMENT_LINK_ID') || 'plink_1U16AQRyTAXcMvg49vhhR39i',
    // Non-secret settings default to the live values, so only the two
    // secrets (WEBHOOK_TOKEN, SIGN_PDF_API_KEY) have to be typed in.
    SIGN_PDF_ENDPOINT: p.getProperty('SIGN_PDF_ENDPOINT') || 'https://keepsakedrop.com/api/sign-pdf',
    SIGN_PDF_API_KEY: p.getProperty('SIGN_PDF_API_KEY'),
    GUEST_SCRIPT_EXEC_URL: p.getProperty('GUEST_SCRIPT_EXEC_URL') ||
      'https://script.google.com/macros/s/AKfycbwY6_iIkp9dr4Z7FDt0QHiAMMSoRCmaKQVLKhaDHpl6YzUYpg28Ewin6DsZqp1s0y7h/exec',
    README_TEMPLATE_DOC_ID: p.getProperty('README_TEMPLATE_DOC_ID') || '1yw2HkRMhBbLqTnmH130NAwbceWZm0lmH5x_yq59rfp0',
    // Defaults to the Google account the script runs as (the owner).
    OWNER_EMAIL: p.getProperty('OWNER_EMAIL') || ownerEmailFromAccount_(),
    LOG_SHEET_ID: p.getProperty('LOG_SHEET_ID'),
    SITE_URL: p.getProperty('SITE_URL') || 'https://keepsakedrop.com',
    // Opt-in: share the album folder with the customer's album email
    // automatically. Off unless set to 'true' (sharing stays a manual step).
    AUTO_SHARE_ALBUM: p.getProperty('AUTO_SHARE_ALBUM') === 'true',
  };
}

/** The Google account the script runs as, or '' if it can't be read. */
function ownerEmailFromAccount_() {
  try {
    return typeof Session !== 'undefined' ? Session.getEffectiveUser().getEmail() : '';
  } catch (e) {
    return ''; // checkConfig then reports OWNER_EMAIL as missing instead of crashing
  }
}

function doGet(e) {
  return json_({ ok: true, service: 'keepsakedrop-fulfillment' });
}

/**
 * Webhook entry point. In production Stripe does not call this directly:
 * keepsakedrop-site/api/stripe-webhook.js verifies the Stripe-Signature
 * header, answers Stripe with a 200 (Apps Script itself can only answer a
 * POST with a 302 redirect, which Stripe counts as a failed delivery), and
 * forwards the verified event here with ?token=WEBHOOK_TOKEN.
 */
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

    // One order at a time, so two deliveries of the same session (Stripe
    // retries, or completed + async_payment_succeeded) can't both pass the
    // "already fulfilled?" check before either has written its log row.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return json_({ ok: false, error: 'busy, retry' });
    }
    try {
      return json_(handleStripeEvent_(event, cfg));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    logError_('doPost', err);
    // Details go to the owner email and the execution log, not the caller.
    return json_({ ok: false, error: 'internal error' });
  }
}

/**
 * Decide what a Stripe event means for us. Pure (no Google services), so it
 * can be unit-tested. Returns { action: 'fulfill' | 'ignore' | 'wait', reason },
 * plus quiet: true when the owner should NOT be emailed about it.
 */
function classifyEvent_(event, paymentLinkId) {
  var type = event && event.type;
  var session = event && event.data && event.data.object;
  var handled = ['checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed'];
  if (handled.indexOf(type) === -1) {
    return { action: 'ignore', reason: 'event type ' + type + ' is not handled' };
  }
  if (!session) return { action: 'ignore', reason: 'event has no session object' };
  if (session.payment_link !== paymentLinkId) {
    // Other products on the same Stripe account (e.g. PackLocker) fire
    // checkout events at this endpoint too. They are not ours: ignore them
    // quietly, without an owner email. (checkConfig logs PAYMENT_LINK_ID so a
    // wrong value can be spotted.)
    return { action: 'ignore', quiet: true, reason: 'different payment link (' + session.payment_link + ')' };
  }
  if (type === 'checkout.session.async_payment_failed') {
    return { action: 'ignore', reason: 'delayed payment FAILED; nothing was fulfilled' };
  }
  if (session.status !== 'complete') {
    return { action: 'ignore', reason: 'session status is ' + session.status };
  }
  // A 100%-off promo order has arrived as 'paid' in practice; Stripe also
  // documents 'no_payment_required' for sessions that collect nothing, so
  // accept that too rather than silently dropping such an order.
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return { action: 'fulfill', reason: 'payment_status ' + session.payment_status };
  }
  if (session.payment_status === 'unpaid' && type === 'checkout.session.completed') {
    return { action: 'wait', reason: 'delayed payment method; fulfilling when checkout.session.async_payment_succeeded arrives' };
  }
  return { action: 'ignore', reason: 'payment_status ' + session.payment_status };
}

function handleStripeEvent_(event, cfg) {
  var decision = classifyEvent_(event, cfg.PAYMENT_LINK_ID);
  var session = event && event.data && event.data.object;
  var sessionId = session && session.id;

  if (decision.action !== 'fulfill') {
    if (decision.quiet) {
      console.log('Ignored quietly: ' + decision.reason + ' ' + (event && event.id));
    } else {
      notifyIgnored_(event, decision.reason);
    }
    return { ok: true, ignored: decision.reason, sessionId: sessionId };
  }

  var order = extractOrder_(session);

  if (isAlreadyFulfilled_(order)) {
    notifyIgnored_(event, 'session already fulfilled (duplicate delivery)');
    return { ok: true, ignored: 'already fulfilled', sessionId: order.sessionId };
  }

  // A date more than a week gone is almost always a typo'd year, and taking
  // it would close the guest link before the event. Hold it for the owner.
  order.eventDatePast = !!order.eventDate && isPastEventDate_(order.eventDate, new Date());
  if (!order.eventDate || !order.eventNameProvided || order.eventDatePast) {
    holdOrder_(order, event);
    return { ok: true, held: true, sessionId: order.sessionId };
  }

  var result = fulfillOrder_(order);
  return { ok: true, result: result };
}

/** Owner email for an event that did not produce a fulfilled order (all
 * ignored reasons except a different payment link, which is quiet). */
function notifyIgnored_(event, reason) {
  try {
    var cfg = CFG_();
    if (!cfg.OWNER_EMAIL) return;
    var session = (event && event.data && event.data.object) || {};
    var email = (session.customer_details && session.customer_details.email) || session.customer_email || '(none)';
    MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop: Stripe event not fulfilled (' + reason + ')',
      'A Stripe event reached the fulfillment script but no order was created.\n\n' +
      'Reason: ' + reason + '\n' +
      'Event: ' + (event && event.type) + ' ' + (event && event.id) + '\n' +
      'Session: ' + (session.id || '(none)') + '\n' +
      'Payment link: ' + (session.payment_link || '(none)') + '\n' +
      'Payment status: ' + (session.payment_status || '(none)') + '\n' +
      'Customer: ' + email + '\n\n' +
      'If this was a real order, check it in the Stripe Dashboard and fulfill it by hand if needed.');
  } catch (e2) { /* notification must never break the webhook */ }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function logError_(where, err) {
  try {
    console.error(where + ': ' + (err && err.stack || err));
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

  // book.html appends the date picked on its calendar as _YYYYMMDD
  // ("wedding_sage_20270606"). Prefer it: nothing typed, nothing to misread.
  // The typed Stripe field is only a fallback for older checkout links.
  var ref = session.client_reference_id || 'event_gold';
  var refDate = null;
  var dm = ref.match(/^(.+)_(\d{8})$/);
  if (dm) {
    refDate = parseEventDate_(dm[2]);
    ref = dm[1];
  }
  var eventDateRaw = refDate ? dm[2] : (fields.event_date || '');
  var eventDate = refDate || parseEventDate_(eventDateRaw);
  var customerEmail = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  var albumEmail = fields.album_email || customerEmail;

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
  // client_reference_id comes from the checkout URL, so anyone can edit it.
  // Fall back to defaults rather than sending sign-pdf a value it rejects.
  if (['wedding', 'graduation', 'event'].indexOf(type) === -1) type = 'event';
  if (theme !== 'custom' && ['gold', 'blush', 'blue', 'sage'].indexOf(theme) === -1) theme = 'gold';

  return {
    sessionId: session.id,
    customerEmail: customerEmail,
    eventName: eventName,
    eventNameProvided: !!fields.event_name,
    eventDate: eventDate, // Date object or null (null = order is held, see holdOrder_)
    eventDateRaw: eventDateRaw,
    albumEmail: albumEmail,
    type: type,
    theme: theme,
    accentHex: accentHex,
  };
}

var MONTHS_ = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** Works for Dates from any context (instanceof doesn't across realms). */
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

/**
 * Stripe custom fields are free text, so the event date can arrive as
 * "06/06/2027", "6/6/27", "2027-06-06", "June 6, 2027", "Sat, Jun 6th 2027",
 * "6 June 2027", ... Returns { y, m, d } or null. Ambiguous numeric dates are
 * read US-style (month first) unless the first number can't be a month.
 * Anything without a year, or not a real calendar date, returns null so the
 * order is held for the owner instead of guessed. Pure — unit-tested.
 */
function parseEventDateParts_(text) {
  var s = String(text || '').trim().toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');
  if (!s) return null;
  var y, m, d, mt;

  if ((mt = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else if ((mt = s.match(/^(\d{2})(\d{2})(\d{4})$/))) {
    // Bare digits, typed on a phone keypad: MMDDYYYY, or YYYYMMDD when the
    // first pair can't be a month ("20261115").
    if (+mt[1] <= 12) { m = +mt[1]; d = +mt[2]; y = +mt[3]; }
    else { y = +(mt[1] + mt[2]); m = +mt[3].slice(0, 2); d = +mt[3].slice(2); }
  } else if ((mt = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))) {
    var a = +mt[1], b = +mt[2];
    y = +mt[3]; if (mt[3].length === 2) y += 2000;
    if (a > 12 && b <= 12) { d = a; m = b; } else { m = a; d = b; }
  } else {
    // Drop a leading weekday ("saturday ", "sat ").
    s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+/, '');
    // "jun", "june", "sept", "september" — a 3+ letter start of a real month.
    var monthIdx = function (word) {
      if (word.length < 3) return 0;
      for (var i = 0; i < MONTHS_.length; i++) {
        if (MONTHS_[i].indexOf(word) === 0) return i + 1;
      }
      return 0;
    };
    if ((mt = s.match(/^([a-z]+)\.?\s+(\d{1,2})\s+(\d{4})$/))) {        // june 6 2027
      m = monthIdx(mt[1]); d = +mt[2]; y = +mt[3];
    } else if ((mt = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/))) {  // 6 june 2027
      d = +mt[1]; m = monthIdx(mt[2]); y = +mt[3];
    } else {
      return null;
    }
  }
  if (!m || m < 1 || m > 12 || d < 1 || y < 2000 || y > 2100) return null;
  var check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null; // e.g. Feb 30
  return { y: y, m: m, d: d };
}

/** More than 7 days before today. Pure — unit-tested. */
function isPastEventDate_(eventDate, now) {
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return eventDate.getTime() < cutoff.getTime();
}

/** Date (midnight, script time zone) or null. */
function parseEventDate_(text) {
  var p = parseEventDateParts_(text);
  return p ? new Date(p.y, p.m - 1, p.d) : null;
}

/** 'YYYY-MM-DD' (or a Date a Sheet handed back) -> Date at local midnight, or null. */
function isoToDate_(v) {
  if (isDate_(v)) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var mt = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return mt ? new Date(+mt[1], +mt[2] - 1, +mt[3]) : null;
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
