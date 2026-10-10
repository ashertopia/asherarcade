# Timeline Doctor

Fixes the dates on your old photos and videos by noticing when the **people**
in them don't match the **date** — e.g. Maggie looks like a baby but the file
is dated when she'd be a teenager — then lets you set the right year/month and
files everything into dated folders on your drive.

It works *with* Immich (your private Google Photos). Immich does the face
recognition; Timeline Doctor uses those tagged faces + the birth years you
provide to catch and fix wrong dates.

> ⚠️ **Status: first version, needs a live test run.** I built and
> syntax-checked it, but it hasn't yet been run against a real Immich server +
> the face-age model (those don't exist in the build environment). Expect to do
> one round of "run it, send me any error, I fix it." It is written to be
> **safe**: scanning changes nothing, file moves never delete or overwrite, and
> uncertain items always wait for you.

---

## What it does, step by step

1. **`check`** — confirms it can talk to your Immich and that your people list
   matches the names you gave faces in Immich.
2. **`scan`** — goes through every photo/video that contains a person you've
   given a birth year. For each, it estimates how old that person *looks* and
   compares it to how old they *should be* on that date. Big disagreements get
   added to a review list. (Nothing is changed.)
3. **`review`** — opens a simple web page on your laptop. For each flagged item
   you see the picture, who's in it, the current date, and a year/month picker.
   Save a date → it's written back to Immich and the timeline corrects itself.
   You can also say "date is already right" or "skip."
4. **`organize`** — files your master copies into dated folders
   (`2014/2014-03/...`). Preview first; `--apply` to actually move.

Every date *you* confirm is saved to `corrections.json`, which is the basis for
later "guessing" dates on the rest.

---

## Setup (one time)

Do the main **`home-media-tools` README** setup first (Python, FFmpeg, ExifTool,
Immich running). Then:

```powershell
cd home-media-tools\timeline-doctor
pip install -r requirements.txt
```

The first scan downloads the face-age model files. They go into the
`model_cache_dir` you set in config (point it at your external drive for space).

### Get your Immich API key
In Immich: click your avatar → **Account Settings** → **API Keys** → **New API
Key**. Copy it.

### Create your two config files
```powershell
copy config.example.json config.json
copy people.example.json people.json
```
- Edit **`config.json`**: paste the API key, set `base_url` (usually
  `http://localhost:2283`), set `model_cache_dir` and the `organize` paths to
  the drive you want.
- Edit **`people.json`**: list each person with their `birth_year` (and
  `birth_month` if known). **Names must match what you named them in Immich.**

---

## Using it

```powershell
# 1. Make sure everything's wired up
python timeline_doctor.py check

# 2. Find the wrongly-dated photos (safe; changes nothing)
python timeline_doctor.py scan

# 3. Review & fix dates in your browser (http://localhost:5000)
python timeline_doctor.py review

# 4. See where files would go (safe preview)
python timeline_doctor.py organize

# 5. Actually move them into dated folders
python timeline_doctor.py organize --apply
```

A good rhythm: `scan` → `review` a batch → `scan` again (now that more dates are
correct, the guesses improve) → repeat → `organize` when you're happy.

---

## Your safety rules, as built in

| Your rule | How it's enforced |
|---|---|
| Never delete | The organizer only ever **moves**; it never deletes. Scanning/review never delete. |
| Never overwrite | If a file of the same name already exists at the destination, it's **left alone and reported**, not clobbered. |
| Ask until certain | Only dates **you confirm** are written. Files with no clear date are **never auto-moved** — they're listed for you. A guess is marked "high confidence" only when **two or more** people in the photo independently point to the same year. |

---

## Honest limits

- **Face-age AI is approximate.** It's great at big gaps (baby / child / teen /
  adult) — exactly your Maggie case — but can be off by a few years for adults,
  and it generally **can't guess the month** from a face. You fill the month in
  when you know it.
- **Immich API differences.** Endpoints are all in `immich_client.py`; if your
  Immich version names one differently, that's the one file to tweak (your
  Immich serves live API docs at `<your-immich-address>/api`).
- It only checks photos that have a **named** person with a **birth year** —
  so name your key people in Immich first.

---

## How "start guessing" grows over time

`corrections.json` accumulates every date you've confirmed. The more you
confirm for a person, the better the tool understands how their face ages, so
future scans propose better years for undated/misdated shots. You stay in
control — it always proposes, you always confirm, until a guess is corroborated
strongly enough to be called certain.
