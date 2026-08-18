#!/usr/bin/env python3
"""
takeout_merge.py  -  put Google Takeout's metadata back INTO your photos/videos.

Google Takeout strips the real date, GPS location, description and tagged people
out of each photo and dumps them into a little sidecar ".json" file next to it.
This tool reads those sidecars and writes the data back into the actual media
file (via ExifTool), so each photo is self-describing again. Run it on EACH
Takeout export folder; afterwards you can combine + dedupe them into one master.

It is careful about Google's messy sidecar naming (truncated names, "(1)"
duplicate counters, "-edited" copies).

Usage:
    # Safe preview - shows matches, writes nothing:
    python takeout_merge.py "F:\\Google Photos Takeout\\2026-05-31\\Takeout"

    # Actually embed the metadata into the files:
    python takeout_merge.py "F:\\Google Photos Takeout - Alice\\Takeout" --apply

    # Keep ExifTool's "_original" backup copies (uses more disk):
    python takeout_merge.py "...\\Takeout" --apply --keep-backups

Needs ExifTool on PATH (exiftool -ver should work).
"""

from __future__ import annotations
import argparse
import json
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

MEDIA_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff", ".gif",
              ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg",
              ".3gp", ".dng", ".cr2", ".nef"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg", ".3gp"}

# Google's "-edited" suffix in various languages.
EDIT_TAGS = ["-edited", "-bearbeitet", "-modifié", "-modificato", "-editado",
             "-bewerkt", "-redigerad"]


def find_sidecar_name(media_name: str, json_names: set[str]) -> str | None:
    """
    Given a media filename and the set of .json filenames in the same folder,
    return the matching sidecar name, or None. Pure function -> easy to test.
    """
    p = Path(media_name)
    stem, ext = p.stem, p.suffix
    cands: list[str] = []

    # 1. The common schemes: name.ext.json / name.ext.supplemental-metadata.json
    cands.append(media_name + ".json")
    cands.append(media_name + ".supplemental-metadata.json")

    # 2. Duplicate counter "(n)" that Google moves around:
    #    photo "IMG(1).jpg"  <->  sidecar "IMG.jpg(1).json"
    m = re.match(r"^(.*)\((\d+)\)$", stem)
    if m:
        base, n = m.group(1), m.group(2)
        cands.append(f"{base}{ext}({n}).json")
        cands.append(f"{base}{ext}.supplemental-metadata({n}).json")
        cands.append(f"{base}({n}){ext}.json")

    # 3. "-edited" copies share the ORIGINAL photo's sidecar.
    low = stem.lower()
    for tag in EDIT_TAGS:
        if low.endswith(tag):
            base = stem[: -len(tag)]
            cands.append(f"{base}{ext}.json")
            cands.append(f"{base}{ext}.supplemental-metadata.json")
            break

    for c in cands:
        if c in json_names:
            return c

    # 4. Fuzzy fallback for Google's filename TRUNCATION: a sidecar whose base
    #    name is a prefix of this media file's name (longest such wins).
    target = media_name.lower()
    best = None
    for j in json_names:
        base = j[:-5] if j.lower().endswith(".json") else j
        base = re.sub(r"\.supplemental-met.*$", "", base, flags=re.I)
        bl = base.lower()
        if len(bl) >= 8 and target.startswith(bl):
            if best is None or len(bl) > len(best[1]):
                best = (j, bl)
    return best[0] if best else None


def _ts_to_exif(ts: str) -> str | None:
    try:
        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        return dt.strftime("%Y:%m:%d %H:%M:%S")
    except (ValueError, OSError):
        return None


