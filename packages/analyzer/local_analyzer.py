"""
Local image analyzer — no API key required.

Pipeline:
  1. Load image with OpenCV
  2. K-means color clustering → candidate regions
  3. Find contours per cluster
  4. Extract shape features per contour
  5. Classify using venue_rules.json (priority-ordered rule set)
  6. Return AnalyzeResponse-compatible dict

The rule set improves over time via train.py which reads training_data.jsonl
(corrections made by organizers in the MapEditor) and updates thresholds.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

from models import SectionResult
from seat_generator import MARGIN, SEAT_SPACING_X, SEAT_SPACING_Y, SEATED_TYPES

RULES_PATH = Path(__file__).parent / "venue_rules.json"

VALID_TYPES = {
    "RESERVED", "GA", "ACCESSIBLE", "RESTRICTED",
    "STAGE", "BAR", "BATHROOM", "DANCING", "PARKING",
    "STAIRS", "WALL", "DOOR", "CHECKIN", "TABLE",
}

# ── Feature extraction ────────────────────────────────────────────────────────

def _extract_features(cnt, img_h: int, img_w: int) -> dict:
    """Compute normalized shape features for a contour."""
    area = cv2.contourArea(cnt)
    img_area = img_h * img_w
    x, y, w, h = cv2.boundingRect(cnt)

    hull = cv2.convexHull(cnt)
    hull_area = cv2.contourArea(hull)
    solidity = area / hull_area if hull_area > 0 else 1.0

    aspect_ratio = w / h if h > 0 else 1.0
    cx_pct = (x + w / 2) / img_w
    cy_pct = (y + h / 2) / img_h
    area_pct = area / img_area

    return {
        "area_pct": area_pct,
        "aspect_ratio": aspect_ratio,
        "cx_pct": cx_pct,
        "cy_pct": cy_pct,
        "solidity": solidity,
        "bbox_pct": {
            "x1": x / img_w,
            "y1": y / img_h,
            "x2": (x + w) / img_w,
            "y2": (y + h) / img_h,
        },
    }


# ── Rule matching ─────────────────────────────────────────────────────────────

def _load_rules() -> list:
    try:
        with open(RULES_PATH) as f:
            data = json.load(f)
        rules = sorted(data["rules"], key=lambda r: r["priority"], reverse=True)
        return rules
    except Exception:
        return []


def _matches(features: dict, conditions: dict) -> Tuple[bool, int]:
    """Return (matches, num_conditions_matched)."""
    matched = 0
    for key, value in conditions.items():
        feat_val = features.get(key)
        if feat_val is None:
            return False, 0
        if key.endswith("_min") or key.endswith("_max"):
            pass  # handled below
        # Keys in conditions use suffix to encode comparisons:
        #   area_pct_min → features["area_pct"] >= value
        #   area_pct_max → features["area_pct"] <= value
        #   cy_pct_min   → features["cy_pct"]   >= value
        #   etc.
        base, op = key.rsplit("_", 1)
        feat_val = features.get(base)
        if feat_val is None:
            return False, 0
        if op == "min" and feat_val < value:
            return False, 0
        if op == "max" and feat_val > value:
            return False, 0
        matched += 1
    return True, matched


def _classify(features: dict, rules: list) -> Tuple[str, float]:
    """Return (sectionType, confidence)."""
    for rule in rules:  # sorted by priority desc
        conditions = rule.get("conditions", {})
        ok, n_matched = _matches(features, conditions)
        if ok:
            # Confidence scales with how many conditions matched and the priority
            confidence = min(0.75, 0.35 + n_matched * 0.12)
            return rule["type"], confidence
    return "RESERVED", 0.30


# ── K-means segmentation ──────────────────────────────────────────────────────

def _kmeans_segments(img_bgr: np.ndarray, k: int = 10) -> np.ndarray:
    """
    Run K-means on pixel colors. Returns a label image (H×W uint8)
    where each pixel is assigned to one of k clusters.
    """
    h, w = img_bgr.shape[:2]
    pixels = img_bgr.reshape(-1, 3).astype(np.float32)

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, _ = cv2.kmeans(
        pixels, k, None, criteria,
        attempts=3, flags=cv2.KMEANS_PP_CENTERS
    )
    return labels.reshape(h, w).astype(np.uint8)


# ── Label generation ──────────────────────────────────────────────────────────

def _make_label(section_type: str, idx: int) -> str:
    prefix = {
        "RESERVED": "Sec", "GA": "GA", "STAGE": "Stg",
        "BAR": "Bar", "BATHROOM": "WC", "DANCING": "Dnc",
        "PARKING": "Prk", "STAIRS": "Str", "DOOR": "Dr",
        "CHECKIN": "Chk", "ACCESSIBLE": "Acc", "RESTRICTED": "Rst",
        "TABLE": "Tbl", "WALL": "Wl",
    }.get(section_type, "Sec")
    return f"{prefix}{idx + 1}"


def _make_name(section_type: str, idx: int) -> str:
    type_names = {
        "RESERVED": "Section", "GA": "GA Area", "STAGE": "Stage",
        "BAR": "Bar", "BATHROOM": "Bathroom", "DANCING": "Dance Floor",
        "PARKING": "Parking", "STAIRS": "Stairs", "DOOR": "Door",
        "CHECKIN": "Check-in", "ACCESSIBLE": "Accessible Area",
        "RESTRICTED": "Restricted", "TABLE": "Table Area", "WALL": "Wall",
    }
    base = type_names.get(section_type, "Section")
    return f"{base} {idx + 1}" if idx > 0 else base


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze_image_locally(
    image_bytes: bytes,
    svg_width: int,
    svg_height: int,
) -> dict:
    """
    Segment an image using K-means color clustering, classify each region
    using venue_rules.json, and return an AnalyzeResponse-compatible dict.
    """
    rules = _load_rules()
    warnings: List[str] = []

    # Decode image
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image — unsupported format or corrupt file")

    img_h, img_w = img.shape[:2]
    img_area = img_h * img_w
    min_area = img_area * 0.005  # drop contours < 0.5% of image

    # Resize large images for faster K-means (process at ≤1200px wide)
    scale = 1.0
    if img_w > 1200:
        scale = 1200 / img_w
        proc = cv2.resize(img, (1200, int(img_h * scale)), interpolation=cv2.INTER_AREA)
    else:
        proc = img.copy()

    proc_h, proc_w = proc.shape[:2]
    proc_area = proc_h * proc_w
    proc_min_area = proc_area * 0.005

    # K-means segmentation
    label_img = _kmeans_segments(proc, k=10)

    # Per-cluster contour detection
    sections: List[SectionResult] = []
    type_counters: dict[str, int] = {}

    for cluster_id in range(10):
        mask = np.where(label_img == cluster_id, 255, 0).astype(np.uint8)

        # Morphological cleanup — close small gaps, remove hair-line noise
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours:
            if cv2.contourArea(cnt) < proc_min_area:
                continue

            feats = _extract_features(cnt, proc_h, proc_w)
            section_type, confidence = _classify(feats, rules)

            # Skip WALL/DOOR — usually the outer perimeter or thin lines
            if section_type in ("WALL",):
                continue

            # Scale bbox back to original image coordinates, then to SVG space
            bp = feats["bbox_pct"]
            left   = round(bp["x1"] * svg_width,  2)
            top    = round(bp["y1"] * svg_height, 2)
            right  = round(bp["x2"] * svg_width,  2)
            bottom = round(bp["y2"] * svg_height, 2)

            if right <= left or bottom <= top:
                continue

            path = (
                f"M {left} {top} L {right} {top} "
                f"L {right} {bottom} L {left} {bottom} Z"
            )

            estimated_seats = 0
            if section_type in SEATED_TYPES:
                uw = max(0.0, (right - left)   - 2 * MARGIN)
                uh = max(0.0, (bottom - top) - 2 * MARGIN)
                estimated_seats = int((uw / SEAT_SPACING_X) * (uh / SEAT_SPACING_Y))

            idx = type_counters.get(section_type, 0)
            type_counters[section_type] = idx + 1

            sections.append(SectionResult(
                name=_make_name(section_type, idx),
                label=_make_label(section_type, idx),
                sectionType=section_type,
                polygonPath=path,
                rows=[],
                sourceLayerName=f"cluster_{cluster_id}",
                confidence=confidence,
                estimatedSeats=estimated_seats,
                bbox={"top": top, "left": left, "bottom": bottom, "right": right},
            ))

    if not sections:
        warnings.append(
            "No regions detected. The image may have too many similar colors "
            "or be too low contrast. Try uploading a cleaner floor plan."
        )

    warnings.append(
        f"Local analyzer used (no API key). {len(sections)} regions detected. "
        "Correct any wrong section types — corrections improve future analysis."
    )

    return {
        "sections": [s.model_dump() for s in sections],
        "psdWidth": svg_width,
        "psdHeight": svg_height,
        "warnings": warnings,
    }


# ── Correction recorder ───────────────────────────────────────────────────────

TRAINING_PATH = Path(__file__).parent / "training_data.jsonl"


def record_correction(
    original_type: str,
    corrected_type: str,
    features: dict,
    bbox: Optional[dict] = None,
) -> None:
    """
    Append one correction record to training_data.jsonl.
    Called by the /record-correction FastAPI endpoint.
    """
    import datetime

    record = {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "original_type": original_type,
        "corrected_type": corrected_type,
        "features": features,
        "bbox": bbox,
    }
    with open(TRAINING_PATH, "a") as f:
        f.write(json.dumps(record) + "\n")
