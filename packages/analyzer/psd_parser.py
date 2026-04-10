from __future__ import annotations

import io
from typing import List, Tuple

from psd_tools import PSDImage

from models import SectionResult
from seat_generator import MARGIN, SEAT_SPACING_X, SEAT_SPACING_Y, SEATED_TYPES

# ---------------------------------------------------------------------------
# Section type keyword mapping (checked against lower-cased layer name)
# ---------------------------------------------------------------------------
SECTION_TYPE_KEYWORDS: dict[str, str] = {
    "stage": "STAGE",
    "screen": "STAGE",
    "bar": "BAR",
    "bathroom": "BATHROOM",
    "restroom": "BATHROOM",
    "toilet": "BATHROOM",
    "wc": "BATHROOM",
    "dance": "DANCING",
    "dancefloor": "DANCING",
    "dancing": "DANCING",
    "floor": "DANCING",
    "parking": "PARKING",
    "stairs": "STAIRS",
    "stair": "STAIRS",
    "staircase": "STAIRS",
    "wall": "WALL",
    "door": "DOOR",
    "entry": "DOOR",
    "exit": "DOOR",
    "gate": "DOOR",
    "checkin": "CHECKIN",
    "check-in": "CHECKIN",
    "entrance": "CHECKIN",
    "reception": "CHECKIN",
    "ga": "GA",
    "standing": "GA",
    "general": "GA",
    "pit": "GA",
    "accessible": "ACCESSIBLE",
    "wheelchair": "ACCESSIBLE",
    "ada": "ACCESSIBLE",
    "restricted": "RESTRICTED",
    "obstructed": "RESTRICTED",
}

# Layer kinds that represent visual content (not helpers/text/groups)
CONTENT_KINDS = {"pixel", "shape", "smartobject", "type"}


def infer_section_type(layer_name: str) -> Tuple[str, float]:
    """Return (sectionType, confidence). Defaults to RESERVED at 0.4."""
    name_lower = layer_name.lower()
    for keyword, stype in SECTION_TYPE_KEYWORDS.items():
        if keyword in name_lower:
            return stype, 0.85
    return "RESERVED", 0.4


def make_label(name: str) -> str:
    """Derive a ≤6-char label from a layer name."""
    words = name.split()
    if len(words) > 1:
        initials = "".join(w[0].upper() for w in words if w)
        return initials[:6]
    return name[:6].upper()


def bounds_to_polygon_path(
    top: float, left: float, bottom: float, right: float
) -> str:
    """Convert scaled bounding box to an SVG polygon path."""
    return (
        f"M {left:.2f} {top:.2f} "
        f"L {right:.2f} {top:.2f} "
        f"L {right:.2f} {bottom:.2f} "
        f"L {left:.2f} {bottom:.2f} Z"
    )


def extract_vector_path(
    layer, psd_w: int, psd_h: int, svg_w: int, svg_h: int
) -> str | None:
    """
    Attempt to read anchor points from a shape layer's vector mask.
    psd-tools returns anchor coordinates as fractions (0.0–1.0) of canvas size.
    Returns an SVG path string scaled to SVG coordinate space, or None.
    """
    try:
        vm = getattr(layer, "vector_mask", None)
        if vm is None:
            return None
        path_records = vm.path
        points: list[tuple[float, float]] = []
        for record in path_records:
            anchor = getattr(record, "anchor", None)
            if anchor is not None:
                # Fractional coords: anchor.horizontal = x/psd_w, anchor.vertical = y/psd_h
                sx = anchor.horizontal * svg_w
                sy = anchor.vertical * svg_h
                points.append((sx, sy))
        if len(points) < 3:
            return None
        parts = [f"M {points[0][0]:.2f} {points[0][1]:.2f}"]
        for p in points[1:]:
            parts.append(f"L {p[0]:.2f} {p[1]:.2f}")
        parts.append("Z")
        return " ".join(parts)
    except Exception:
        return None


def parse_psd(file_bytes: bytes, svg_width: int, svg_height: int) -> dict:
    """
    Parse a PSD file and return a dict matching AnalyzeResponse.
    Extracts visible shape/pixel layers as sections, scales coordinates to the
    target SVG viewBox, infers section types from layer names, and auto-generates
    rows/seats for RESERVED/ACCESSIBLE/RESTRICTED sections.
    """
    psd = PSDImage.open(io.BytesIO(file_bytes))
    psd_w: int = psd.width
    psd_h: int = psd.height
    scale_x: float = svg_width / psd_w
    scale_y: float = svg_height / psd_h

    sections: List[SectionResult] = []
    warnings: List[str] = []
    seen_names: dict[str, int] = {}

    for layer in psd.descendants():
        # Skip invisible layers
        if not layer.is_visible():
            continue

        # Skip groups (folders) — we want leaf layers
        if layer.kind == "group":
            continue

        # Skip pure text layers — they won't become sections
        if layer.kind == "type":
            continue

        bbox = layer.bbox
        w = bbox.right - bbox.left
        h = bbox.bottom - bbox.top

        if w < 10 or h < 10:
            warnings.append(
                f"Skipped tiny layer '{layer.name}' ({w}×{h}px)"
            )
            continue

        # Scale bounding box to SVG coordinate space
        top = bbox.top * scale_y
        left = bbox.left * scale_x
        bottom = bbox.bottom * scale_y
        right = bbox.right * scale_x

        # Try to get vector path for shape layers; fall back to rectangle
        polygon_path: str
        if layer.kind == "shape":
            vp = extract_vector_path(layer, psd_w, psd_h, svg_width, svg_height)
            polygon_path = vp if vp else bounds_to_polygon_path(top, left, bottom, right)
        else:
            polygon_path = bounds_to_polygon_path(top, left, bottom, right)

        section_type, confidence = infer_section_type(layer.name)
        label = make_label(layer.name)

        # Deduplicate names
        name = layer.name
        if name in seen_names:
            seen_names[name] += 1
            name = f"{name} {seen_names[name]}"
        else:
            seen_names[name] = 1

        # Estimate seat count for preview display only — actual seats are
        # generated server-side during import (not here, to keep analysis fast).
        estimated_seats = 0
        if section_type in SEATED_TYPES:
            uw = max(0.0, (right - left) - 2 * MARGIN)
            uh = max(0.0, (bottom - top) - 2 * MARGIN)
            estimated_seats = int((uw / SEAT_SPACING_X) * (uh / SEAT_SPACING_Y))

        sections.append(SectionResult(
            name=name,
            label=label,
            sectionType=section_type,
            polygonPath=polygon_path,
            rows=[],
            sourceLayerName=layer.name,
            confidence=confidence,
            estimatedSeats=estimated_seats,
            bbox={"top": round(top, 2), "left": round(left, 2), "bottom": round(bottom, 2), "right": round(right, 2)},
        ))

    return {
        "sections": [s.model_dump() for s in sections],
        "psdWidth": psd_w,
        "psdHeight": psd_h,
        "warnings": warnings,
    }
