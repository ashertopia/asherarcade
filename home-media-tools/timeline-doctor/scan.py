"""
scan.py  -  find photos/videos whose date disagrees with how old the people
in them look, and propose a corrected year.

Writes the findings to the review queue file (review_queue.json) for you to
confirm in the web reviewer. Nothing in Immich is changed by scanning.
"""

from __future__ import annotations
import json
from datetime import datetime

import age_model
from immich_client import ImmichClient


def _asset_year(asset: dict) -> float | None:
    """Best 'date taken' for an asset as a fractional year, or None."""
    exif = asset.get("exifInfo") or {}
    raw = exif.get("dateTimeOriginal") or asset.get("localDateTime") or asset.get("fileCreatedAt")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.year + (dt.month - 1) / 12.0
    except ValueError:
        return None


def _scale_box(face: dict, prev_w: int, prev_h: int):
    """Immich face box -> (x,y,w,h) in the preview image's pixel space."""
    ref_w = face.get("imageWidth") or face.get("boundingBoxX2", 0) or prev_w
    ref_h = face.get("imageHeight") or face.get("boundingBoxY2", 0) or prev_h
    if not ref_w or not ref_h:
        return None
    sx, sy = prev_w / ref_w, prev_h / ref_h
    x1 = face.get("boundingBoxX1", 0) * sx
    y1 = face.get("boundingBoxY1", 0) * sy
    x2 = face.get("boundingBoxX2", 0) * sx
    y2 = face.get("boundingBoxY2", 0) * sy
    return (x1, y1, x2 - x1, y2 - y1)


def _center(box):
    x, y, w, h = box
    return (x + w / 2, y + h / 2)


def _best_match_age(immich_box, detected_faces):
    """Pick the detected face whose center is closest to the Immich box."""
    if immich_box is None or not detected_faces:
        return None
    cx, cy = _center(immich_box)
    best, best_d = None, float("inf")
    for f in detected_faces:
        fx, fy = _center(f["box"])
        d = (fx - cx) ** 2 + (fy - cy) ** 2
        if d < best_d:
            best, best_d = f, d
    return best["age"] if best else None


def run(cfg: dict, people_cfg: dict) -> list[dict]:
    age_model.init(cfg.get("model_cache_dir", ""))
    client = ImmichClient(cfg["immich"]["base_url"], cfg["immich"]["api_key"])

    # name -> birth (fractional year). Names compared case-insensitively.
    anchors = {}
    for p in people_cfg.get("people", []):
        if p.get("birth_year"):
            by = p["birth_year"] + ((p.get("birth_month", 1) - 1) / 12.0)
            anchors[p["name"].strip().lower()] = by
    if not anchors:
        raise SystemExit("No people with birth_year found in people.json.")

    # Map Immich person ids -> name, and collect the assets to inspect.
    immich_people = {pp["id"]: pp.get("name", "") for pp in client.get_people()}
    asset_ids = set()
    for pid, name in immich_people.items():
        if name.strip().lower() in anchors:
            for a in client.assets_for_person(pid):
                asset_ids.add(a["id"])

    threshold = float(cfg.get("age_mismatch_years", 6))
    agree_within = float(cfg.get("auto_confident_within_years", 2))
    queue = []

    for i, aid in enumerate(sorted(asset_ids), 1):
        try:
            asset = client.get_asset(aid)
        except Exception as exc:
            print(f"  ! skip {aid}: {exc}")
            continue

        year = _asset_year(asset)
        # Faces in this asset belonging to people we have anchors for.
        tagged = []
        for person in asset.get("people", []):
            nm = (person.get("name") or "").strip().lower()
            if nm in anchors and person.get("faces"):
                tagged.append((person.get("name"), nm, person["faces"][0]))
        if not tagged:
            continue

        try:
            preview = client.preview_bytes(aid)
            detected = age_model.analyze_faces(preview)
        except Exception as exc:
            print(f"  ! age model failed on {aid}: {exc}")
            continue
        if not detected:
            continue

        # Figure preview dimensions from the largest detected box as a fallback.
        prev_w = max((f["box"][0] + f["box"][2]) for f in detected) or 1000
        prev_h = max((f["box"][1] + f["box"][3]) for f in detected) or 1000

        implied_years, people_info = [], []
        for disp_name, nm, face in tagged:
            box = _scale_box(face, int(prev_w), int(prev_h))
            apparent = _best_match_age(box, detected)
            if apparent is None:
                continue
            implied = anchors[nm] + apparent  # date this photo would have been taken
            implied_years.append(implied)
            people_info.append({
                "name": disp_name,
                "apparent_age": round(apparent, 1),
                "expected_age": round(year - anchors[nm], 1) if year else None,
                "implied_year": round(implied, 1),
            })

        if not implied_years:
            continue

        suggested_year = round(sum(implied_years) / len(implied_years))
        spread = max(implied_years) - min(implied_years)

        # Is the existing date wrong? (only flag if we have a date to compare,
        # or if there's no date at all -> always offer a guess)
        mismatch = year is None or abs(year - (sum(implied_years) / len(implied_years))) >= threshold
        if not mismatch:
            continue

        # "Certain" only when multiple anchored people corroborate each other.
        certain = len(implied_years) >= 2 and spread <= agree_within

        queue.append({
            "asset_id": aid,
            "filename": asset.get("originalFileName", aid),
            "original_path": asset.get("originalPath"),
            "current_date": (asset.get("exifInfo") or {}).get("dateTimeOriginal")
                            or asset.get("localDateTime"),
            "people": people_info,
            "suggested_year": suggested_year,
            "suggested_month": None,
            "confidence": "certain" if certain else "review",
            "reason": ("No date on file." if year is None
                       else f"People look ~{suggested_year}, file says {int(year)}."),
            "status": "pending",
        })
        if i % 25 == 0:
            print(f"  ...inspected {i}/{len(asset_ids)} assets, {len(queue)} flagged so far")

    out_path = cfg.get("queue_file", "review_queue.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(queue, fh, indent=2)
    print(f"\nFlagged {len(queue)} items. Saved to {out_path}.")
    print("Next:  python timeline_doctor.py review")
    return queue
