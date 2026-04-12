# Walk the Word

A personal biblical walking experience app. Walk through ancient sites step by step.

## Current Experience: Ephesus - 7 Days with Paul (Acts 19)

21 miles. 8 checkpoints. The harbor, the riot, the library, the temple, the farewell.

---

## Deploying to GitHub Pages

1. Create a new GitHub repository (public or private)
2. Upload `index.html` and `manifest.json` to the root
3. Go to Settings > Pages > Source: Deploy from branch > main / root
4. Your app will be live at `https://[yourusername].github.io/[reponame]/`

## Adding to Your Phone Home Screen

**iPhone:**
1. Open the link in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"
4. Name it "Walk the Word" and tap Add

**Android:**
1. Open the link in Chrome
2. Tap the three-dot menu
3. Tap "Add to Home Screen"

---

## Setting Up SMS Notifications (Verizon vtext)

1. Go to [script.google.com](https://script.google.com)
2. Create a new project named "Walk the Word"
3. Paste the contents of `companion-script.gs` into the editor
4. Edit the top variables: PHONE_NUMBER, VTEXT_EMAIL, YOUR_NAME
5. Go to Extensions > Advanced Google Services
6. Enable "Google Fitness API"
7. Run `checkFitnessAPIEnabled()` to verify
8. Run `setupTriggers()` to activate hourly checks and 7am summaries
9. Run `testSMS()` to confirm texts are working

The script will:
- Check your Google Fit step count every hour
- Send a vtext when you cross a checkpoint
- Send a morning summary at 7am with yesterday's steps and what's ahead

---

## Bible Text (API.Bible)

The app pulls live NLT/NIV verses for each checkpoint. Get your free key at [api.bible](https://api.bible) and enter it during setup. Non-commercial personal use.

---

## Adding New Experiences

Each experience is a JavaScript object in `index.html` with:
- `id`, `title`, `totalMiles`, `totalSteps`
- `checkpoints[]` - array of stops with GPS coords, narrative, verse, and art

Future planned experiences:
- Paul's First Missionary Journey (Antioch to Cyprus to Pisidian Antioch)
- Jesus: Galilee to Jerusalem
- Joshua's Campaign in Canaan
- The Conquest Route

---

## Art & Image Sources

All images are public domain sourced from:
- Wikimedia Commons
- The Metropolitan Museum of Art Open Access
- Rijksmuseum Open Data
- Gustave Dore Bible illustrations (1865, public domain)
- James Tissot Bible paintings (1886-1894, public domain)

---

*Walk the Word is a personal project for private use. Bible verses quoted from NIV (New International Version). NIV is copyright Zondervan. For personal, non-commercial use.*
