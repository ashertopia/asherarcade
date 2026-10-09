# Asher Arcade Trivia: leaderboard backend

```
guest's phone: trivia.html?g=<id>  ->  this Apps Script  ->  "Asher Arcade Trivia Scores" Sheet (one tab per game)
                                    <-  answer key read from trivia/games/<id>.json on the site
```

One deployment serves **every** trivia game. You deploy it once. After that,
each customer's game is just one JSON file in `trivia/games/` (made with
`trivia-studio.html`).

## Live deployment

Deployed 2026-10-09 as "Asher Arcade Trivia" (ashertopia@gmail.com):
`https://script.google.com/macros/s/AKfycbycNvo4qnhR4vNiVgaNKIcgXZvvjiPEIVLy7m-5jJVsRG588BCo7cHCr9PTEhhVwY27/exec`

Trivia Studio fills this in for every new game. To ship a code change, use
Deploy > Manage deployments > edit > New version so this URL stays the same.

## What it does

- **Leaderboard.** `GET ?action=board&game=<id>` returns the top 100. Players
  see it after their game and from "See the leaderboard" on the start screen.
  While it is open on a phone it refreshes every 15 seconds, so it stays live as
  family members finish from wherever they are.
- **One try per person.** A player is registered when they tap *Let's Play*, not
  when they finish, so quitting halfway doesn't get them a second try.
  - **Per phone:** a phone that finished can't start again, even under a new name.
  - **Per name:** a name (ignoring case, spaces and punctuation) can only be used
    on one phone.
  - If a phone reloads or loses signal mid-game, it picks up where it left off.
    The question that was on screen counts as missed.
- **Server-side scoring.** The phone sends only which answer was picked and how
  long it took. The script scores it from the answer key in the game's JSON, so
  nobody can post a made-up score. Times are capped at the question's clock.
- **Closing date.** If the game JSON has `"closesAt": "2027-06-30"`, new
  players are turned away after that day (script time zone). Anyone already
  mid-game can still finish.

### Why not block by IP address?

Apps Script never sees the player's IP address. Blocking by IP would also be a
bad idea at a party: everyone on the venue Wi-Fi shares one IP, so the first
guest to finish would lock out the whole room. Phone + name is the practical
limit. Someone determined could still play twice by switching to a private
browser tab *and* using a different name. If that happens, hide the extra row
(below).

## Deploy (about 5 minutes, one time)

1. Go to https://script.google.com and click **New project**. Name it
   "Asher Arcade Trivia".
2. Replace `Code.gs` with this folder's `Code.gs`.
3. Project Settings (gear) -> check **Show "appsscript.json"**, then paste in
   this folder's `appsscript.json`.
4. In the editor, pick `setup` and click **Run**. Approve the permissions
   (Sheets, and fetching URLs, which it uses to read game files from
   asherarcade.com). The log prints the link to the new Scores Sheet.
5. **Deploy -> New deployment -> Web app**. Execute as: *Me*. Who has
   access: *Anyone*. Copy the `/exec` URL.
6. Paste that URL into the **Leaderboard URL** field in `trivia-studio.html`.
   Studio remembers it, so every game you make from then on uses it.

To ship a code change later: **Deploy -> Manage deployments -> edit -> New
version**. That keeps the URL the same.

Optional Script Properties:

| Property | Value |
|---|---|
| `SHEET_ID` | filled in by `setup`. Point it at a different Sheet if you want. |
| `GAMES_BASE_URL` | defaults to `https://www.asherarcade.com/trivia/games/`. |

## Running a game

- **Each game has its own tab** in the Scores Sheet, named after the game id.
  The tab appears when the first player starts.
- **Remove a name** (rude or duplicate): type `x` in that row's *Hide* column.
  It drops off the board within a few seconds.
- **Let someone replay** (their phone died, etc.): delete their row.
- **Reset a game** after testing: delete the game's tab.
- Game files are cached for 10 minutes. After you change a game's answer key,
  wait 10 minutes or rename the game id before guests play.

## Tests

```bash
node apps-script-trivia/test.js
```

Runs `Code.gs` against fake Sheet/Cache/Lock/UrlFetch services. It covers
scoring, one try per phone and per name, made-up scores, resuming, closed
games, hidden rows, and checks the scoring and name rules match `trivia.html`.
