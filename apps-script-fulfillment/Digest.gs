/**
 * Runs once a day (install via installDailyTrigger() — see README.md).
 * Replaces the retired Claude "KeepsakeDrop morning comms digest" Routine:
 * handoff/last-chance follow-ups are computed from the fulfillment log
 * (no LLM, no memory dependency), and unsent Gmail drafts are still
 * surfaced as a nudge since sending itself stays a manual, human step.
 */

function dailyCheck() {
  var todayIso = fmtISO_(new Date());
  var rows = getAllLogRows_();
  var actionable = [];

  // Handoff fires at close+1 day (event_date+31) and last-chance at
  // close+56 (event_date+86); re-derived from closeDate rather than
  // storing every date, to keep the sheet schema small.
  rows.forEach(function (row) {
    if (!row.closeDate) return;
    var close = new Date(row.closeDate + 'T00:00:00');
    var handoffDate = fmtISO_(addDays_(close, 1));
    var lastChanceDate = fmtISO_(addDays_(close, 56)); // close+56 = event+86
    var deleteDate = fmtISO_(addDays_(close, 60)); // close+60 = event+90

    if (handoffDate === todayIso && !row.handoffSent) {
      handleHandoffDue_(row, deleteDate);
      markLogFlag_(row.sessionId, 'handoffSent', true);
      actionable.push('Handoff: ' + row.eventName);
    }
    if (lastChanceDate === todayIso && !row.lastChanceSent) {
      handleLastChanceDue_(row, deleteDate);
      markLogFlag_(row.sessionId, 'lastChanceSent', true);
      actionable.push('Last-chance: ' + row.eventName);
    }
  });

  var unsentDrafts = findKeepsakeDropDrafts_();
  if (unsentDrafts.length > 0) {
    actionable.push(unsentDrafts.length + ' unsent draft(s)');
    notifyDraftsDue_(unsentDrafts);
  }

  return { ok: true, actionable: actionable };
}

function handleHandoffDue_(row, deleteDateIso) {
  var cfg = CFG_();
  var deleteDate = fmtLong_(new Date(deleteDateIso + 'T00:00:00'));
  var subject = row.eventName + ' — your album is ready to keep forever';
  var html =
    '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#1a1614;max-width:560px;line-height:1.6">' +
    '<p>Hi there,</p>' +
    '<p>The photo collection window for <strong>' + escapeHtml_(row.eventName) + '</strong> has closed — hope the celebration was wonderful!</p>' +
    '<p>Your album is still right here: <a href="' + row.folderUrl + '">' + row.folderUrl + '</a></p>' +
    '<p>Take full ownership whenever you like — download the whole folder as a zip (right-click → Download in Drive), or reply to this email and we’ll transfer the folder to your own Google account.</p>' +
    '<p>Just a heads up: the album stays claimable until <strong>' + deleteDate + '</strong>, after which unclaimed albums are permanently deleted per our policy.</p>' +
    '<p>Thank you again for using KeepsakeDrop — hope to help with your next celebration too!</p>' +
    '<p>Scott<br><span style="color:#8a827c">Asher Arcade · <a href="https://keepsakedrop.com" style="color:#b5478a">keepsakedrop.com</a></span></p></div>';
  GmailApp.createDraft(row.customerEmail, subject, stripHtml_(html), { htmlBody: html });

  var cal = CalendarApp.getDefaultCalendar();
  var start = tomorrowAt_(8, 0, 'America/Chicago');
  start.setDate(start.getDate() - 1); // today, not tomorrow, for this one
  var end = new Date(start.getTime() + 30 * 60000);
  var event = cal.createEvent('KeepsakeDrop: ' + row.eventName + ' album handoff — send closing email',
    start, end, { description: 'Draft is ready in Gmail. Folder: ' + row.folderUrl + '\nClaim deadline: ' + deleteDate });
  event.addPopupReminder(0);

  if (cfg.OWNER_EMAIL) {
    MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop handoff ready: ' + row.eventName,
      'Closing email drafted for ' + row.customerEmail + '. Review and send from Gmail.\nFolder: ' + row.folderUrl);
  }
}

function handleLastChanceDue_(row, deleteDateIso) {
  var cfg = CFG_();
  var deleteDate = fmtLong_(new Date(deleteDateIso + 'T00:00:00'));
  var cal = CalendarApp.getDefaultCalendar();
  var start = tomorrowAt_(8, 0, 'America/Chicago');
  start.setDate(start.getDate() - 1);
  var end = new Date(start.getTime() + 30 * 60000);
  var event = cal.createEvent('KeepsakeDrop: last-chance notice — ' + row.eventName + ' album deletes ' + deleteDate,
    start, end, { description: 'Check whether ' + row.customerEmail + ' claimed the album. Folder: ' + row.folderUrl + '\nIf not claimed, send one last reminder before deletion.' });
  event.addPopupReminder(0);

  if (cfg.OWNER_EMAIL) {
    MailApp.sendEmail(cfg.OWNER_EMAIL, 'KeepsakeDrop last-chance: ' + row.eventName,
      'Deletes ' + deleteDate + ' if unclaimed. Check ' + row.folderUrl + ' ownership/activity and nudge ' + row.customerEmail + ' if needed.');
  }
}

function findKeepsakeDropDrafts_() {
  var drafts = GmailApp.getDrafts();
  return drafts.filter(function (d) {
    var msg = d.getMessage();
    return /keepsakedrop/i.test(msg.getSubject() || '');
  });
}

function notifyDraftsDue_(drafts) {
  var cfg = CFG_();
  if (!cfg.OWNER_EMAIL) return;
  var lines = drafts.map(function (d) {
    var msg = d.getMessage();
    return '- ' + msg.getSubject() + ' (to ' + msg.getTo() + ')';
  });
  MailApp.sendEmail(cfg.OWNER_EMAIL, '📸 KeepsakeDrop: ' + drafts.length + ' email(s) waiting in your drafts',
    lines.join('\n'));

  var cal = CalendarApp.getDefaultCalendar();
  var start = new Date();
  start.setHours(8, 30, 0, 0);
  var end = new Date();
  end.setHours(9, 0, 0, 0);
  var event = cal.createEvent('Send ' + drafts.length + ' KeepsakeDrop emails', start, end,
    { description: lines.join('\n') });
  event.addPopupReminder(0);
}
