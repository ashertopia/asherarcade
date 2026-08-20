# KeepsakeDrop order fulfillment (Apps Script)

Replaces the two Claude-Code Routines ("KeepsakeDrop order watcher" and
"KeepsakeDrop morning comms digest") with a zero-LLM pipeline:

```
Stripe (checkout.session.completed)
  -> this script's doPost webhook
  -> Drive folder + Read Me doc + table sign PDF (via the sign-pdf Vercel endpoint)
  -> Gmail draft to the customer
  -> Calendar reminder for Scott
  -> a row in the "KeepsakeDrop Fulfillment Log" Sheet (dedup + handoff/last-chance tracking)
```

A daily trigger (`dailyCheck`) then handles the +31 day handoff email, the
+86 day last-chance notice, and nudges about any unsent KeepsakeDrop Gmail
drafts — all deterministic, no memory dependency.

## Why a URL token instead of a signature

Apps Script's `doPost(e)` does not expose incoming HTTP headers, so the
script can't read Stripe's `Stripe-Signature` header and verify the usual
HMAC. Instead, the Stripe webhook URL itself carries a shared secret as a
query parameter (`?token=...`), which *is* visible via `e.parameter`. This
is a well-known workaround for this specific Apps Script limitation. It's
proportionate here — a forged request can only create fulfillment artifacts
(folder/doc/draft), not move money.

## One-time setup

1. **Create and push the project** (from this folder):
   ```bash
   npm install -g @google/clasp
   clasp login          # opens a browser for Google OAuth, one time
   clasp create --type webapp --title "KeepsakeDrop Fulfillment" --rootDir .
   clasp push
   clasp deploy --description "KeepsakeDrop Fulfillment v1"
   ```
   `clasp deployments` prints the deployment ID; the web app URL is
   `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.

2. **Set Script Properties** — in the Apps Script editor: Project Settings
   (gear icon) → Script Properties → add each of these:

   | Property | Value |
   |---|---|
   | `WEBHOOK_TOKEN` | a long random string (Claude generated one for this — ask for it) |
   | `SIGN_PDF_ENDPOINT` | `https://keepsakedrop.com/api/sign-pdf` |
   | `SIGN_PDF_API_KEY` | must match the `SIGN_PDF_API_KEY` env var set in the Vercel `keepsakedrop` project |
   | `GUEST_SCRIPT_EXEC_URL` | the **existing** photo-upload script's `/exec` URL (the one already in `apps-script/`, ends in `AKfycbwY.../exec`) |
   | `README_TEMPLATE_DOC_ID` | `1yw2HkRMhBbLqTnmH130NAwbceWZm0lmH5x_yq59rfp0` (tokenized Read Me template — separate from Tinlee's real doc) |
   | `OWNER_EMAIL` | your email, for the "2 clicks left" / digest notifications |
   | `PAYMENT_LINK_ID` | optional, defaults to `plink_1U16AQRyTAXcMvg49vhhR39i` |
   | `SITE_URL` | optional, defaults to `https://keepsakedrop.com` |

   (`LOG_SHEET_ID` fills itself in automatically on first run — leave blank.)

3. **Sanity-check config**: in the editor, select `checkConfig` in the
   function dropdown, click Run, check the execution log.

4. **Install the daily trigger**: select `installDailyTrigger`, click Run.
   Approve the Google permission prompts the first time (Drive, Docs,
   Sheets, Gmail, Calendar, external requests).

5. **Test without Stripe**: select `testFulfillOrder`, click Run. This
   fires the exact same pipeline with a fake order and creates a real
   ("Fake Test Party — KeepsakeDrop Album") folder/doc/PDF/draft/event so
   you can check the output before any real money is involved. Delete the
   test folder afterward if you'd like.

6. **Hand the `/exec` URL back** so the real Stripe webhook can be wired up
   (`https://api.stripe.com/v1/webhook_endpoints`, event
   `checkout.session.completed`, URL =
   `<your exec URL>?token=<WEBHOOK_TOKEN>`) — either paste it in chat or
   set it up yourself in the Stripe Dashboard under Developers → Webhooks.

## Files

- `Code.gs` — webhook entry point (`doPost`), config, order field extraction
- `Fulfillment.gs` — folder/doc/PDF/draft/calendar creation for a new order
- `Sheet.gs` — the fulfillment log (dedup + due-date tracking)
- `Digest.gs` — `dailyCheck()`: handoff/last-chance follow-ups + unsent-draft nudges
- `Setup.gs` — one-time helpers: `installDailyTrigger`, `checkConfig`, `testFulfillOrder`

## Redeploying after a code change

```bash
clasp push && clasp deploy
```
(or redeploy the existing deployment ID so the `/exec` URL doesn't change).
