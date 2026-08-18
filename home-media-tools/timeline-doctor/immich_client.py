"""
immich_client.py  -  thin wrapper around the Immich REST API.

All Immich HTTP calls live here so that if your Immich version names an
endpoint slightly differently, there's exactly one place to fix it. Tested
against the Immich v1 API shape (2024-2025). If a call 404s, check the live
docs at  <your-immich>/api  (Immich serves interactive API docs there).
"""

from __future__ import annotations
import requests


class ImmichClient:
    def __init__(self, base_url: str, api_key: str):
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": api_key,
            "Accept": "application/json",
        })

    # --- basic connectivity -------------------------------------------------
    def ping(self) -> dict:
        """Confirm the server + API key work. Returns the logged-in user."""
        r = self.session.get(f"{self.base}/api/users/me", timeout=15)
        r.raise_for_status()
        return r.json()

    # --- people -------------------------------------------------------------
    def get_people(self) -> list[dict]:
        """All named people. Each: {id, name, birthDate, ...}."""
        out, page = [], 1
        while True:
            r = self.session.get(f"{self.base}/api/people",
                                  params={"page": page, "size": 200}, timeout=30)
            r.raise_for_status()
            data = r.json()
            batch = data.get("people", data if isinstance(data, list) else [])
            out.extend(batch)
            if not batch or not data.get("hasNextPage"):
                break
            page += 1
        return out

    def assets_for_person(self, person_id: str) -> list[dict]:
        """Every asset a given person appears in (handles pagination)."""
        out, page = [], 1
        while True:
            r = self.session.post(f"{self.base}/api/search/metadata",
                                  json={"personIds": [person_id],
                                        "page": page, "size": 250}, timeout=60)
            r.raise_for_status()
            items = r.json().get("assets", {})
            batch = items.get("items", [])
            out.extend(batch)
            if not items.get("nextPage"):
                break
            page += 1
        return out

    # --- assets -------------------------------------------------------------
    def get_asset(self, asset_id: str) -> dict:
        """Full asset detail incl. exifInfo and people[].faces[] boxes."""
        r = self.session.get(f"{self.base}/api/assets/{asset_id}", timeout=30)
        r.raise_for_status()
        return r.json()

    def preview_bytes(self, asset_id: str) -> bytes:
        """A reasonably sized JPEG preview for running the age model on."""
        r = self.session.get(f"{self.base}/api/assets/{asset_id}/thumbnail",
                             params={"size": "preview"}, timeout=60)
        r.raise_for_status()
        return r.content

    def set_date(self, asset_id: str, iso_datetime: str) -> None:
        """Set an asset's 'date taken'. iso_datetime e.g. '2014-03-01T12:00:00.000Z'."""
        r = self.session.put(f"{self.base}/api/assets/{asset_id}",
                             json={"dateTimeOriginal": iso_datetime}, timeout=30)
        r.raise_for_status()
