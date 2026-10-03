# Asher Arcade — Monetization Plan

*Last updated 2026-08-20. If a number here disagrees with the site, one of them
is stale and both should be checked — but `policies.html` outranks this file for
anything about retention, refunds, or hosting periods.*

**Goal: $150/month minimum.** At current prices that is four KeepsakeDrop
bookings, two event bundles, or one custom game.

## Where things actually live

| Thing | Where it runs | Source |
|---|---|---|
| Asher Arcade marketing site | `asherarcade.com` — GitHub Pages, deploys from `main` | repo root |
| KeepsakeDrop product + app | `keepsakedrop.com` — Vercel project `keepsakedrop` | `keepsakedrop-site/` |
| Sign-to-PDF endpoint | `keepsakedrop.com/api/sign-pdf` | `keepsakedrop-site/api/sign-pdf.js` |
| Guest photo backend | Google Apps Script | `apps-script/` |
| Order fulfillment | Google Apps Script | `apps-script-fulfillment/` |

Two things about the Vercel project that are easy to get wrong:

- Its **production branch is `claude/keepsakedrop-review-r0k9md`, not `main`.**
  A push to `main` builds a *preview*, so on its own it does not move
  keepsakedrop.com. **You do not have to do anything about this** —
  `.github/workflows/sync-keepsakedrop-deploy-branch.yml` watches `main` for
  changes under `keepsakedrop-site/` and moves the deploy branch to match, so
  merging to `main` ships the site. The workflow copies `main`'s tree verbatim
  onto a fast-forward commit, so the branch cannot drift and there is no force
  push and no merge conflict to resolve. If Production Branch is ever repointed
  at `main` in Vercel's Git settings, delete the workflow.
- Its **root directory is `keepsakedrop-site/`**, so nothing outside that folder
  is deployed. The sign-PDF function used to sit at the repo root and was
  therefore never built at all — `keepsakedrop.com/api/sign-pdf` answered 404
  from the day it was written. It lives at `keepsakedrop-site/api/sign-pdf.js`
  now, with `package.json` and `vercel.json` beside it, and the endpoint
  responds as of 2026-08-21. Anything else the site needs to serve has to live
  under `keepsakedrop-site/` too.

`asherarcade.com/keepsakedrop.html` and `/photodrop.html` are **redirects only**.
They forward to `keepsakedrop.com/drop.html` carrying the query string, because
QR signs printed before the move encode the old URL with the event on it. Do not
put content back on those two files.

## Pricing

| Product | Price | What it is |
|---|---|---|
| KeepsakeDrop event | **$39** | Done-for-you setup: Drive folder, Apps Script, printable QR sign |
| Etsy listing: QR sign + working photo service | **$29–35** | Personalized item; the sale completes on Etsy, which keeps it policy-safe |
| The Occasion (event bundle) | **$89** | KeepsakeDrop + a custom quiz + a puzzle reveal. All templated, no bespoke art |
| The Memory (custom game) | **$199–$299** | The only tier with original artwork. $199 reskins a mechanic we have, $299 builds a new one |

Two rules that keep this coherent:

1. **No bespoke artwork below $199.** The bundle used to include a reskinned
   game favor, which meant a customer could get a game for $79 and never look at
   the $199 tier. Artwork is where the hours go, so it has to sit above the
   bundle.
2. **KeepsakeDrop is the cheapest way in, and it is priced on its own.** Do not
   fold it into a higher tier and call the difference value.

Discounts go to military, veterans, first responders, teachers and homeschool
families. **Do not advertise a discount limited to Christian churches or
ministries.** A published religious test in a commercial offer is a real legal
exposure, and it was live on three pages until 2026-08-20 — including inside a
FAQPage block, which is the version Google can surface. A discount to a
particular congregation is a private, case-by-case decision, not published copy.
This still needs a lawyer's read.

## Market context (verified July 2026)

- **Wedibox** charges $49 (photos) / $79 (all-in-one with RSVP + website +
  seating) — bundling, not a higher photo price, is the proven upsell path.
- **PixBearer** offers free (100 uploads/10 GB) plus $19 one-time unlimited with
  the same "your own Google Drive" angle, so that alone is not a moat. Compete
  on done-for-you service and bundles instead.
