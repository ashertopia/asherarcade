#!/usr/bin/env python3
"""
inventory.py  -  catalog every file under a folder (e.g. F:\\, your Google
Takeout exports) into one spreadsheet.

For each file it records: path, size, type, a content fingerprint (so we can
find duplicates), the file's own dates, AND -- for Google Takeout -- the REAL
"photo taken" date pulled from the little sidecar .json files Google includes.

It is read-only: it never moves, changes, or deletes anything.

Usage:
    python inventory.py "F:\\"
    python inventory.py "F:\\Takeout" --out inventory.csv
    # scan BOTH Takeout exports into ONE catalog (combine the two accounts):
    python inventory.py "F:\\Google Photos Takeout\\2026-05-31\\Takeout" "F:\\Google Photos Takeout - Alice\\Takeout"

Speed note: to avoid fingerprinting every file, it first groups by size and
only fingerprints files whose size matches another file (the only ones that
*could* be duplicates). Unique sizes are recorded as already-unique.
"""

from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

MEDIA_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff", ".gif",
              ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg",
              ".3gp", ".raw", ".cr2", ".nef", ".dng"}


def takeout_date(media: Path) -> str:
    """Real capture date from a Google Takeout sidecar .json, or '' if none."""
    # Takeout has used several sidecar naming schemes over the years.
    candidates = [
        media.with_suffix(media.suffix + ".json"),
        media.with_suffix(media.suffix + ".supplemental-metadata.json"),
        media.with_name(media.stem + ".json"),
    ]
    for c in candidates:
        if c.exists():
            try:
                data = json.loads(c.read_text(encoding="utf-8", errors="ignore"))
            except (json.JSONDecodeError, OSError):
                continue
            for key in ("photoTakenTime", "creationTime"):
                ts = (data.get(key) or {}).get("timestamp")
                if ts:
                    try:
                        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
                        return dt.strftime("%Y-%m-%d")
                    except (ValueError, OSError):
                        pass
    return ""


def file_hash(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="Catalog files into a spreadsheet.")
    ap.add_argument("roots", nargs="+",
                    help="One or more folders to scan (e.g. both Takeout exports).")
    ap.add_argument("--out", default="inventory.csv", help="Output CSV path.")
    ap.add_argument("--media-only", action="store_true",
                    help="Only catalog photos/videos (skip docs, sidecars, etc.).")
    args = ap.parse_args()

    roots = [Path(r) for r in args.roots]
    for r in roots:
        if not r.is_dir():
            raise SystemExit(f"Not a folder: {r}")

    print(f"Pass 1/2: listing files under {len(roots)} folder(s) ...")
    records = []           # each: dict of file info
    by_size = defaultdict(list)
    walker = ((dp, f) for root in roots for dp, _d, f in os.walk(root))
    for dirpath, files in walker:
        for name in files:
            p = Path(dirpath) / name
            ext = p.suffix.lower()
            if name.endswith(".json"):          # sidecars aren't media
                continue
            if args.media_only and ext not in MEDIA_EXTS:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            rec = {
                "path": str(p),
                "name": name,
                "ext": ext,
                "size": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d"),
                "takeout_date": takeout_date(p) if ext in MEDIA_EXTS else "",
                "sha256": "",
                "is_media": ext in MEDIA_EXTS,
            }
            records.append(rec)
            by_size[st.st_size].append(rec)
    print(f"  found {len(records)} files.")

    # Pass 2: only hash files whose size collides with another file.
    to_hash = [r for size, group in by_size.items() if len(group) > 1 for r in group]
    print(f"Pass 2/2: fingerprinting {len(to_hash)} possible-duplicate files "
          f"(skipping {len(records) - len(to_hash)} that are unique by size) ...")
    for i, rec in enumerate(to_hash, 1):
        try:
            rec["sha256"] = file_hash(Path(rec["path"]))
        except OSError:
            rec["sha256"] = ""
        if i % 500 == 0:
            print(f"  ...{i}/{len(to_hash)} fingerprinted")

    fields = ["path", "name", "ext", "size", "modified", "takeout_date",
              "sha256", "is_media"]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(records)

    print(f"\nDone. Catalog written to {args.out} ({len(records)} files).")
    print("Next:  python dedupe.py --inventory " + args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
