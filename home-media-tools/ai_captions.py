#!/usr/bin/env python3
"""
ai_captions.py  -  Auto-write descriptions for photos and videos, privately.

For each image/video in a folder this sends it to a vision AI model running
locally on your own laptop (via Ollama -- nothing leaves your machine) and
writes the generated description into the file's metadata. Immich reads that
description, so after a re-scan you can search by it.

Photos are captioned directly. Videos are captioned from a frame grabbed near
the middle of the clip.

Usage:
    python ai_captions.py "C:\\immich-import"
    python ai_captions.py "C:\\immich-import" --model llava --overwrite
    python ai_captions.py "C:\\photos" --recursive

Prerequisites (see README):
    - Ollama installed and running, with a vision model pulled:
        ollama pull llava
    - FFmpeg on PATH (for grabbing a frame from videos).
    - ExifTool on PATH (for writing the description into files).
    - pip install requests
"""

import argparse
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("The 'requests' package is missing.  Run:  pip install requests")

OLLAMA_URL = "http://localhost:11434/api/generate"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".bmp", ".tif", ".tiff", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg", ".3gp"}

PROMPT = (
    "Describe this home photo or video frame in one clear, factual sentence. "
    "Mention the setting, what people are doing, and any notable objects. "
    "Do not guess names. Keep it under 25 words."
)


def has_description(path: Path) -> bool:
    """True if the file already carries a description (so we can skip it)."""
    try:
        out = subprocess.run(
            ["exiftool", "-s3", "-Description", "-ImageDescription", str(path)],
            capture_output=True, text=True, check=False,
        )
        return bool(out.stdout.strip())
    except FileNotFoundError:
        sys.exit("ExifTool not found. Install it and ensure 'exiftool' is on your PATH.")


def grab_video_frame(video: Path) -> Path:
    """Extract a single representative frame (~midpoint) to a temp JPG."""
    tmp = Path(tempfile.gettempdir()) / f"frame_{video.stem}.jpg"
    # -ss before -i seeks fast; '50%' style isn't supported, so grab at 3s in,
    # which is fine for most home clips. For very short clips ffmpeg clamps it.
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", "00:00:03",
         "-i", str(video), "-frames:v", "1", "-q:v", "3", str(tmp)],
        check=False,
    )
    if not tmp.exists():  # fallback: grab the very first frame
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
             "-frames:v", "1", "-q:v", "3", str(tmp)],
            check=False,
        )
    return tmp


def caption_image(image_path: Path, model: str) -> str:
    """Ask the local Ollama vision model to describe an image."""
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    resp = requests.post(
        OLLAMA_URL,
        json={"model": model, "prompt": PROMPT, "images": [b64], "stream": False},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json().get("response", "").strip()


def write_description(path: Path, text: str) -> None:
    """Write the caption into the file's metadata (overwrites in place)."""
    subprocess.run(
        ["exiftool", "-overwrite_original",
         f"-Description={text}",
         f"-ImageDescription={text}",
         f"-XMP-dc:Description={text}",
         str(path)],
        capture_output=True, text=True, check=False,
    )


def iter_media(root: Path, recursive: bool):
    files = root.rglob("*") if recursive else root.iterdir()
    for f in files:
        if f.is_file() and f.suffix.lower() in (IMAGE_EXTS | VIDEO_EXTS):
            yield f


def main() -> int:
    parser = argparse.ArgumentParser(description="AI-caption photos and videos locally.")
    parser.add_argument("folder", help="Folder of photos/videos to caption.")
    parser.add_argument("--model", default="llava",
                        help="Ollama vision model to use. Default: llava.")
    parser.add_argument("--recursive", action="store_true",
                        help="Also process files in subfolders.")
    parser.add_argument("--overwrite", action="store_true",
                        help="Re-caption files that already have a description.")
    args = parser.parse_args()

    root = Path(args.folder)
    if not root.is_dir():
        sys.exit(f"Not a folder: {root}")

    # Quick health check on Ollama so we fail fast with a clear message.
    try:
        requests.get("http://localhost:11434/api/tags", timeout=5)
    except requests.RequestException:
        sys.exit("Can't reach Ollama at localhost:11434. Is Ollama running? "
                 "(Start it, then: ollama pull " + args.model + ")")

    media = list(iter_media(root, args.recursive))
    if not media:
        print("No photos or videos found.")
        return 0

    print(f"Found {len(media)} files. Captioning with model '{args.model}'...\n")
    done = skipped = failed = 0

    for path in media:
        if not args.overwrite and has_description(path):
            print(f"  skip (already described): {path.name}")
            skipped += 1
            continue

        try:
            if path.suffix.lower() in VIDEO_EXTS:
                frame = grab_video_frame(path)
                if not frame.exists():
                    print(f"  FAIL (no frame): {path.name}")
                    failed += 1
                    continue
                caption = caption_image(frame, args.model)
                frame.unlink(missing_ok=True)
            else:
                caption = caption_image(path, args.model)

            if not caption:
                print(f"  FAIL (empty caption): {path.name}")
                failed += 1
                continue

            write_description(path, caption)
            print(f"  ok: {path.name}\n      -> {caption}")
            done += 1
        except Exception as exc:  # keep going through the batch
            print(f"  FAIL ({exc}): {path.name}")
            failed += 1

    print(f"\nDone. captioned={done}  skipped={skipped}  failed={failed}")
    if done:
        print("Now have Immich re-scan the library so it picks up the new "
              "descriptions (Administration -> Jobs -> 'Extract Metadata' / "
              "rescan the library).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
