# Asher Arcade — Monetization Plan

**Goal: $150/month minimum, starting now.** That's roughly one $199 custom build
every 6 weeks, or 2 Photo Drop events per month, or any mix below.

## Honest assessment of what we have

**Sellable today (the short list):**

1. **Photo Drop** (`photodrop.html`) — the strongest product. Guest photo
   collection for weddings/grads with a QR code, photos land in the host's
   Google Drive. Zero marginal cost per event, easy to explain, and every
   competitor (The Guest, POV, Guestpix) charges $50–$250 per event. As of this
   update it has a real host setup screen, QR generation, and reliable
   per-photo uploads, plus a deployable Apps Script backend
   (`photodrop-apps-script.gs`).
2. **Quiz Builder** (`quiz-builder.html`) — the "graduation quiz" idea, live.
   Free self-serve tier (up to 10 questions, share by link/QR) that works as a
   lead magnet, with the $199 custom tier as the paid upgrade.
3. **Custom game commissions** — the existing $79/$199/$299 tiers. Real but
   slow; each sale takes hands-on work. The portfolio (Bragg Racing, Mag's
   Skate, Tinlee's Catch, puzzles) is genuinely good proof-of-work.

**Not sellable / don't invest further:**

- The generic arcade games (Bubble Drift, Pulse Tap, Zen Tracer, etc.) — fun
  portfolio pieces, but nobody pays for generic browser games in 2026. Keep
  them as free demos that funnel to the contact form.
- Pursuit and Walk the Word are personal/ministry projects, not products.

## What was broken in the funnel (now fixed)

- **No way to pay.** Every page ended at a contact form. → Added a $40 Venmo
  deposit button to the form-success state on all five pages with forms.
- Photo Drop had **no QR generation and no host setup** — the core pitch didn't
  exist in code. → Built both, plus the backend script.
- The trivia page's demo button was disabled. → Now links to the Quiz Builder.
- Broken links (`Special_Announcement_S-A.html`), missing Google Analytics on
  3 of 7 landing pages, phantom sitemap entry. → Fixed.

## Pricing (updated after market research, July 2026)

Verified market facts that shape this:
- **Wedibox** charges $49 (photos) / $79 (all-in-one with RSVP + website +
  seating) — bundling, not a higher photo price, is the proven upsell path.
- **PixBearer** offers free (100 uploads/10 GB) + $19 one-time unlimited with
  the same "your own Google Drive" angle — so that alone isn't a moat.
  Compete on done-for-you service and bundles instead.
- **Etsy** has 4,000+ listings for QR wedding photo-share *sign templates* at
  ~$3.50–$15 (mostly under $8) — big buyer pool, but they're just printable
  signs with no photo service behind them. A listing that includes a
  *working* QR service stands out in that crowd.

| Product | Price | Notes |
|---|---|---|
| Photo Drop event (site direct) | **$39** | Done-for-you setup: Drive folder, script, printable QR sign PDF |
| Etsy listing: QR sign + working photo service | **$29–35** | Personalized item; sale completes on Etsy (keeps it policy-safe) |
| Event bundle | **$79** | Photo Drop + custom quiz + reskinned game favor — mirrors Wedibox's proven all-in-one tier |
| Custom quiz (from builder lead) | $199 | Existing Memory tier |
| Full custom game | $79–$299 | Existing tiers, unchanged |

Deposits via Venmo now; set up **Stripe Payment Links** (free, no code needed —
create in the Stripe dashboard, paste URLs where the Venmo links are) as soon
as possible so cards work too.

## 30-day actions (in order)

1. **Deploy the Photo Drop Apps Script** (instructions at the top of
   `photodrop-apps-script.gs`), run one real test event end-to-end.
2. **Create Stripe Payment Links** for $49 / $99 / $199 and swap them in.
3. **List Photo Drop where couples already shop:** The Knot and WeddingWire
   vendor listings (free tiers exist), local Facebook wedding/event groups,
   r/weddingplanning (be helpful, not spammy). "QR photo collection for $49
   flat, no subscription, photos go straight to YOUR Google Drive" is a real
   differentiator — every competitor holds photos hostage on their platform.
4. **Push the Quiz Builder for grad season and holidays:** share it free in
   parenting/grad Facebook groups. Every quiz made shows the $199 upsell on
   its end screen.
5. **Ask past customers** (Bragg, Mag's, Tinlee families) for a referral and a
   testimonial with photo. Word of mouth is the entire growth channel at this
   scale.

## Path to $150/mo

- 3 Photo Drop events ($49 × 3) ≈ $150 — the realistic base case.
- OR 1 custom build ($199+) covers a month with room to spare.
- Weddings + grads + baby showers + church events means year-round demand.

## Why not an Android app (researched, July 2026)

Verified against Google's own policy pages: a new personal Play developer
account cannot publish until it runs a closed test with **12 testers opted in
continuously for 14 days**, then separately applies for production access —
2–4 weeks before revenue is even possible. The only bypass is an organization
account requiring business verification (D-U-N-S). On top of that, freemium
apps convert at roughly 1–10% (medians ~2–3%), so a $5–15 unlock needs
hundreds of downloads per month to clear $150 — with zero audience and no ad
budget, that's the slowest possible route. Web-first wins; consider a PWA
wrapper later only if mobile install friction proves real, and Play Store
last, if ever.

## Later (only after first revenue)

- Stripe checkout embedded in the site (replaces Venmo entirely).
- Photo Drop live slideshow view (photos appear on a projector as guests
  upload) — competitors charge $100+ extra for this; it's a ~1-day build.
- Per-event leaderboard scoping for the game favors (currently one shared
  global leaderboard per Apps Script).
