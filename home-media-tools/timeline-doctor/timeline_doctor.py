#!/usr/bin/env python3
"""
Timeline Doctor  -  fix photo/video dates using how old the people in them look,
then file everything into dated folders.

Commands:
    python timeline_doctor.py check      Test the Immich connection + show people
    python timeline_doctor.py scan       Find photos whose date fights the faces
    python timeline_doctor.py review      Open the web reviewer to confirm dates
    python timeline_doctor.py organize    Preview filing files into dated folders
    python timeline_doctor.py organize --apply    Actually move them

Setup once:
    1. copy config.example.json  -> config.json   and fill it in
    2. copy people.example.json  -> people.json   and list your people
See README.md.
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent


def load_json(name: str) -> dict:
    path = HERE / name
    if not path.exists():
        sys.exit(f"Missing {name}. Copy {name.replace('.json', '.example.json')} "
                 f"to {name} and fill it in.")
    return json.loads(path.read_text())


def cmd_check(cfg, people):
    from immich_client import ImmichClient
    client = ImmichClient(cfg["immich"]["base_url"], cfg["immich"]["api_key"])
    me = client.ping()
    print(f"Connected to Immich as: {me.get('email') or me.get('name')}")
    immich_names = {p.get("name", "").strip().lower() for p in client.get_people()}
    print("\nChecking your people list against Immich's named people:")
    for p in people.get("people", []):
        mark = "OK " if p["name"].strip().lower() in immich_names else "NOT FOUND in Immich"
        age = f"born {p.get('birth_year')}" if p.get("birth_year") else "no birth year"
        print(f"  [{mark}] {p['name']} ({age})")
    print("\nIf a name says NOT FOUND, tag/name that person in Immich first, or fix "
          "the spelling in people.json to match Immich exactly.")


def cmd_scan(cfg, people):
    import scan
    scan.run(cfg, people)


def cmd_review(cfg, people):
    from review_server import create_app
    app = create_app(cfg)
    print("Open  http://localhost:5000  in your browser to review.")
    print("Press Ctrl+C here when you're done.")
    app.run(host="127.0.0.1", port=5000)


def cmd_organize(cfg, people, apply):
    import organize
    organize.run(cfg, apply=apply)


def main():
    parser = argparse.ArgumentParser(description="Timeline Doctor")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sub.add_parser("scan")
    sub.add_parser("review")
    org = sub.add_parser("organize")
    org.add_argument("--apply", action="store_true",
                     help="Actually move files (default is a safe preview).")
    args = parser.parse_args()

    cfg = load_json("config.json")
    people = load_json("people.json")

    if args.cmd == "check":
        cmd_check(cfg, people)
    elif args.cmd == "scan":
        cmd_scan(cfg, people)
    elif args.cmd == "review":
        cmd_review(cfg, people)
    elif args.cmd == "organize":
        cmd_organize(cfg, people, args.apply)


if __name__ == "__main__":
    main()
