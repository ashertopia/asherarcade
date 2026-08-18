"""
age_model.py  -  estimate apparent age of faces in an image, locally.

Wraps DeepFace. The model files download once into the folder you set as
`model_cache_dir` in config.json (so you can keep them on an external drive).
Everything runs on your machine -- no images leave the laptop.
"""

from __future__ import annotations
import io
import os


_loaded = False


def init(model_cache_dir: str) -> None:
    """Point DeepFace at the chosen cache folder. Call once before analyze()."""
    if model_cache_dir:
        os.makedirs(model_cache_dir, exist_ok=True)
        # DeepFace reads DEEPFACE_HOME and stores weights under <home>/.deepface
        os.environ["DEEPFACE_HOME"] = model_cache_dir


def analyze_faces(image_bytes: bytes) -> list[dict]:
    """
    Return one entry per detected face:
        {"age": float, "box": (x, y, w, h)}   (box in pixels of THIS image)
    Returns [] if no face is found. Never raises on a faceless image.
    """
    global _loaded
    try:
        from deepface import DeepFace
    except ImportError as exc:
        raise RuntimeError(
            "DeepFace is not installed. Run:  pip install deepface\n"
            "(First use also downloads model weights into your model_cache_dir.)"
        ) from exc

    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.array(img)

    try:
        results = DeepFace.analyze(
            arr,
            actions=["age"],
            detector_backend="retinaface",
            enforce_detection=False,  # don't crash on group/blurry shots
            silent=True,
        )
    except Exception:
        return []

    if isinstance(results, dict):
        results = [results]

    faces = []
    for r in results:
        region = r.get("region", {}) or {}
        faces.append({
            "age": float(r.get("age", 0) or 0),
            "box": (region.get("x", 0), region.get("y", 0),
                    region.get("w", 0), region.get("h", 0)),
        })
    _loaded = True
    return faces
