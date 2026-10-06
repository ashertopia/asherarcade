# Christmas Party Game Night

A You Don't Know Jack–style party trivia game. The questions go up on the TV,
everyone answers on their phone, and nobody installs anything.

- **Host (TV/laptop):** `/host`. Pick a pack, get a 4-letter room code and a QR code.
- **Players (phones):** `/play`. Enter the code and a nickname, or scan the QR.
- **Landing page:** `/`

It's a standalone product and a standalone Vercel app inside the `asherarcade`
repo. Nothing outside this folder is deployed with it, and it is sold on its
own (no bundles with other Asher Arcade products).

## How a game plays

| Round | What happens | Scoring |
|---|---|---|
| 1. **Ho-Ho-Know-It-All** | Classic multiple choice, 20 seconds | Right answers score 500–1,000 (faster = more) |
| 2. **The Sleigh Ride** | Speed round, 10 seconds | Right answers score 250–1,000; wrong answers cost 250; no answer costs 0 |
| 3. **The All-In Finale** | Everyone wagers, then one hard question, 30 seconds | Right wins the wager, wrong (or no answer) loses it. Bet up to your score, or up to 1,000 if your score is lower |

- **Reveal:** after every question the TV shows the right answer, how many people picked each choice, the explanation (with scripture references in the Bible packs), and the live leaderboard with points earned and rank moves.
- **Standings:** shown after rounds 1 and 2.
- **Game length:** **Short, 10 questions** (5 classic + 4 speed + the finale, about 8 minutes; the default), Standard (13) or Marathon (18). Every pack can be played at every length.
- **End screen:** confetti, a podium and the full standings, then **Play again** (same pack, questions nobody has seen yet) or **New pack**. Players keep their seats either way.

**Host controls:**
- **Next / skip:** Space, Enter or →
- **Pause:** P
- **Mute:** M
- **Full screen:** F
- **Remove a player:** the ✕ on their name in the lobby
- **Narrator:** the 🗣 button turns on the browser's text-to-speech, which reads the host lines and questions aloud.

**Rooms of up to 100 players.** The TV shows the top 10 (with "…and 90 more");
every phone always shows that player's own **score and place** ("28th of
100") in its header, plus a place/score card after each question and their own
row under the top 5 on the phone's mini leaderboard. With more than 16
players, the TV shows a "57 of 100 locked in" progress bar instead of faces.

**Phones:** big tap targets, and each answer has its own color *and* shape. A
countdown bar and haptics on correct/wrong. If a phone sleeps, loses signal or
reloads, it rejoins the same seat with its score intact. The TV can be refreshed
too: it offers to resume the room.

**Sound:** every effect is synthesized in the browser (bells, ticks, buzzer,
fanfare, and a music-box "Jingle Bells" in the lobby, which is public domain).
There are no audio files. Use the 🔊 button or M to mute.

## Run it locally

```bash
cd party-game-night
npm install
npm run dev
```

The dev server prints something like:

```
Host (TV):     http://localhost:3000/host
Phones join:   http://192.168.1.20:3000/play
Dev unlock code (all packs): ALL-DEV1-XXXXXXXX
```

- **Phones:** phones on the same Wi-Fi can join for real; the QR code uses your LAN address.
- **Realtime:** locally there's no Ably key. A small built-in relay in `dev-server.js` does the same job.
- **Rehearsal mode:** `/host?speed=4` runs every timer 4× faster.

### Tests

```bash
npm test          # unit tests: rules, scoring, wagers, codes, API gating (16 tests)
npm run validate  # checks every pack (structure, 25+ questions, refs, lengths)
npm run e2e       # a full game: 1 TV + 3 phones in headless Chromium
npm run load      # a full 10-question game with 100 players (99 bots + 1 real phone)
```

The end-to-end test does the following, and saves screenshots to `test/screenshots/` (gitignored):
1. Unlocks with a code and opens a room.
2. Joins three players: one by QR link, two by typing the code. It also tries a duplicate nickname, which is rejected.
3. Plays all three round types. Bots answer: one always right, one random, one always taps A.
4. Takes one phone offline in the middle of the speed round and checks it rejoins.
5. Checks every phone shows the same final scores as the TV.
6. Presses "Play again", refreshes the TV and resumes the room, then ends the room.
7. Confirms a locked pack serves only its 5-question sample.

## Deploy to Vercel

1. **Create the project.** In Vercel, choose **Add New → Project** and import `ashertopia/asherarcade`.
   - Set **Root Directory** to `party-game-night`.
   - Set **Framework Preset** to *Other*. Leave the build command empty.
   - `vercel.json` already serves `public/` and the `api/` functions.
