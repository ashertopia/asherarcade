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

## After deploying (either option)

1. Create a Drive folder for the event, copy its folder ID.
2. For paid/done-for-you events, paste that ID into `LOCKED_FOLDER_ID` in
   `Code.gs` before deploying, so the script only ever writes to that folder.
3. Open `keepsakedrop.html` with no URL parameters, enter the `/exec` URL and
   folder ID, and generate the guest link + QR code.
4. Test end-to-end from a phone before the event.
