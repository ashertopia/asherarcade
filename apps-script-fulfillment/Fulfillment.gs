/**
 * The actual order-fulfillment pipeline. Mirrors what the retired Claude
 * "KeepsakeDrop order watcher" Routine did by hand, minus any LLM calls.
 */

/**
 * Dedup is by Stripe session ID (the log Sheet), checked under the script
 * lock in doPost. A Drive folder with the same name used to count as
 * "already fulfilled" too, which silently dropped a second paying customer
 * whose event shared a name ("Our Wedding"). Name clashes are now handled in
 * fulfillOrder_ instead: the new folder gets a distinguishing suffix and the
 * owner is told, so a genuine duplicate is still easy to spot.
 */
function isAlreadyFulfilled_(order) {
  return sessionAlreadyLogged_(order.sessionId);
}

function albumFolderName_(eventName) {
  return eventName + ' — KeepsakeDrop Album'; // em dash, matches existing convention
}

function computeDates_(order) {
  // Orders without a readable event date are held (holdOrder_) before they
  // get here; the "today" fallback only remains as a last-resort guard.
  var base = order.eventDate || new Date();
  return {
    close: addDays_(base, 30), // uploads close
    handoff: addDays_(base, 31), // send handoff/closing email
    claim: addDays_(base, 90), // = close + 60, the claim deadline
    lastChance: addDays_(base, 86), // last-chance notice, a few days before deletion
    deleteOn: addDays_(base, 90),
  };
}

function fulfillOrder_(order) {
  var cfg = CFG_();
  var dates = computeDates_(order);

  var folderName = albumFolderName_(order.eventName);
  var nameClash = DriveApp.getFoldersByName(folderName).hasNext();
  if (nameClash) {
    folderName = albumFolderName_(order.eventName + ' (' + String(order.sessionId).slice(-6) + ')');
  }
  var folder = DriveApp.createFolder(folderName);

  var readmeFile = createReadmeDoc_(folder, order, dates);

  var guestUrl = buildGuestUrl_(order, folder.getId(), dates.close);

  var signPdfOk = true;
  var signPdfError = null;
  try {
    attachSignPdf_(folder, order, guestUrl);
  } catch (err) {
    signPdfOk = false;
    signPdfError = String(err && err.message || err);
  }

  appendLogRow_(order, folder, dates);

  var share = shareAlbum_(folder, order);

  var draft = createDeliveryDraft_(order, folder, guestUrl, signPdfOk);

  createTomorrowReminderEvent_(order, folder, dates, share);

  notifyOwner_(order, folder, draft, signPdfOk, signPdfError, share, nameClash);

  return {
    sessionId: order.sessionId,
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    draftId: draft ? draft.getId() : null,
    signPdfOk: signPdfOk,
    signPdfError: signPdfError,
    shared: share.shared,
  };
}

/**
 * Opt-in (Script Property AUTO_SHARE_ALBUM = true): add the customer's album
 * email as an editor. Google sends them its usual "shared a folder" email.
 * Any problem (feature off, missing/odd address, non-Google address) falls
 * back to the old manual step, and the owner email says which happened.
 */
function shareAlbum_(folder, order) {
  var cfg = CFG_();
  if (!cfg.AUTO_SHARE_ALBUM) return { shared: false, note: 'auto-share is off' };
  var email = String(order.albumEmail || '').trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    return { shared: false, note: 'album email "' + email + '" does not look like one address' };
  }
  try {
    folder.addEditor(email);
    return { shared: true, note: 'shared with ' + email };
  } catch (err) {
    return { shared: false, note: 'sharing with ' + email + ' failed: ' + String(err && err.message || err) };
  }
}

function createReadmeDoc_(folder, order, dates) {
  var cfg = CFG_();
  if (!cfg.README_TEMPLATE_DOC_ID) throw new Error('README_TEMPLATE_DOC_ID not set in Script Properties');
  var templateFile = DriveApp.getFileById(cfg.README_TEMPLATE_DOC_ID);
  var copy = templateFile.makeCopy('Read Me — Your Album & How to Keep It Forever', folder);
  var doc = DocumentApp.openById(copy.getId());
  var body = doc.getBody();
  var tokens = {
    '{{EVENT_NAME}}': order.eventName,
    '{{CLOSE_DATE}}': fmtLong_(dates.close),
    '{{CLAIM_DATE}}': fmtLong_(dates.claim),
    '{{DELETE_DATE}}': fmtLong_(dates.deleteOn),
  };
  Object.keys(tokens).forEach(function (token) {
    body.replaceText(escapeRegex_(token), tokens[token]);
  });
  doc.saveAndClose();
  return copy;
}

