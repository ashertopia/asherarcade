# KeepsakeDrop order fulfillment (Apps Script)

Replaces the two Claude-Code Routines ("KeepsakeDrop order watcher" and
"KeepsakeDrop morning comms digest") with a zero-LLM pipeline:

```
Stripe (checkout.session.completed / async_payment_succeeded)
  -> keepsakedrop.com/api/stripe-webhook (verifies Stripe-Signature, answers Stripe)
  -> this script's doPost (?token=WEBHOOK_TOKEN)
  -> Drive folder + Read Me doc + table sign PDF (via the sign-pdf Vercel endpoint)
  -> Gmail draft to the customer
  -> Calendar reminder for Scott
  -> a row in the "KeepsakeDrop Fulfillment Log" Sheet (dedup + handoff/last-chance tracking)
```

A daily trigger (`dailyCheck`) then handles the +31 day handoff email, the
+86 day last-chance notice, and nudges about any unsent KeepsakeDrop Gmail
drafts — all deterministic, no memory dependency.

## How Stripe reaches this script

Apps Script's `doPost(e)` can't read HTTP headers, so it can't check Stripe's
`Stripe-Signature` header itself. It also answers every POST with a 302
redirect to `script.googleusercontent.com`, and Stripe counts any redirect
as a failed delivery ("We consider redirect responses to webhook requests as
failures", docs.stripe.com/webhooks). Pointed straight at this script, Stripe
would mark every order failed and keep retrying.

So Stripe calls `keepsakedrop-site/api/stripe-webhook.js` on Vercel instead.
That function checks the signature with `STRIPE_WEBHOOK_SECRET`, forwards the
verified event here with `?token=<WEBHOOK_TOKEN>`, and answers Stripe with a
2xx code. The token stays as a second check between Vercel and this script.

What the script does with each event:

| Event | Result |
|---|---|
| `checkout.session.completed`, `payment_status` `paid` (including 100%-off promo orders, which arrive as `paid`) or `no_payment_required` | fulfilled |
| `checkout.session.completed`, `unpaid` (delayed payment method) | owner emailed; fulfilled when `checkout.session.async_payment_succeeded` arrives |
| a different payment link (e.g. PackLocker checkouts on the same Stripe account) | ignored **quietly**: answered OK, no owner email (only an execution-log line) |
| `checkout.session.async_payment_failed`, other event types, duplicate sessions | not fulfilled; **owner emailed** with the reason |
| paid, but the event date can't be read or the event name is missing | **held** on the "Held orders" tab of the log Sheet; owner emailed. Fix the date (and the name if needed) there, then run `releaseHeldOrders` (the 8 AM `dailyCheck` also runs it). A row that fails to release is marked `error` and the owner is emailed; check for half-made folders/drafts, then set it back to `held` |

Orders are de-duplicated by Stripe session ID under a script lock. If a Drive
folder with the same album name already exists, the new folder gets a
suffix and the owner email points it out.

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

   > **`SIGN_PDF_API_KEY` has to exist in two places or the endpoint refuses
   > everything.** Set the same value as an environment variable named
   > `SIGN_PDF_API_KEY` in the Vercel `keepsakedrop` project (Settings →
   > Environment Variables, Production), and as a Script Property here. With no
   > variable set on Vercel the endpoint answers 401 to every request, including
   > correctly-signed ones, because the handler treats an unset key as a closed
   > door. Redeploy after adding it — Vercel only injects environment variables
   > at build time.
   >
   > If it does fail, fulfillment still completes: `attachSignPdf_` throws, the
   > run records `signPdfOk: false`, and the owner notification says to add the
   > sign by hand. Note that the customer delivery draft is written either way
   > and tells them the sign is in their folder, so read the owner email before
   > sending the draft.
   | `PAYMENT_LINK_ID` | optional, defaults to `plink_1U16AQRyTAXcMvg49vhhR39i` — must be the live link's ID or every order is ignored, **silently** (other-link events don't email). Check it with `checkConfig` |
   | `SITE_URL` | optional, defaults to `https://keepsakedrop.com` (sign-pdf only accepts that origin unless `SIGN_PDF_ALLOWED_ORIGINS` is set on Vercel) |
   | `AUTO_SHARE_ALBUM` | optional; `true` shares each new album folder with the customer's album email automatically (Google sends them its usual "shared a folder" email). Unset = the old manual step |

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

6. **Wire up Stripe through the Vercel relay.** In the Stripe Dashboard
   (Developers → Webhooks, live mode) add an endpoint with URL
   `https://keepsakedrop.com/api/stripe-webhook` and events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`. Copy its signing secret
   (`whsec_...`). In the Vercel `keepsakedrop` project set
   `STRIPE_WEBHOOK_SECRET` (that secret), `FULFILLMENT_SCRIPT_URL` (this
   script's `/exec` URL) and `FULFILLMENT_TOKEN` (the same value as
   `WEBHOOK_TOKEN`), then redeploy. Don't point Stripe at the `/exec` URL
   directly (see "How Stripe reaches this script").

7. **Give the guest-upload script the log Sheet.** After the first run,
   copy `LOG_SHEET_ID` from this project's Script Properties into the
   guest-upload project's Script Properties (see `apps-script/README.md`),
   so that script only accepts album folders listed in the log.

## Files

- `Code.gs` — webhook entry point (`doPost`), event routing, config, order field + date parsing
- `Fulfillment.gs` — folder/doc/PDF/draft/calendar creation for a new order
- `Sheet.gs` — the fulfillment log (dedup + due-date tracking)
- `Digest.gs` — `dailyCheck()`: handoff/last-chance follow-ups (sent on or after their day, never once the album's delete date has arrived), held-order release, unsent-draft nudges
- `Setup.gs` — one-time helpers: `installDailyTrigger`, `checkConfig`, `testFulfillOrder`

## Redeploying after a code change

```bash
clasp push && clasp deploy
```
(or redeploy the existing deployment ID so the `/exec` URL doesn't change).

The manifest's `oauthScopes` now includes `https://mail.google.com/` (needed by
`GmailApp` drafts) and `https://www.googleapis.com/auth/script.send_mail`
(needed by `MailApp`). After pushing, run any function from the editor once
(e.g. `checkConfig`) and approve the new permissions, then re-run
`installDailyTrigger` so the trigger uses them.

Sanity tests for the date parsing and event routing: `node keepsakedrop-tests/run.js`
from the repo root.
