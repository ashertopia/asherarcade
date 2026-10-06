# Christmas Party Game Night

A You Don't Know Jack–style party trivia game. The questions go up on the TV,
everyone answers on their phone, and nobody installs anything.

- **Host (TV/laptop):** `/host`. Pick a pack, get a 4-letter room code and a QR code.
- **Players (phones):** `/play`. Enter the code and a nickname, or scan the QR.
- **Landing page:** `/`

It's a standalone Vercel app inside the `asherarcade` repo. Nothing outside this
folder is deployed with it, and it doesn't touch asherarcade.com or KeepsakeDrop.

## How a game plays

| Round | What happens | Scoring |
|---|---|---|
| 1. **Ho-Ho-Know-It-All** | Classic multiple choice, 20 seconds | Right answers score 500–1,000 (faster = more) |
| 2. **The Sleigh Ride** | Speed round, 10 seconds | Right answers score 250–1,000; wrong answers cost 250; no answer costs 0 |
| 3. **The All-In Finale** | Everyone wagers, then one hard question, 30 seconds | Right wins the wager, wrong (or no answer) loses it. Bet up to your score, or up to 1,000 if your score is lower |

- **Reveal:** after every question the TV shows the right answer, how many people picked each choice, the explanation (with scripture references in the Bible packs), and the live leaderboard with points earned and rank moves.
- **Standings:** shown after rounds 1 and 2.
- **Game length:** Quick (4+4+1 questions), Standard (6+6+1) or Marathon (9+8+1).
- **End screen:** confetti, a podium and the full standings, then **Play again** (same pack, questions nobody has seen yet) or **New pack**. Players keep their seats either way.

**Host controls:**
- **Next / skip:** Space, Enter or →
- **Pause:** P
- **Mute:** M
- **Full screen:** F
- **Remove a player:** the ✕ on their name in the lobby
- **Narrator:** the 🗣 button turns on the browser's text-to-speech, which reads the host lines and questions aloud.

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
   | `STRIPE_SECRET_KEY`, `STRIPE_PRICES` | later | Turns on the Buy button. See [Selling packs](#selling-packs). |

4. **Deploy.** Optionally add a domain like `gamenight.asherarcade.com` (Settings → Domains).
5. **Mint yourself a code:** `UNLOCK_SECRET=<same value> npm run make-code -- all`

This folder is not covered by the KeepsakeDrop deploy-branch workflow, so its
production branch can simply be `main`.

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
  "price": { "usd": 4.99 },         // display only; Stripe sets the real price
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

**How packs are gated now:**
- **Locked by default:** every pack is locked unless `"free": true`.
- **Free sample:** a locked pack offers a **free 5-question sample round** (the questions marked `"sample": true`). It plays as one classic round, then an end screen with an "Unlock the full pack" button.
- **Server-side gating:** the gate is enforced on the server. `api/pack.js` only returns a locked pack's sample questions, and `packs/` isn't publicly served. So the full question set can't be scraped from the page.

**Unlock codes** look like `CHRISTMAS-K7QX-3M9PTR8A`: scope, nonce, signature.
- **Scope:** `ALL`, a collection (`CHRISTMAS`), or one pack id (`NATIVITY`).
- **Signature:** an HMAC under `UNLOCK_SECRET`, so codes need no database and can't be forged.
- **Minting:** `npm run make-code -- <scope> [count]`, e.g. for Etsy sales, giveaways or church groups.
- **Where they're saved:** the host enters codes under **🎟 Have a purchase code?**, and they're kept in that browser.

**Connecting Stripe Checkout:** the spot is marked in `api/checkout.js` and `api/claim.js`.
1. In Stripe, create a Product + Price for each thing you sell (one pack, a collection bundle, or "all").
2. Set `STRIPE_SECRET_KEY` and `STRIPE_PRICES`, e.g. `{"christmas":"price_123","nativity":"price_456"}`. Keys are scopes.
3. Redeploy. The locked-pack dialog now shows **Buy full pack**. Checkout returns the buyer to `/host?claim=<session>`, the server confirms with Stripe that it's paid, and it mints and saves their code. The code is shown so they can use it on another device. No webhook is needed.

Test with `sk_test_` keys first. Before taking real money, add the products to
`policies.html` (refunds etc.), matching how `MONETIZATION.md` treats the other
products.

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
    js/realtime.js   Ably (prod) / local relay (dev) behind one interface
    js/audio.js      synthesized sound effects, lobby music, narrator
    js/common.js     shared helpers: snow, lights, confetti, avatars
    vendor/          ably.min.js, qrcode.js (MIT)
  api/               Vercel functions: config, packs, pack, redeem, ably-token, checkout, claim
  lib/               pack loading/validation, unlock codes, HTTP helpers
  packs/             the question packs (not publicly served)
  scripts/           make-code.js, validate-packs.js
  test/              unit.test.js, e2e.js
  dev-server.js      local server + realtime relay
```

## Known limits

- **Max players:** 20 per room. The TV layouts are tuned for that.
- **Who controls the game:** the host browser is the authority. Closing the TV tab pauses the game until it's reopened and resumed.
- **Ably untested here:** Ably itself couldn't be reached from the sandbox this was built in. The production transport was checked against Ably's documented API, and its token endpoint is unit-tested, but the first real run on Vercel is the first live Ably test. Do one practice game before the party.
