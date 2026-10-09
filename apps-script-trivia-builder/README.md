# Asher Arcade Trivia Builder (Google Sheet)

Turns a Custom Trivia order into a finished game file. Customers only have to
give the questions and the right answers. Gemini's `=AI()` function in Sheets
writes any wrong answers they left blank. No API key is needed.

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Question | Right answer | Wrong: close | Wrong: opposite | Wrong: funny | Story |

Wrong answers the customer typed fill **C, then D, then E**, in order. Only the
empty cells after them get an `=AI()` formula:

- **C, close:** a believable wrong answer, one small detail off ("Blue minivan" → "Silver minivan")
- **D, opposite:** the opposite, still plausible ("Two-seat sports car")
- **E, funny:** slightly ridiculous but possible ("Riding lawn mower")

Every prompt asks for 3 words or less, so answers fit on the buttons.

## Set up (once, about 5 minutes)

1. Create a new Google Sheet named "Asher Arcade Trivia Builder".
2. **Extensions → Apps Script.** Replace `Code.gs` with this folder's `Code.gs`.
   In Project Settings, check *Show "appsscript.json"* and paste in this
   folder's `appsscript.json`. Save.
3. Reload the Sheet. An **Asher Arcade** menu appears. Pick any item once and
   approve the permissions (this Sheet, Drive, and fetching the photo).
4. On the **Game** tab, put the trivia leaderboard `/exec` URL (from
   `apps-script-trivia/`) in *Leaderboard URL*. It is remembered for every game after this one.

**Check that `=AI()` works on your account:** type `=AI("Say hi")` in any
cell. If it gives an error or nothing happens, your Google plan doesn't include
Gemini in Sheets. Everything else still works; you type the wrong answers yourself.

## Each order

1. In the order's Drive folder, find **`<order id> trivia game.json`**. Copy
   its link, or the folder's link.
   - The order script saves this file once it has been redeployed with Custom
     Trivia. Older orders don't have it; type their questions in from the
     order details file.
2. **Asher Arcade → Load an order.** Paste the link. It fills in the questions,
   the right answers, the wrong answers the customer gave, the stories, the
   colors and the name. It also links the photo it finds in the folder.
3. **Generate the AI answers.** The `=AI()` cells do **not** fill or update on
   their own. Select columns C to E and click **Generate** (or **Refresh**).
   Do the same after you change a question or a right answer, so the wrong
   answers match.
4. **Read every row.** About 1 in 10 AI answers comes out odd: accidentally
   right, too long, or not funny. Type over any you don't like. A typed answer
   replaces the formula.
5. Check the **Game** tab: the *Game id* (it goes in the link), the title and the label above it.
6. **Asher Arcade → Make game file.** It checks every row and lists anything
   to fix: an answer that didn't generate, an empty cell, or the same answer
   twice. It also warns about answers over 3 words. Then it saves
   `<game id>.json` in the order folder, with the photo built in.
7. Download that file and put it in the repo at `trivia/games/<game id>.json`
   (on GitHub: open `trivia/games`, then **Add file → Upload files**). The game
   is live at `https://www.asherarcade.com/trivia.html?g=<game id>` once
   GitHub Pages publishes, usually within a few minutes.

**Start a new game (clear the sheet)** empties both tabs and keeps the leaderboard URL.

Want to tweak the game before publishing? Open the file in
`trivia-studio.html` (**Open a game file**), preview it, and download it again.

## Tests

```bash
node apps-script-trivia-builder/test.js
```

Covers loading an order (0, 1 or 3 wrong answers given), the AI formulas,
cleaning up AI output (quotes, trailing periods), catching ungenerated, empty
and duplicate answers, and checks that the file passes the game's own validation.
