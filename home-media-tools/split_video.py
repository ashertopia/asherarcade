#!/usr/bin/env python3
"""
split_video.py  -  Cut a long home video into scene-based clips.

Detects where the scene changes (a cut, a big change in what's on screen) and
writes each scene out as its own video file. Point the output at a folder that
Immich watches and your clips get sorted automatically.

Usage:
    python split_video.py "C:\\videos\\christmas2003.mp4"
    python split_video.py "C:\\videos\\big.mp4" --out "C:\\immich-import\\clips"
    python split_video.py "C:\\videos\\big.mp4" --threshold 30 --min-seconds 4

Tuning:
    --threshold   How different two moments must be to count as a new scene.
                  Lower  = more sensitive = MORE, shorter clips (try 20).
                  Higher = less sensitive = FEWER, longer clips (try 35).
                  Default 27 is a good starting point for home video.
    --min-seconds Ignore scenes shorter than this so you don't get a flurry of
                  tiny 1-second clips. Default 2.
    --copy        Split without re-encoding (very fast, no quality loss), but
                  cuts snap to the nearest keyframe so they can be off by a
                  second or two. Without this flag clips are re-encoded for
                  frame-accurate cuts (slower).
"""

import argparse
import sys
from pathlib import Path

try:
    from scenedetect import detect, ContentDetector, split_video_ffmpeg
except ImportError:
    sys.exit(
        "PySceneDetect is not installed.\n"
        "Run:  pip install \"scenedetect[opencv]\"\n"
        "(You also need FFmpeg installed and on your PATH.)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Split a video into scene clips.")
    parser.add_argument("video", help="Path to the input video file.")
    parser.add_argument(
        "--out",
        default=None,
        help="Folder to write the clips into (default: a folder next to the video).",
    )
    parser.add_argument("--threshold", type=float, default=27.0,
                        help="Scene-change sensitivity (lower = more clips). Default 27.")
    parser.add_argument("--min-seconds", type=float, default=2.0,
                        help="Drop scenes shorter than this many seconds. Default 2.")
    parser.add_argument("--copy", action="store_true",
                        help="Fast keyframe split with no re-encode (less precise cuts).")
    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        sys.exit(f"File not found: {video_path}")

    out_dir = Path(args.out) if args.out else video_path.parent / f"{video_path.stem}_clips"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Analyzing scenes in: {video_path.name}")
    print("(This reads through the whole video once and can take a few minutes "
          "for large files.)")

    detector = ContentDetector(threshold=args.threshold, min_scene_len=15)
    scenes = detect(str(video_path), detector, show_progress=True)

    # Drop scenes that are too short to be worth keeping.
    kept = [
        (start, end) for (start, end) in scenes
        if (end.get_seconds() - start.get_seconds()) >= args.min_seconds
    ]

    if not scenes:
        print("\nNo scene changes detected — this looks like one continuous shot.")
        print("Nothing to split. (Try a lower --threshold if you expected cuts.)")
        return 0

    if not kept:
        print(f"\nFound {len(scenes)} scenes, but all were shorter than "
              f"{args.min_seconds}s. Lower --min-seconds to keep them.")
        return 0

    print(f"\nFound {len(scenes)} scenes; keeping {len(kept)} "
          f"(>= {args.min_seconds}s each).")
    print(f"Writing clips to: {out_dir}\n")

    template = str(out_dir / "$VIDEO_NAME-scene-$SCENE_NUMBER.mp4")
    split_video_ffmpeg(
        str(video_path),
        kept,
        output_file_template=template,
        show_progress=True,
        # When --copy is set, tell ffmpeg to stream-copy (fast, no re-encode).
        arg_override="-map 0 -c:v copy -c:a copy" if args.copy else None,
    )

    print(f"\nDone. {len(kept)} clips are in:\n  {out_dir}")
    print("Move/copy them into your Immich import folder and they'll be sorted "
          "like any other video.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
