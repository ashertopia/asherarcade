#!/usr/bin/env python3
"""
dedupe.py  -  from the inventory, find exact duplicate files and decide which
single copy to keep.

Writes two spreadsheets:
  * duplicates.csv  -- every file that has at least one identical twin, grouped,
                       with a suggested KEEP / delete for each. THIS IS YOURS TO
                       EDIT AND AUDIT. Nothing is deleted by this tool.
  * master_list.csv -- the one copy of every unique file that should go into the
                       master folder (the keepers + all files that had no twin).

"Duplicate" here means byte-for-byte identical (same content fingerprint), so a
flagged duplicate really is the same file -- safe to remove the extras.

Usage:
    python dedupe.py --inventory inventory.csv
"""

from __future__ import annotations
import argparse
import csv
from collections import defaultdict


def keeper_score(rec: dict):
    """Higher = better keeper. Prefer real Takeout date, then a non-album path,
    then a shorter path, then an earlier modified date."""
    has_date = 1 if rec.get("takeout_date") else 0
    path = rec["path"].lower()
    # Google Takeout stores album copies; prefer the dated 'Photos from YYYY'
    # originals over album duplicates when we can tell.
    not_album = 0 if ("/albums/" in path.replace("\\", "/")) else 1
    return (has_date, not_album, -len(rec["path"]), rec.get("modified", ""))


def main() -> int:
    ap = argparse.ArgumentParser(description="Find duplicates from an inventory.")
    ap.add_argument("--inventory", default="inventory.csv")
    ap.add_argument("--dupes-out", default="duplicates.csv")
    ap.add_argument("--master-out", default="master_list.csv")
    args = ap.parse_args()

    with open(args.inventory, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    groups = defaultdict(list)       # sha256 -> [rec, rec, ...]
    uniques_by_size = []             # files with no hash = no size-twin = unique
    for r in rows:
        if r.get("sha256"):
            groups[r["sha256"]].append(r)
        else:
            uniques_by_size.append(r)

    dup_rows, master_rows = [], list(uniques_by_size)
    total_dupes = wasted_bytes = 0
    gid = 0

    for sha, recs in groups.items():
        if len(recs) == 1:
            master_rows.append(recs[0])      # hashed but no actual twin
            continue
        gid += 1
        recs.sort(key=keeper_score, reverse=True)
        keeper, extras = recs[0], recs[1:]
        master_rows.append(keeper)
        total_dupes += len(extras)
        try:
            wasted_bytes += int(keeper["size"]) * len(extras)
        except (ValueError, KeyError):
            pass
        for rec in recs:
            dup_rows.append({
                "group": gid,
                "suggested_action": "KEEP" if rec is keeper else "delete",
                "size": rec["size"],
                "takeout_date": rec.get("takeout_date", ""),
                "modified": rec.get("modified", ""),
                "path": rec["path"],
            })

    with open(args.dupes_out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["group", "suggested_action", "size",
                                           "takeout_date", "modified", "path"])
        w.writeheader()
        w.writerows(dup_rows)

    with open(args.master_out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["path", "name", "ext", "size",
                                           "modified", "takeout_date"])
        w.writeheader()
        for r in master_rows:
            w.writerow({k: r.get(k, "") for k in
                        ["path", "name", "ext", "size", "modified", "takeout_date"]})

    gb = wasted_bytes / (1024 ** 3)
    print(f"Unique files (-> master): {len(master_rows)}")
    print(f"Duplicate groups: {gid}")
    print(f"Extra duplicate copies: {total_dupes}  (~{gb:.1f} GB recoverable)")
    print(f"\nAudit file:  {args.dupes_out}")
    print("  Open it in Excel. Each group keeps one copy (KEEP) and marks the rest")
    print("  'delete'. Change any row's action if you disagree. NOTHING is deleted.")
    print(f"\nMaster list: {args.master_out}")
    print("Next:")
    print("  python build_master.py --master-list master_list.csv --dest \"F:\\Master\"")
    print("  python build_master.py --quarantine-dupes duplicates.csv --dest \"F:\\_DuplicatesToReview\"")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