2. **Get an Ably key** (free): create an app at [ably.com](https://ably.com) → **API Keys** → copy the root key.
3. **Environment variables** (Settings → Environment Variables):

   | Variable | Required | What it is |
   |---|---|---|
   | `ABLY_API_KEY` | yes | The Ably key. It stays on the server; phones get short-lived tokens scoped to one room. |
   | `UNLOCK_SECRET` | yes | Any long random string, e.g. `openssl rand -hex 32`. Signs unlock codes. |
   | `UNLOCK_CODES` | no | Hand-made codes, e.g. `MERRY2026=all, CAROLS=christmas-songs` |
   | `PUBLIC_ORIGIN` | no | Your public URL, e.g. `https://gamenight.asherarcade.com`. Used for the QR code and Stripe redirects. |
   | `STRIPE_SECRET_KEY`, `STRIPE_PRICES` | later | Turns on the buy buttons ($9.99 pack, $24.99 Collection, $34.99 Group License). See [Selling packs](#selling-packs). |

4. **Deploy.** Optionally add a domain like `gamenight.asherarcade.com` (Settings → Domains).
5. **Mint yourself a code:** `UNLOCK_SECRET=<same value> npm run make-code -- all`

None of the repo's existing deploy-branch workflows watch this folder, so its
production branch can simply be `main`.

### Is Ably free?

Yes, for this. Ably's free plan (no credit card) allows **6 million messages a
month, 200 concurrent connections, 200 channels, 500 messages/second app-wide,
50 messages/second per channel**, and messages up to 64 KiB, billed in 5 KiB
chunks. Ably counts one message for each publish **and one for each phone it's
delivered to**, so the game is built around that:

- **Phones never hear each other.** The TV broadcasts on `pgn:ROOM`; phones send
  answers on four inbox channels (`pgn:ROOM:in0`–`in3`) that only the TV reads.
  An answer costs 2 messages, not 101.
- **TV updates are throttled.** Phase changes go out at once; joins, answers and
  wagers are folded into one update at most every 1.5 seconds.
- **Every update fits in one 5 KiB unit.** It carries names only for the top 10,
  plus a tiny `[score, …]` array per player, from which each phone works out its
  own place. With 100 players the largest update measured 4 KB.
- **100 near-simultaneous taps** are split across the four inboxes (about 25 per
  channel, under the 50/s limit), spread over a few hundred milliseconds, and
  retried if Ably pushes back. The delay costs no points: the answer time is
  measured on the phone at the tap.

**What a game costs:** a 10-question game with 100 players uses roughly
15,000 messages at normal speed (the load test measured about 7,000 with its
clock running 3× fast). That's about **400 full 100-player games a month**
on the free plan, and far more with smaller groups. A 20-person party uses
around 2,500.

**Limits to keep in mind:** 200 concurrent connections means one 100-player room
at a time is comfortable (phones that reload briefly hold two). Two big parties
running at the same moment could hit the cap. If that ever happens, Ably's paid
plans raise the limits; see [ably.com/pricing](https://ably.com/pricing).

### Why Ably for realtime

Vercel functions can't hold WebSocket connections open, so a game like this
needs a hosted realtime service. Ably was chosen because:

- **Phones that sleep:** it is built for exactly that. It keeps connection state and replays missed messages for about two minutes after a disconnect. On top of that, the game's own resync covers anything longer: a phone that comes back sends `join` with its saved id, and the host re-broadcasts the whole state.
- **Small setup:** the whole server side is one 20-line token function (`api/ably-token.js`). No database, no WebSocket server to run.
- **Free tier:** it is far beyond what a party needs (millions of messages a month; one game uses roughly 5–10k).
- **Privacy:** nothing persists. Ably channels keep no history by default, so no game data is stored anywhere except the host browser's own localStorage.

**How the game runs:**
- **Who's in charge:** the host's browser holds the game state and decides everything (timers, scoring).
- **What phones receive:** a public view of the state. The correct answer is left out until the reveal.
- **Answer timing:** phones report their own answer time, and the host clamps it to within 1.5 seconds of what it observed, so a slow network doesn't penalize anyone and nobody can fake a 0-second answer.

`public/js/realtime.js` hides the transport behind `connect / publish / close`.
Moving to another provider (Pusher, Supabase Realtime, PartyKit) means
rewriting that one file.

## Add a question pack

Drop a JSON file into `packs/`. The file name must match the pack's `id`.
That's it: the host's pack picker lists it on the next deploy. Copy
`packs/_TEMPLATE.json` to start (files starting with `_` are ignored).

```jsonc
{
  "id": "hanukkah",                 // lowercase-with-dashes, same as the file name
  "title": "Festival of Lights",
  "tagline": "Eight nights. Thirty questions.",
  "description": "Shown when the host taps the pack.",
  "collection": "Hanukkah",         // groups packs on the picker; also an unlock scope
  "theme": "hanukkah",              // christmas | hanukkah | newyear | birthday | anniversary
  "icon": "🕎",
  "audience": "Family-friendly",
  "order": 10,                      // sort position on the picker
  "price": { "usd": 9.99 },         // display only (single-pack price); Stripe sets the real price
  "free": false,                    // true = fully playable without a code
  "translation": "",                // e.g. "NIV" for scripture packs (shown on the card)
  "requireRefs": [],                // e.g. ["Scripture"]: every question must cite one
  "questions": [
    {
      "id": "hanukkah-01",
      "difficulty": "easy",         // easy | medium | hard (the finale uses a hard one)
      "category": "Traditions",     // optional; shown on the TV and for the final wager
      "q": "Question text (under 160 characters)",
      "choices": ["2 to 4 options", "each under 44 characters", "...", "..."],
      "answer": 0,                  // 0-based index of the right choice; shuffled at play time
      "reveal": "The fun fact shown after the answer (under 260 characters).",
      "refs": [{ "label": "Source", "ref": "Where it comes from" }],
      "sample": true                // mark exactly 5 for the free sample round
    }
  ]
}
```

**Rules the validator enforces** (`npm run validate`; invalid packs are skipped and logged):
- At least 25 questions, with unique ids.
- At least one hard question.
- 2–4 distinct choices per question, and a valid `answer` index.
- Every question has a `reveal`.
- Any `requireRefs` labels are present on every question.
- Text stays within the length limits above.

**For a new occasion:**
- **Theme:** set `theme` to one of the built-in color themes. To make a new one, add a block to the top of `public/css/style.css`; each theme is six color variables.
- **Scope:** give the pack its own `collection`, so one code can unlock every pack in that collection.

**Good-question checklist:**
- Wrong choices must be clearly wrong, not arguably right.
- No myths stated as fact.
- For scripture, use NIV or NLT only, cite exact verses, and only put words in quotation marks if they're the translation's exact wording.

### About the included packs

| Pack | Questions | Notes |
|---|---|---|
| Christmas Movies | 30 (10 easy / 12 medium / 8 hard) | G, PG or classic unrated family specials only |
| Christmas Songs & Carols | 30 (10 / 12 / 8) | Clean; lyric quotes from copyrighted songs are only a few words long |
| The Nativity Story | 30 (10 / 12 / 8) | Matthew 1–2 and Luke 1–2 only, NIV; every reveal cites its verse(s) |
| Prophecies of Christ | 30 (5 / 10 / 15), hard mode | Each reveal cites the OT prophecy and its NT fulfillment, NIV, and mostly sticks to passages the NT itself quotes |

Each pack was written and then fact-checked separately, question by question, and the corrections were applied. Still, give the Bible packs one read-through yourself before game night. They paraphrase rather than quote wherever the exact NIV 2011 wording couldn't be confirmed.

## Selling packs

| Product | Price | What it unlocks | Code scope |
|---|---|---|---|
| **Free sample** | free | 5 questions from any locked pack, one classic round | none |
| **Single pack** | **$9.99** | One pack: every question, all three rounds | the pack id, e.g. `NATIVITY` |
| **Christmas Collection** (default) | **$24.99** | All four packs: Movies, Songs & Carols, The Nativity Story, Prophecies of Christ | `CHRISTMAS` |
| **Group License** | **$34.99** | The same four packs, licensed for bigger gatherings (youth groups, Christmas programs, church and office parties): one code an organization's hosts can share for the season | `CHRISTMAS` |

The Group License plays exactly like the Collection. It differs in its
license copy and its own Stripe Price, not in a technical limit.

The Collection is the default everywhere a buy button appears:
- **Landing page (`/#pricing`):** three cards with the Collection featured.
- **Host's locked-pack dialog:** "Get the Christmas Collection · $24.99" first, then "Buy this pack · $9.99", then the Group License.
- **Pack picker:** a "🎁 Get all four packs · $24.99" button.
- **End of a free sample:** "Get the Christmas Collection".

Prices and blurbs live in one place, `lib/products.js`. The pages read them
from `/api/config`, so changing a price there changes every button. The
`price.usd` field in each pack's JSON is display-only and set to the
single-pack price.

**How packs are gated:**
- **Locked by default:** every pack is locked unless `"free": true`.
- **Free sample:** a locked pack offers a **free 5-question sample round** (the questions marked `"sample": true`). It plays as one classic round, then an end screen offering the Collection.
- **Server-side gating:** `api/pack.js` only returns a locked pack's sample questions, and `packs/` isn't publicly served, so the full question set can't be scraped from the page.

**Unlock codes** look like `CHRISTMAS-K7QX-3M9PTR8A`: scope, nonce, signature.
- **Scope:** one pack id (`NATIVITY`), the collection (`CHRISTMAS`), or `ALL`.
- **Signature:** an HMAC under `UNLOCK_SECRET`, so codes need no database and can't be forged.
- **Minting by hand:** `npm run make-code -- <scope> [count]`, e.g. `npm run make-code -- christmas 20` for 20 Collection codes (Etsy sales, giveaways, a church group).
- **Where they're saved:** the host enters codes under **🎟 Have a purchase code?**, and they're kept in that browser.
- **Sharing:** codes aren't tied to a device or a number of uses. Anyone with a code can unlock on any device, which is what lets a Group License be shared across an organization's hosts.

**Connecting Stripe Checkout** (the spot is marked in `api/checkout.js` and `api/claim.js`):
1. In Stripe, create three Products, each with a one-time Price in USD:
   - Single pack, $9.99
   - Christmas Collection, $24.99
   - Group License, $34.99
2. Set these in Vercel:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICES`, e.g.
     ```json
     {"pack":"price_…","christmas":"price_…","group":"price_…"}
     ```
     `pack` is used for every single pack. To give one pack its own Price, add its id as a key, e.g. `"nativity":"price_…"`.
3. Redeploy. The buy buttons switch on.

What happens at checkout:
- **Default product:** a request with no product buys the Collection.
- **The purchase:** Checkout records the product and its unlock scope on the Stripe session, then returns the buyer to `/host?claim=<session>`.
- **The code:** the server confirms with Stripe that the session is paid, then mints and saves the matching code (pack id, or `CHRISTMAS` for the Collection and the Group License). The code is shown so it can be used on other devices. No webhook is needed.

Until Stripe is set up, the buttons show the prices but stay disabled, with a
"Checkout opens soon" note. Codes keep working the whole time.

Test with `sk_test_` keys first. Before taking real money, add these products
to `policies.html` (refunds etc.).

## Privacy and retention

- **Personal data:** only nicknames (max 14 characters). No accounts, emails, IPs or analytics.
- **Room expiry:** rooms expire 24 hours after they're created. The host's browser closes the room and tells every phone, and phones forget their seat after 24 hours.
- **Where game state lives:** only in the host browser's localStorage (for resume) and in transit through Ably, which stores no message history by default.
- **Purchase codes:** saved only in the browser that entered them.

## Files

```
party-game-night/
  public/            static site (served by Vercel)
    index.html       landing page
    host.html        the TV
    play.html        phones
    css/style.css    all styles + occasion themes
    js/engine.js     game rules: rounds, scoring, wagers (pure; also runs in Node tests)
    js/host.js       TV controller: owns state, broadcasts, renders
    js/player.js     phone controller: join, answer, wager, reconnect
    js/realtime.js   Ably (prod) / local relay (dev) behind one interface; channel layout
    js/audio.js      synthesized sound effects, lobby music, narrator
    js/common.js     shared helpers: snow, lights, confetti, avatars
    vendor/          ably.min.js, qrcode.js (MIT)
  api/               Vercel functions: config, packs, pack, redeem, ably-token, checkout, claim
  lib/               pack loading/validation, unlock codes, HTTP helpers
  packs/             the question packs (not publicly served)
  scripts/           make-code.js, validate-packs.js
  test/              unit.test.js, e2e.js, load.js (100 players)
  dev-server.js      local server + realtime relay
```

## Known limits

- **Max players:** 100 per room. The TV shows the top 10; everyone's own place is on their phone.
- **Who controls the game:** the host browser is the authority. Closing the TV tab pauses the game until it's reopened and resumed.
- **Ably untested here:** Ably itself couldn't be reached from the sandbox this was built in. The production transport was checked against Ably's documented API, and its token endpoint is unit-tested, but the first real run on Vercel is the first live Ably test. Do one practice game before the party.