def build_exif_args(media: Path, data: dict) -> list[str]:
    """Translate one Takeout JSON into ExifTool arguments for this file."""
    args: list[str] = []
    is_video = media.suffix.lower() in VIDEO_EXTS

    # --- date taken ---
    ts = ((data.get("photoTakenTime") or {}).get("timestamp")
          or (data.get("creationTime") or {}).get("timestamp"))
    when = _ts_to_exif(ts) if ts else None
    if when:
        if is_video:
            args += [f"-QuickTime:CreateDate={when}",
                     f"-QuickTime:ModifyDate={when}",
                     f"-TrackCreateDate={when}", f"-MediaCreateDate={when}"]
        else:
            args += [f"-DateTimeOriginal={when}", f"-CreateDate={when}",
                     f"-ModifyDate={when}"]
        args += [f"-FileModifyDate={when}"]   # so Windows shows the right date

    # --- GPS location ---
    geo = data.get("geoData") or data.get("geoDataExif") or {}
    lat, lon = geo.get("latitude"), geo.get("longitude")
    if lat and lon and not is_video:   # GPS in EXIF is for images
        args += [f"-GPSLatitude={abs(lat)}",
                 f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
                 f"-GPSLongitude={abs(lon)}",
                 f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}"]
        alt = geo.get("altitude")
        if alt:
            args += [f"-GPSAltitude={abs(alt)}",
                     f"-GPSAltitudeRef={'0' if alt >= 0 else '1'}"]

    # --- description / title ---
    desc = (data.get("description") or "").strip()
    if desc:
        args += [f"-ImageDescription={desc}", f"-XMP:Description={desc}"]

    # --- tagged people -> XMP person tags + keywords ---
    for person in data.get("people") or []:
        nm = (person.get("name") or "").strip()
        if nm:
            args += [f"-XMP:PersonInImage+={nm}", f"-Keywords+={nm}"]

    return args


def main() -> int:
    ap = argparse.ArgumentParser(description="Merge Takeout JSON into media files.")
    ap.add_argument("root", help="A Takeout folder to process.")
    ap.add_argument("--apply", action="store_true",
                    help="Actually write metadata (default is a safe preview).")
    ap.add_argument("--keep-backups", action="store_true",
                    help="Keep ExifTool '_original' backups (uses more disk).")
    ap.add_argument("--unmatched-out", default="unmatched.csv",
                    help="Where to list media files with no sidecar found.")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"Not a folder: {root}")

    # Index .json files per directory once.
    json_by_dir: dict[str, set[str]] = defaultdict(set)
    media_files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() == ".json":
            json_by_dir[str(path.parent)].add(path.name)
        elif path.suffix.lower() in MEDIA_EXTS:
            media_files.append(path)

    matched, unmatched = [], []
    for media in media_files:
        sidecar = find_sidecar_name(media.name, json_by_dir.get(str(media.parent), set()))
        if sidecar:
            matched.append((media, media.parent / sidecar))
        else:
            unmatched.append(media)

    print(f"Media files: {len(media_files)}")
    print(f"Matched to a sidecar: {len(matched)}")
    print(f"No sidecar found: {len(unmatched)}")

    if unmatched:
        import csv
        with open(args.unmatched_out, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["media_without_sidecar"])
            for m in unmatched:
                w.writerow([str(m)])
        print(f"  (listed in {args.unmatched_out} -- usually 'edited' copies or "
              f"odd names; they keep whatever date they already have)")

    if not args.apply:
        print("\nPREVIEW only -- no files changed. Examples of what would be written:")
        for media, side in matched[:5]:
            try:
                data = json.loads(side.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                continue
            a = build_exif_args(media, data)
            print(f"   {media.name}: {' '.join(a[:4])}{' ...' if len(a) > 4 else ''}")
        print("\nRe-run with --apply to embed the metadata.")
        return 0

    # Apply with ExifTool, one file at a time.
    base_cmd = ["exiftool", "-q", "-m"]
    if not args.keep_backups:
        base_cmd.append("-overwrite_original")
    print("\nEmbedding metadata (this is a one-time pass; large libraries take a "
          "while)...")
    done = failed = 0
    for i, (media, side) in enumerate(matched, 1):
        try:
            data = json.loads(side.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            failed += 1
            continue
        exif_args = build_exif_args(media, data)
        if not exif_args:
            continue
        r = subprocess.run(base_cmd + exif_args + [str(media)],
                           capture_output=True, text=True)
        if r.returncode == 0:
            done += 1
        else:
            failed += 1
        if i % 500 == 0:
            print(f"  ...{i}/{len(matched)} processed")

    print(f"\nDone. Embedded metadata into {done} files. {failed} had problems.")
    print("Now do the same for your OTHER Takeout folder, then run inventory.py "
          "across both to combine + dedupe into one master.")
    if not args.keep_backups:
        print("Reminder: keep your original Takeout .zip files until you've "
              "confirmed everything looks right -- that's your safety net.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
