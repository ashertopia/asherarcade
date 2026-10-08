# Asher Arcade game orders

How a game order works:

```
order.html  ->  this Apps Script  ->  Drive folder per order (details + photos)
                                  ->  row in the "Asher Arcade Orders" Sheet
                                  ->  email to you
            ->  Stripe Payment Link for that game (order ID passed as client_reference_id)
            ->  back to order.html?paid=1 (thank-you screen)
```

Card payments only go through Stripe. Venmo is only used for tips on the free
games.

## 1. Deploy this script (about 5 minutes, one time)

1. Go to https://script.google.com and click **New project**. Name it
   "Asher Arcade Orders".
2. Delete what is in `Code.gs` and paste in this folder's `Code.gs`.
3. Project Settings (gear icon) -> check **Show "appsscript.json"** -> open
   it in the editor and paste in this folder's `appsscript.json`.
4. Back in the editor, pick the `setup` function in the toolbar and click
   **Run**. Approve the permissions (Drive, Sheets, send email as you). The
   log prints links to the new "Asher Arcade Orders" folder and Sheet.
5. **Deploy -> New deployment -> Web app**. Execute as: *Me*. Who has
   access: *Anyone*. Copy the `/exec` URL.
6. In `order.html`, paste that URL into `ORDER_SCRIPT_URL` near the bottom.

To ship a code change later, use **Deploy -> Manage deployments -> edit ->
New version** so the URL stays the same.

Optional Script Properties: `ORDERS_FOLDER_ID`, `ORDERS_SHEET_ID` (both
filled in by `setup`), and `OWNER_EMAIL` if order emails should go somewhere
other than the Google account that deployed the script.

## 2. Stripe Payment Links (done 2026-10-08, Scott Asher LLC account, live mode)

| Game | Price | Payment link | Product |
|---|---|---|---|
| Reveal & Announce Puzzle | $39 | https://buy.stripe.com/8x2eVffFOaBu4Mcb6OcMM01 | prod_VP9ZkHvzRPiUu4 |
| Drop & Catch | $79 | https://buy.stripe.com/eVq4gB3X6bFyfqQb6OcMM02 | prod_VP9ZtIUG5OAKg8 |
| Memory Match | $79 | https://buy.stripe.com/3cI3cxgJSgZSa6w2AicMM03 | prod_VP9aWgD07UoU5t |
| Whack-a-Mole | $99 | https://buy.stripe.com/3cIaEZ2T26le3I8ej0cMM04 | prod_VP9adrlZIwvFF8 |
| Endless Runner | $129 | https://buy.stripe.com/fZu7sN65e6le3I8ej0cMM05 | prod_VP9atTXBecQ96m |
| Wedding Platformer | $129 | https://buy.stripe.com/fZu5kF51afVO3I83EmcMM06 | prod_VP9amDIgG6Y7QD |
| Hosting Renewal | $19 | https://buy.stripe.com/14A3cxfFOfVO2E40sacMM07 | prod_VP9aMCgR5I4Fae |

Each link allows promotion codes (for the published discounts) and redirects to
`order.html?paid=1&product=KEY` after payment. To change a price, create a new
price and payment link in Stripe and update `STRIPE_LINKS` in `order.html`.

### Original setup notes (for reference)

In the Stripe dashboard: **Payment Links -> New**. Make one per game:

| Game | Price | `order.html` key |
|---|---|---|
| Drop & Catch | $79 | `drop-catch` |
| Memory Match | $79 | `memory-match` |
| Reveal & Announce Puzzle | $39 | `puzzle-reveal` |
| Whack-a-Mole | $99 | `whack-a-mole` |
| Endless Runner | $129 | `endless-runner` |
| Wedding Platformer | $129 | `platformer` |
| Hosting Renewal | $19 | `hosting` |

Original games are quoted, so they have no link.

For each link:

- Product name: the game name above. One-time price.
- **After payment** -> *Don't show confirmation page* -> redirect to
  `https://www.asherarcade.com/order.html?paid=1&product=KEY`
  (use the key from the table).
- Leave quantity adjustment off.

Paste each link into `STRIPE_LINKS` in `order.html`. Until a game has a link,
its order still goes through and the customer is told a secure Stripe payment
link is coming by email.

The order ID (`AA-yymmdd-XXXX`) rides along as the Stripe
`client_reference_id`, so search for it in Stripe to match a payment to its
Drive folder. Mark it paid in the Sheet's last column.

These payments also reach the KeepsakeDrop webhook on the same Stripe
account. It ignores payment links that are not the KeepsakeDrop link, quietly,
so nothing extra happens there.
