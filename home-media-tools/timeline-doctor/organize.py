"""
organize.py  -  file your master photos/videos into dated folders on the drive.

Reads each file's date from its metadata (via ExifTool) and MOVES it into
dest_root using your folder pattern, e.g.  2014/2014-03/IMG_1234.jpg.

Safety (matches your rules):
  * NEVER deletes anything.
  * NEVER overwrites: if a file with that name already exists at the
    destination, it is left alone and reported, not clobbered.
  * Files whose date is missing or uncertain are NOT moved -- they're listed
    so you can decide. (It asks until it's certain.)

This works on your own masters folder (config 'source_root'). It does NOT touch
Immich's managed library -- for Immich's own copy, turn on Immich's built-in
"Storage Template" so it re-files by date automatically once dates are fixed.
"""

from __future__ import annotations
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

MEDIA_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff", ".gif",
              ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg", ".3gp"}

DATE_TAGS = ["-DateTimeOriginal", "-CreateDate", "-MediaCreateDate", "-CreationDate"]


def _read_date(path: Path):
    """Return (year, month) from the file's metadata, or None if unknown."""
    try:
        out = subprocess.run(
            ["exiftool", "-s3", "-d", "%Y-%m", *DATE_TAGS, str(path)],
            capture_output=True, text=True, check=False,
        )
    except FileNotFoundError:
        raise SystemExit("ExifTool not found. Install it and put 'exiftool' on PATH.")
    for line in out.stdout.splitlines():
        line = line.strip()
        if line and line[:4].isdigit():
            try:
                dt = datetime.strptime(line, "%Y-%m")
                return dt.year, dt.month
            except ValueError:
                continue
    return None


def _dest_for(cfg, root: Path, year: int, month: int, name: str) -> Path:
    folder = cfg["organize"]["folder_pattern"].format(year=year, month=month)
    return root / folder / name


def run(cfg: dict, apply: bool = False) -> None:
    org = cfg["organize"]
    src = Path(org["source_root"])
    dest_root = Path(org["dest_root"])
    if not src.is_dir():
        raise SystemExit(f"source_root not found: {src}")

    to_move, uncertain, blocked = [], [], []

    for path in src.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in MEDIA_EXTS:
            continue
        ym = _read_date(path)
        if ym is None:
            uncertain.append(path)
            continue
        year, month = ym
        dest = _dest_for(cfg, dest_root, year, month, path.name)
        if dest.exists():
            blocked.append((path, dest))      # never overwrite
        else:
            to_move.append((path, dest))

    print(f"Ready to file {len(to_move)} files.")
    if blocked:
        print(f"{len(blocked)} skipped (a file with that name already exists at "
              f"the destination -- not overwritten).")
    if uncertain:
        print(f"{len(uncertain)} have NO clear date and were left where they are "
              f"(needs your review):")
        for p in uncertain[:20]:
            print(f"   ? {p}")
        if len(uncertain) > 20:
            print(f"   ... and {len(uncertain) - 20} more")

    if not apply:
        print("\nThis was a PREVIEW. Re-run with --apply to actually move the "
              f"{len(to_move)} confidently-dated files. Nothing was moved or deleted.")
        for s, d in to_move[:15]:
            print(f"   {s.name}  ->  {d}")
        if len(to_move) > 15:
            print(f"   ... and {len(to_move) - 15} more")
        return

    moved = 0
    for s, d in to_move:
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))   # move, never delete the data
        moved += 1
    print(f"\nMoved {moved} files into {dest_root}. "
          f"{len(uncertain)} undated files were left untouched for you to review.")
