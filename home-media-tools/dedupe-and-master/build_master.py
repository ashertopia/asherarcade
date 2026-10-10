#!/usr/bin/env python3
"""
build_master.py  -  act on the dedupe results, safely.

Two jobs (run whichever you need):

  1. Build the master folder -- MOVE one copy of every unique file into your
     master folder:
        python build_master.py --master-list master_list.csv --dest "F:\\Master"
        python build_master.py --master-list master_list.csv --dest "F:\\Master" --apply

  2. Quarantine the duplicates you confirmed -- MOVE every row marked 'delete'
     in duplicates.csv into a holding folder so YOU can review and delete them:
        python build_master.py --quarantine-dupes duplicates.csv --dest "F:\\_DuplicatesToReview"
        python build_master.py --quarantine-dupes duplicates.csv --dest "F:\\_DuplicatesToReview" --apply

Safety: this MOVES files. It NEVER deletes and NEVER overwrites -- if a name
already exists at the destination it gives the incoming file a "_1", "_2"
suffix instead. Without --apply it only previews.
"""

from __future__ import annotations
import argparse
import csv
import shutil
from pathlib import Path


def unique_dest(dest_dir: Path, name: str, used: set) -> Path:
    """A destination path that doesn't collide with an existing/used name."""
    candidate = dest_dir / name
    if str(candidate).lower() not in used and not candidate.exists():
        used.add(str(candidate).lower())
        return candidate
    stem, suffix = Path(name).stem, Path(name).suffix
    i = 1
    while True:
        candidate = dest_dir / f"{stem}_{i}{suffix}"
        if str(candidate).lower() not in used and not candidate.exists():
            used.add(str(candidate).lower())
            return candidate
        i += 1


def move_all(pairs, apply: bool, label: str):
    """pairs: list of (src Path, dest Path)."""
    print(f"{label}: {len(pairs)} files.")
    for src, dest in pairs[:15]:
        print(f"   {src}  ->  {dest}")
    if len(pairs) > 15:
        print(f"   ... and {len(pairs) - 15} more")
    if not apply:
        print("\nPREVIEW only. Re-run with --apply to actually move. "
              "Nothing was moved or deleted.")
        return
    moved = missing = 0
    for src, dest in pairs:
        if not src.exists():
            missing += 1
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        moved += 1
    print(f"\nMoved {moved} files. {missing} were already gone (skipped). "
          f"Nothing deleted.")


def build_master(master_csv: str, dest: str, apply: bool):
    dest_dir = Path(dest)
    used = set()
    pairs = []
    with open(master_csv, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            src = Path(row["path"])
            pairs.append((src, unique_dest(dest_dir, src.name, used)))
    move_all(pairs, apply, f"Building master folder at {dest_dir}")


def quarantine(dupes_csv: str, dest: str, apply: bool):
    dest_dir = Path(dest)
    used = set()
    pairs = []
    with open(dupes_csv, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if (row.get("suggested_action") or "").strip().lower() == "delete":
                src = Path(row["path"])
                pairs.append((src, unique_dest(dest_dir, src.name, used)))
    move_all(pairs, apply, f"Quarantining confirmed duplicates to {dest_dir}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build master folder / quarantine dupes.")
    ap.add_argument("--master-list")
    ap.add_argument("--quarantine-dupes")
    ap.add_argument("--dest", required=True)
    ap.add_argument("--apply", action="store_true",
                    help="Actually move files (default is a safe preview).")
    args = ap.parse_args()

    if args.master_list:
        build_master(args.master_list, args.dest, args.apply)
    elif args.quarantine_dupes:
        quarantine(args.quarantine_dupes, args.dest, args.apply)
    else:
        ap.error("Give either --master-list or --quarantine-dupes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
