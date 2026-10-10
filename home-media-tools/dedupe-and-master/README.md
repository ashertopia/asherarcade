# Dedupe & Master Folder

Turn the mess on **F:** (especially Google Takeout, which stores the same photo
many times across albums) into **one master folder of unique files**, with every
duplicate listed for you to audit — and **nothing ever deleted by the tool**.

This runs in plain Python; it does not need Immich. The clean master folder it
produces is what you then feed into Timeline Doctor / Immich.

---

## The flow

```
Two Google Takeout exports (yours + Alice's), each with .json sidecars
        │
   0. takeout_merge.py -> writes each sidecar's date/GPS/people INTO the photo
        │                 (run once per Takeout folder)
        ▼
F:\  (both Takeouts + random folders, ...)
        │
   1. inventory.py     -> inventory.csv      (catalog BOTH folders; read-only)
        │
   2. dedupe.py        -> duplicates.csv      (YOU audit/edit this)
        │              -> master_list.csv     (the unique keepers)
        │
   3. build_master.py  -> moves uniques into  F:\Master
        │              -> moves confirmed dupes into  F:\_DuplicatesToReview
        │                 (moved, NOT deleted — you delete when satisfied)
        ▼
   Master folder  ->  Timeline Doctor / Immich for dating + organizing
```

---

## Step 0 — Merge Google Takeout's JSON back into the photos (do this FIRST)

Google Takeout strips each photo's real date, GPS, description, and tagged
people into a sidecar `.json` file. If you combine/dedupe before putting that
data back, the metadata gets orphaned. So fix it first, **once per Takeout
folder** (you have two):

```powershell
cd home-media-tools\dedupe-and-master

# Safe preview first (writes nothing):
python takeout_merge.py "F:\Google Photos Takeout\2026-05-31\Takeout"

# Then embed for real:
python takeout_merge.py "F:\Google Photos Takeout\2026-05-31\Takeout" --apply
python takeout_merge.py "F:\Google Photos Takeout - Alice\Takeout" --apply
```

This writes the real **date taken**, **GPS location**, **description**, and
**tagged people** into each file (via ExifTool), so the photo is self-describing
afterward. It handles Google's mangled sidecar names (truncated names, `(1)`
duplicate counters, `-edited` copies) and lists anything it couldn't match in
`unmatched.csv`.

> **Keep your original Takeout `.zip` files** until you've confirmed everything
> looks right — that's your safety net. (Or pass `--keep-backups` to have
> ExifTool leave `_original` copies, which uses more disk.)

## Step 1 — Catalog everything (read-only)

```powershell
# Catalog BOTH Takeout exports into one combined inventory:
python inventory.py "F:\Google Photos Takeout\2026-05-31\Takeout" "F:\Google Photos Takeout - Alice\Takeout" --media-only

# Or the whole drive:
python inventory.py "F:\" --out inventory.csv
```

`inventory.csv` lists every file with its size, content fingerprint, and — for
Google Takeout — the **real photo-taken date** read from Google's sidecar
`.json` files (handy later for the timeline). This step changes nothing.

> It's smart about speed: it only fingerprints files whose size matches another
> file (the only ones that *could* be duplicates), so huge libraries finish
> much faster.

## Step 2 — Find duplicates

```powershell
python dedupe.py --inventory inventory.csv
```

Produces:
- **`duplicates.csv`** — every file that has an identical twin, in groups. Each
  group keeps one copy (`KEEP`) and marks the rest `delete`. **Open this in
  Excel and audit it** — change any `KEEP`/`delete` you disagree with. The tool
  picks the keeper by preferring the copy that has a real Takeout date and isn't
  an album duplicate.
- **`master_list.csv`** — the one copy of each unique file headed for the master
  folder.

"Duplicate" = **byte-for-byte identical**, so a flagged duplicate genuinely is
the same file. (Near-identical-but-not-identical photos — e.g. edited versions —
are treated as different files and both kept.)

## Step 3 — Build the master folder & quarantine duplicates

Both default to a **safe preview**; add `--apply` to actually move.

```powershell
# Move one copy of every unique file into the master folder
python build_master.py --master-list master_list.csv --dest "F:\Master"
python build_master.py --master-list master_list.csv --dest "F:\Master" --apply

# Move the duplicates you confirmed (rows still marked 'delete') into a holding
# folder, so YOU can review and delete them yourself
python build_master.py --quarantine-dupes duplicates.csv --dest "F:\_DuplicatesToReview"
python build_master.py --quarantine-dupes duplicates.csv --dest "F:\_DuplicatesToReview" --apply
```

---

## Your rules, enforced

| Rule | How |
|---|---|
| You don't delete | The tool only ever **moves**. Duplicates go to a review folder; you delete them. |
| Never overwrite | If a filename already exists at the destination, the incoming file gets a `_1`/`_2` suffix — the existing file is never clobbered. |
| Let me edit/audit | `duplicates.csv` is a plain spreadsheet you control before anything moves. |
| Preview first | `build_master.py` shows what it *would* do until you add `--apply`. |

---

## Then: dates & timeline

Once `F:\Master` holds your unique files:
1. Point **Immich** at it (or import it) so faces get tagged.
2. Run **Timeline Doctor** (`../timeline-doctor`) to fix dates using how old
   people look, and to file everything into dated folders.
   - The Takeout dates captured in Step 1 are already a strong starting point
     for many files.

---

## Notes / limits

- Exact-duplicate detection is reliable and safe. Catching *visually similar but
  not identical* photos (slightly recompressed, resized, or edited) is a
  separate "perceptual" pass — tell me if you want that added; it's fuzzier so
  it always needs your eyes.
- Very large drives: Step 1 reads a lot from disk. It's a one-time cost; let it
  run. The result is reusable for all later steps.