function escapeRegex_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mirrors buildGuestUrl() in keepsakedrop-site/drop.html. */
function buildGuestUrl_(order, folderId, closeDate) {
  var cfg = CFG_();
  var base = cfg.SITE_URL + '/drop.html';
  var q = [];
  q.push('event=' + encodeURIComponent(slugify_(order.eventName)));
  q.push('type=' + encodeURIComponent(order.type));
  // Same name= the printed sign's QR carries (sign-pdf passes hostName), so
  // the emailed link and the QR code show guests the same page.
  q.push('name=' + encodeURIComponent(order.eventName));
  q.push('until=' + encodeURIComponent(fmtISO_(closeDate)));
  if (order.theme === 'custom' && order.accentHex) {
    q.push('accent=' + encodeURIComponent(order.accentHex));
  } else if (order.theme && order.theme !== 'gold') {
    q.push('theme=' + encodeURIComponent(order.theme));
  }
  q.push('folder=' + encodeURIComponent(folderId));
  q.push('script=' + encodeURIComponent(cfg.GUEST_SCRIPT_EXEC_URL));
  return base + '?' + q.join('&');
}

function attachSignPdf_(folder, order, guestUrl) {
  var cfg = CFG_();
  if (!cfg.SIGN_PDF_ENDPOINT || !cfg.SIGN_PDF_API_KEY) {
    throw new Error('SIGN_PDF_ENDPOINT / SIGN_PDF_API_KEY not set in Script Properties');
  }
  var payload = {
    eventName: order.eventName,
    eventType: order.type,
    hostName: order.eventName, // drop.html no longer doubles this up when it equals the event name
    eventDate: order.eventDate ? fmtISO_(order.eventDate) : '',
    theme: order.theme,
    accentHex: order.accentHex,
    scriptUrl: cfg.GUEST_SCRIPT_EXEC_URL,
    folderId: folder.getId(),
    siteUrl: cfg.SITE_URL,
  };
  var resp = UrlFetchApp.fetch(cfg.SIGN_PDF_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.SIGN_PDF_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('sign-pdf endpoint returned ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  var blob = resp.getBlob().setName('PRINT ME — ' + order.eventName + ' Table Sign.pdf');
  folder.createFile(blob);
}

function createDeliveryDraft_(order, folder, guestUrl, signPdfOk) {
  var folderUrl = 'https://drive.google.com/drive/folders/' + folder.getId();
  // No emoji in subjects: GmailApp.createDraft turns characters outside the
  // Basic Multilingual Plane into mojibake ("������"). In the HTML body a
  // numeric entity survives, so emoji go there as &#...; only.
  var subject = order.eventName + ' — your KeepsakeDrop album is ready';
  var html =
    '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#1a1614;max-width:560px;line-height:1.6">' +
    '<p>Hi there,</p>' +
    '<p>Thank you for booking KeepsakeDrop! Everything for <strong>' + escapeHtml_(order.eventName) + '</strong> is set up.</p>' +
    '<p style="font-size:12px;letter-spacing:2px;color:#b58aa5;margin-bottom:4px"><strong>YOUR ALBUM</strong></p>' +
    '<p style="margin-top:0"><a href="' + folderUrl + '" style="color:#b5478a"><strong>Open your photo album folder →</strong></a><br>' +
    'Photos guests upload land here live. ' +
    // Never tell the customer the sign is there when sign-pdf failed; the owner email covers that case.
    (signPdfOk
      ? 'Inside you’ll also find your printable table sign ("PRINT ME — ' + escapeHtml_(order.eventName) + ' Table Sign.pdf") and your "Read Me" doc with how to keep the album forever.'
      : 'Inside you’ll also find your "Read Me" doc with how to keep the album forever, and your printable table sign will be added to the folder shortly.') +
    '</p>' +
    '<p style="font-size:12px;letter-spacing:2px;color:#b58aa5;margin-bottom:4px"><strong>YOUR GUEST LINK</strong></p>' +
    '<p style="margin-top:0">Guests scan the QR code on the table sign (or tap this link) and their photos land straight in your album — no app, no accounts:<br>' +
    '<a href="' + guestUrl + '" style="color:#b5478a">' + guestUrl + '</a></p>' +
    '<p>Happy celebrating! &#127874;</p>' +
    '<p>Scott<br><span style="color:#8a827c">Asher Arcade · <a href="https://keepsakedrop.com" style="color:#b5478a">keepsakedrop.com</a><br>' +
    'Questions? Just reply to this email.</span></p></div>';

  return GmailApp.createDraft(order.customerEmail, subject, stripHtml_(html), { htmlBody: html });
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml_(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&#\d+;/g, '').replace(/\s+\n/g, '\n').trim();
}

function createTomorrowReminderEvent_(order, folder, dates, share) {
  var cal = CalendarApp.getDefaultCalendar();
  var tz = 'America/Chicago';
  var start = tomorrowAt_(8, 0, tz);
  var end = tomorrowAt_(8, 30, tz);
  var desc =
    'KeepsakeDrop delivery checklist for ' + order.eventName + ':\n\n' +
    (share && share.shared
      ? '1. (Done automatically) album folder shared with ' + order.albumEmail + ':\n   ' + folder.getUrl() + '\n'
      : '1. Share the album folder with ' + order.albumEmail + ' as Editor:\n   ' + folder.getUrl() + '\n') +
    '2. Send the drafted delivery email in Gmail (subject starts with "' + order.eventName + '")\n\n' +
    'Uploads close ' + fmtLong_(dates.close) + '. Claim deadline ' + fmtLong_(dates.claim) + '.';
  var event = cal.createEvent('Send ' + order.eventName + '’s KeepsakeDrop delivery email', start, end, { description: desc });
  event.addPopupReminder(0);
}

function tomorrowAt_(hour, minute, tz) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  var iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return new Date(iso + 'T' + pad2_(hour) + ':' + pad2_(minute) + ':00');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function notifyOwner_(order, folder, draft, signPdfOk, signPdfError, share, nameClash) {
  var cfg = CFG_();
  if (!cfg.OWNER_EMAIL) return;
  var lines = [
    'New KeepsakeDrop order fulfilled:',
    '',
    'Event: ' + order.eventName,
    'Date: ' + (order.eventDate ? fmtLong_(order.eventDate) : '(not provided)'),
    'Color: ' + order.theme + (order.accentHex ? ' (#' + order.accentHex + ')' : ''),
    'Customer: ' + order.customerEmail,
    'Album email: ' + order.albumEmail,
    '',
    'Folder: ' + folder.getUrl(),
    nameClash ? 'NOTE: a Drive folder named "' + albumFolderName_(order.eventName) + '" already existed, so this one has a suffix. If that folder is for this same customer, this order may be a duplicate.' : '',
    'Sharing: ' + (share ? share.note : 'manual'),
    signPdfOk ? 'Table sign PDF: attached to folder.' : ('Table sign PDF FAILED: ' + signPdfError + ' — you’ll need to add it manually.'),
    '',
    'Your remaining manual clicks:',
    (share && share.shared ? '1. (Done) folder already shared with ' + order.albumEmail + '.' : '1. Share the folder above with ' + order.albumEmail + ' as Editor.'),
    '2. Send the draft in Gmail: "' + order.eventName + ' — your KeepsakeDrop album is ready".',
    '',
    '(A calendar reminder for tomorrow 8:00-8:30 AM has this checklist too.)',
  ];
  MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop: ' + order.eventName + ' — ' + (share && share.shared ? '1 click' : '2 clicks') + ' left', lines.join('\n'));
}

/**
 * Paid order whose event name or date we couldn't read. Instead of guessing
 * (the old code used today's date, which could close the guest link before
 * the wedding), park it on the "Held orders" tab of the log Sheet and tell
 * the owner. Fill in the corrected date/name there and run
 * releaseHeldOrders() (dailyCheck also runs it every morning).
 */
function holdOrder_(order, event) {
  var already = findHeldRow_(order.sessionId);
  if (already === -1) appendHeldRow_(order, event);
  var cfg = CFG_();
  if (!cfg.OWNER_EMAIL) return;
  var problems = [];
  if (!order.eventNameProvided) problems.push('no event name');
  if (!order.eventDate) problems.push('event date "' + order.eventDateRaw + '" could not be read');
  MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop: order HELD — ' + problems.join(', '),
    'A paid KeepsakeDrop order was received but not fulfilled yet: ' + problems.join(', ') + '.\n\n' +
    'Event name: ' + order.eventName + '\n' +
    'Event date as typed: ' + (order.eventDateRaw || '(blank)') + '\n' +
    'Customer: ' + order.customerEmail + '\n' +
    'Session: ' + order.sessionId + '\n\n' +
    'To release it: open the "KeepsakeDrop Fulfillment Log" Sheet, "Held orders" tab, type the\n' +
    'correct date (YYYY-MM-DD) in fixedEventDate (and a name in fixedEventName if needed),\n' +
    'then run releaseHeldOrders() in the Apps Script editor (or wait for the 8 AM daily run).');
}