- **Etsy** has 4,000+ listings for QR wedding photo-share *sign templates* at
  roughly $3.50–$15, mostly under $8. Big buyer pool, but they are printable
  signs with no photo service behind them. A listing that includes a *working*
  QR service stands out in that crowd.

## Taking money

**Stripe Payment Links.** The live account (Scott Asher LLC) is connected and
there is exactly one live payment link: `buy.stripe.com/5kQaEZctC9xq3I8b6OcMM00`,
the flat $39 KeepsakeDrop package. `keepsakedrop-site/book.html` points at it and
passes the event type and colour choice through as `client_reference_id`
(e.g. `wedding_blush`, or `event_cFCD1FF` for a custom hex). Checkout collects
event name, event date, and the album's Google email as custom fields.

The link **does** accept promo codes, and one 100%-off code has been used: the
Tinlee Belle album on 2026-08-04. That is why it shows as a $0 order and not a
sale. As of 2026-08-20 it is the only KeepsakeDrop checkout that has ever run,
so nothing below has been exercised by a paying customer yet.

**Venmo is gone.** Removed site-wide on 2026-08-20: the $40 deposit button, the
tip modal, and the deep links. Do not reintroduce it. If a payment path is
needed before Stripe is live, ask first.

## What is sellable

1. **KeepsakeDrop** — the strongest product. Zero marginal cost per event, easy
   to explain, and competitors charge $50–$250. It has a host setup screen, QR
   generation, colour themes, per-photo uploads with retry, and a deployable
   Apps Script backend.
2. **Quiz Builder** (`quiz-builder.html`) — free self-serve tier, up to 10
   questions, shared by link or QR. Works as a lead magnet with the $199 custom
   tier as the paid upgrade.
3. **Custom game commissions** — real but slow; each sale takes hands-on work.
   The portfolio (Tinlee's Catch, Mag's Skate, Bragg Racing) is genuinely good
   proof-of-work, and it now leads the homepage instead of sitting below three
   generic sections.

**Not worth further investment:** the generic arcade games (Bubble Drift, Pulse
Tap, Zen Tracer). Keep them as free demos that funnel to the contact form.
Pursuit and Walk the Word are personal and ministry projects, not products.

## Next actions

1. **Deploy the KeepsakeDrop Apps Script** (see `apps-script/README.md`) and run
   one real test event end to end.
2. **Recreate the Stripe Payment Links in live mode** and swap the URLs.
3. **List KeepsakeDrop where couples already shop:** The Knot and WeddingWire
   vendor listings (free tiers exist), local Facebook wedding and event groups,
   r/weddingplanning — be helpful, not spammy. "KeepsakeDrop, $39 flat, no
   subscription, and the photos go straight to YOUR Google Drive" is a real
   differentiator, because every competitor holds photos on their own platform.
4. **Push the Quiz Builder for grad season and holidays.** Every quiz made shows
   the $199 upsell on its end screen.
5. **Ask past customers** (the Bragg, Mag's and Tinlee families) for a referral
   and a testimonial with a photo. Word of mouth is the entire growth channel at
   this scale.
6. **Have a lawyer read the discount wording** before relying on it.

## Path to $150/mo

- Four separate KeepsakeDrop bookings in a month ($39 × 4) = $156. Four
  customers, not a multi-event package — we do not sell one.
- Or two event bundles ($89 × 2) = $178.
- Or one custom build ($199+), which covers a month with room to spare.
- Weddings, grads, baby showers and church events mean year-round demand.

## Why not an Android app (researched July 2026)

Verified against Google's own policy pages: a new personal Play developer
account cannot publish until it runs a closed test with **12 testers opted in
continuously for 14 days**, then separately applies for production access. That
is 2–4 weeks before revenue is even possible. The only bypass is an organization
account requiring business verification (D-U-N-S). On top of that, freemium apps
convert at roughly 1–10%, medians around 2–3%, so a $5–15 unlock needs hundreds
of downloads a month to clear $150. With no audience and no ad budget that is
the slowest possible route. Web-first wins. Consider a PWA wrapper later only if
mobile install friction proves real, and the Play Store last, if ever.

## Later (only after first revenue)

- Stripe checkout embedded in the site.
- KeepsakeDrop live slideshow view, where photos appear on a projector as guests
  upload. Competitors charge $100+ extra for this and it is roughly a one-day
  build.
- Per-event leaderboard scoping for the game favors. Right now there is one
  shared global leaderboard per Apps Script.
