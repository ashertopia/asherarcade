# KeepsakeDrop Apps Script backend

`Code.gs` receives photo uploads from `keepsakedrop.html` and saves them to a
Google Drive folder. It has to be deployed **from your Google account** — it
can't run from this repo.

## Option A — deploy with clasp (from your own machine)

One-time login (opens a browser for Google OAuth):

```bash
npm install -g @google/clasp
clasp login
```

Then enable the Apps Script API once at
https://script.google.com/home/usersettings, and from this `apps-script/`
folder:

```bash
clasp create --type webapp --title "KeepsakeDrop"
clasp push
clasp deploy --description "KeepsakeDrop v1"
```

`clasp deployments` prints the deployment ID; the web app URL is
`https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.

The `appsscript.json` manifest here already sets *Execute as: Me* and
*Who has access: Anyone*, so no dashboard clicking is needed.

To ship a code update later: `clasp push && clasp deploy` (or redeploy the
existing deployment ID so the URL — and printed QR codes — don't change).

## Option B — manual (no tooling, ~3 minutes)

Follow the numbered steps in the comment at the top of `Code.gs`.

## Which folders it accepts

One deployment serves every KeepsakeDrop event, and each event's folder ID is
in the QR code on its public table sign. Set these Script Properties
(Project Settings → Script Properties) so the script only writes to known
albums and stops taking uploads after each album's close date:

| Property | Value |
|---|---|
| `LOG_SHEET_ID` | the fulfillment script's `LOG_SHEET_ID` (the "KeepsakeDrop Fulfillment Log" Sheet). Every `folderId` in it is accepted through the end of its `closeDate` |
| `EXTRA_FOLDERS` | optional, for albums made by hand: `FOLDER_ID` or `FOLDER_ID=YYYY-MM-DD`, comma or newline separated. A dated entry **overrides** the log Sheet's `closeDate` for that folder (use it to extend or shorten one event's window); a bare `FOLDER_ID` only adds an unlogged folder and never removes a logged close date |

With neither set, the script accepts any folder ID as before. That keeps a
redeploy from breaking a live event link, but the protection is off until you
set them. Uploads are also checked by their first bytes (JPEG, PNG, GIF,
WebP, HEIC only) and rate-limited per folder; errors come back as short
codes (`closed`, `unknown folder`, `unsupported file`, `rate limited`,
`server error`) with details only in the execution log.

The script now reads a Sheet, so the first run after redeploying asks for
Google Sheets permission. Approve it from the editor (run any function once).

## After deploying (either option)

1. Create a Drive folder for the event, copy its folder ID.
2. For paid/done-for-you events, paste that ID into `LOCKED_FOLDER_ID` in
   `Code.gs` before deploying, so the script only ever writes to that folder.
3. Open `https://keepsakedrop.com/drop.html` with no URL parameters, enter the
   `/exec` URL and folder ID, and generate the guest link + QR code.
4. Test end-to-end from a phone before the event.
