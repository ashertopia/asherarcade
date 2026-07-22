/**
 * Photo Drop — Google Apps Script backend
 * Saves guest photos from photodrop.html into a Google Drive folder.
 *
 * SETUP (one time, ~3 minutes):
 * 1. Go to https://script.google.com and create a New Project.
 * 2. Paste this entire file into Code.gs (replace what's there).
 * 3. Click Deploy → New deployment → type: Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web app URL (ends in /exec).
 * 5. Create a folder in Google Drive for the event's photos and copy its
 *    folder ID (the long string after /folders/ in the address bar).
 * 6. Open photodrop.html with no URL parameters — the setup screen will
 *    ask for the script URL and folder ID and generate the guest QR code.
 */

// Optional: lock this script to one folder so the folder ID in the guest
// URL can't be swapped for someone else's. Leave '' to accept the folder
// ID sent by the page.
var LOCKED_FOLDER_ID = '';

// Reject any single request bigger than ~8 MB of base64 (one compressed
// photo is typically 200-600 KB, so this is generous).
var MAX_BODY_CHARS = 8 * 1024 * 1024;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: 'empty request' });
    }
    if (e.postData.contents.length > MAX_BODY_CHARS) {
      return jsonOut({ ok: false, error: 'request too large' });
    }

    var body = JSON.parse(e.postData.contents);
    var folderId = LOCKED_FOLDER_ID || String(body.folder || '');
    if (!folderId) return jsonOut({ ok: false, error: 'missing folder' });

    var folder = DriveApp.getFolderById(folderId);
    var guest = String(body.name || 'Anonymous').replace(/[^\w\s&'.-]/g, '').slice(0, 60) || 'Anonymous';
    var photos = body.photos || [];
    var saved = 0;

    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (!p || !p.data) continue;
      var bytes = Utilities.base64Decode(p.data);
      var stamp = Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd-HHmmss');
      var original = String(p.filename || 'photo.jpg').replace(/[^\w.-]/g, '_').slice(0, 80);
      var blob = Utilities.newBlob(bytes, p.type || 'image/jpeg', guest + '_' + stamp + '_' + original);
      folder.createFile(blob);
      saved++;
    }

    return jsonOut({ ok: true, saved: saved });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
