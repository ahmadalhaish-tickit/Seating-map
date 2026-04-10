"""
Vision-based floor plan analyzer.

Pipeline:
  1. Render the file to a PNG (DXF via ezdxf+matplotlib, PSD via pillow flatten)
  2. Send the PNG to Claude vision with a structured prompt
  3. Claude returns JSON describing each zone with its type and bbox %
  4. Scale % coords → SVG coordinate space
  5. Return list of SectionResult (rows=[], bbox set — seats generated server-side)

Falls back gracefully if ANTHROPIC_API_KEY is not set.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
from typing import List, Optional, Tuple

from models import SectionResult
from seat_generator import MARGIN, SEAT_SPACING_X, SEAT_SPACING_Y, SEATED_TYPES

VALID_TYPES = {
    "RESERVED", "GA", "ACCESSIBLE", "RESTRICTED",
    "STAGE", "BAR", "BATHROOM", "DANCING", "PARKING",
    "STAIRS", "WALL", "DOOR", "CHECKIN", "TEXT", "TABLE",
}

# ── Claude prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a venue floor plan analyzer. You receive an image of a floor plan and \
must identify every distinct zone or section and return structured JSON.

Rules:
- Identify ALL visible distinct areas: seating blocks, stage, bar, GA floor, \
  accessible areas, bathrooms, dance floors, etc.
- Zones must NOT overlap. If two shapes overlap visually, pick the most specific one.
- Return ONLY a JSON array — no markdown, no explanation, no code fences.
- Each element: {"name": str, "type": str, "bbox": {"x1": %, "y1": %, "x2": %, "y2": %}}
- For TABLE type, also include "chairs": int — count the visible chair symbols around that specific \
  table. If text in the image states the chair count (e.g. "10 chairs"), use that number.
- bbox values are percentages (0–100) of the image width/height. \
  x1/y1 = top-left corner, x2/y2 = bottom-right corner.
- IMPORTANT: bbox must tightly wrap ONLY that specific element — do not extend into \
  neighboring zones or empty space. Each bbox should be as tight as possible around \
  the actual footprint of that element (walls, surface, or marked boundary). \
  Do not extend bbox beyond the floor plan boundary. \
  Ignore black margins, white borders, or empty space around the plan.
- "name" is a short human label (e.g. "Section A", "Main Stage", "North Bar").
- "type" must be exactly one of: \
  RESERVED, GA, ACCESSIBLE, RESTRICTED, STAGE, BAR, BATHROOM, \
  DANCING, PARKING, STAIRS, WALL, DOOR, CHECKIN, TABLE

Type selection guide:
- TABLE: detect EACH individual table separately — one zone per table. \
  Round tables with chairs around them get their own zone sized to that single table only \
  (bbox should tightly wrap the table surface + its chairs, not extend to neighboring tables). \
  Do NOT merge multiple tables into one large zone. \
  For "name": read the text label printed INSIDE or directly beside the table circle in the image \
  (e.g. "V4", "B3", "G10", "T12"). Use that exact text as the name. \
  If no label is visible, use "T1", "T2" etc. \
  If you detect individual tables filling an area, do NOT also create a DANCING, GA, RESERVED, \
  or any other large background zone covering that same table area.
- RESERVED: rows of seats all facing the same direction (theater/concert style). \
  Group a contiguous block of rows into one RESERVED zone.
- STAIRS: small rectangular area with step lines or labeled "stairs". Near walls, narrow.
- GA: open floor for standing crowds, no individual seats visible.
- STAGE: raised performance platform, usually at one end.
- DANCING: open area explicitly labeled or clearly intended as a dance floor.
- CHECKIN: entry/lobby/registration area near an entrance.
- WALL: only thick structural walls or columns drawn as filled shapes.
- RESTRICTED: areas explicitly marked staff-only.
- Default for unidentified regions: RESERVED.
- Do not return the overall building outline as a section.
- "name" should be short and simple: "Table 1", "Round Table A", "Stage", "Bar", "Fire Exit". \
  Avoid long descriptive names — keep them under 4 words.
"""

USER_PROMPT = """\
Analyze this venue floor plan. Identify every distinct zone.
Return only a JSON array as described. No other text.\
"""


# ── Rendering helpers ─────────────────────────────────────────────────────────

def render_dxf_to_png(file_bytes: bytes, width_px: int = 1200, height_px: int = 800) -> bytes:
    """Render a DXF file to PNG using ezdxf's matplotlib backend."""
    import ezdxf
    from ezdxf import recover
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    doc, _ = recover.read(io.BytesIO(file_bytes))
    fig = plt.figure(figsize=(width_px / 100, height_px / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("white")
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(doc.modelspace(), finalize=True)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight",
                facecolor="white", dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def render_psd_to_png(file_bytes: bytes, width_px: int = 1200, height_px: int = 800) -> bytes:
    """Flatten a PSD and return a resized PNG."""
    from PIL import Image
    from psd_tools import PSDImage

    psd = PSDImage.open(io.BytesIO(file_bytes))
    img = psd.composite()          # flatten all visible layers
    img = img.convert("RGB")
    img.thumbnail((width_px, height_px), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


# ── Claude call ───────────────────────────────────────────────────────────────

def _detect_media_type(image_bytes: bytes) -> str:
    """Detect image media type from magic bytes."""
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:4] == b"\x89PNG":
        return "image/png"
    if image_bytes[:4] in (b"RIFF",) and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"  # fallback


class CropInfo:
    """Records where the cropped region sits within the original image."""
    def __init__(self, c0: int, r0: int, c1: int, r1: int, orig_w: int, orig_h: int):
        self.c0 = c0; self.r0 = r0; self.c1 = c1; self.r1 = r1
        self.orig_w = orig_w; self.orig_h = orig_h
        self.crop_w = c1 - c0  # width of cropped region in original pixels
        self.crop_h = r1 - r0  # height of cropped region in original pixels


def autocrop_to_content(
    image_bytes: bytes, threshold: int = 25, pad: int = 8
) -> Tuple[bytes, CropInfo]:
    """
    Crop away black/near-black borders. Returns (cropped_bytes, CropInfo).
    CropInfo records where the crop sits in the original image so callers can
    map Claude's crop-relative percentages back to original image coordinates.
    If no significant border found, returns original bytes with a full-image CropInfo.
    """
    import numpy as np
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]

    content = np.any(arr > threshold, axis=2)
    rows = np.where(np.any(content, axis=1))[0]
    cols = np.where(np.any(content, axis=0))[0]

    if len(rows) == 0 or len(cols) == 0:
        return image_bytes, CropInfo(0, 0, w, h, w, h)

    r0, r1 = int(rows[0]), int(rows[-1])
    c0, c1 = int(cols[0]), int(cols[-1])

    # Only crop if we'd actually remove something meaningful (> 2% of dimension)
    if r0 < h * 0.02 and r1 > h * 0.98 and c0 < w * 0.02 and c1 > w * 0.98:
        return image_bytes, CropInfo(0, 0, w, h, w, h)

    r0 = max(0, r0 - pad)
    r1 = min(h - 1, r1 + pad)
    c0 = max(0, c0 - pad)
    c1 = min(w - 1, c1 + pad)

    cropped = img.crop((c0, r0, c1 + 1, r1 + 1))
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    buf.seek(0)
    return buf.read(), CropInfo(c0, r0, c1 + 1, r1 + 1, w, h)


def call_claude_vision(png_bytes: bytes, api_key: str) -> List[dict]:
    """
    Send the image to Claude claude-sonnet-4-6 and parse the returned JSON array.
    Returns a list of raw zone dicts: {name, type, bbox: {x1,y1,x2,y2}}.
    """
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    b64 = base64.standard_b64encode(png_bytes).decode()
    media_type = _detect_media_type(png_bytes)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": b64},
                },
                {"type": "text", "text": USER_PROMPT},
            ],
        }],
    )

    raw = message.content[0].text.strip()

    # Strip any accidental markdown fences
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)

    try:
        zones = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Claude returned non-JSON: {raw[:300]}") from exc

    if not isinstance(zones, list):
        raise ValueError(f"Expected JSON array, got: {type(zones)}")

    return zones


# ── Convert zones → SectionResult ────────────────────────────────────────────

def _make_label(name: str) -> str:
    import re
    # Strip punctuation, then take first letter of each word (max 4 words → max 4 chars)
    clean = re.sub(r"[^a-zA-Z0-9 ]", "", name).strip()
    words = [w for w in clean.split() if w and w[0].isalpha()][:4]
    if len(words) > 1:
        return "".join(w[0].upper() for w in words)
    # Single word: use up to first 4 alphanumeric chars
    return re.sub(r"[^A-Z0-9]", "", name.upper())[:4] or name[:4].upper()


def zones_to_sections(
    zones: List[dict],
    svg_width: int,
    svg_height: int,
    crop_info: Optional["CropInfo"] = None,
) -> Tuple[List[SectionResult], List[str]]:
    """
    Convert Claude's percentage-bbox zones into SectionResult objects.

    crop_info: if provided, Claude analyzed a cropped sub-region of a larger original image.
    The original image is displayed in the SVG canvas with preserveAspectRatio="xMidYMid meet"
    (letterboxed). We map through three steps:
      1. Claude pct → pixel in cropped image
      2. pixel in crop → pixel in original image  (add crop offset)
      3. pixel in original → SVG coordinate        (letterbox scale + centering offset)
    When crop_info is None (DXF/PSD path where the render is already SVG-sized), direct mapping.
    """
    if crop_info is not None:
        # Letterbox math for the ORIGINAL image as displayed in SVG
        scale = min(svg_width / crop_info.orig_w, svg_height / crop_info.orig_h)
        disp_w = crop_info.orig_w * scale
        disp_h = crop_info.orig_h * scale
        x_off = (svg_width  - disp_w) / 2
        y_off = (svg_height - disp_h) / 2

        def pct_to_svg_x(pct: float) -> float:
            # pct is % of cropped image width → pixel in crop → pixel in original → SVG x
            px_in_orig = crop_info.c0 + (pct / 100) * crop_info.crop_w
            return x_off + (px_in_orig / crop_info.orig_w) * disp_w

        def pct_to_svg_y(pct: float) -> float:
            py_in_orig = crop_info.r0 + (pct / 100) * crop_info.crop_h
            return y_off + (py_in_orig / crop_info.orig_h) * disp_h
    else:
        # Direct 1:1 mapping (DXF/PSD renders at exact SVG dimensions)
        def pct_to_svg_x(pct: float) -> float:
            return pct / 100 * svg_width

        def pct_to_svg_y(pct: float) -> float:
            return pct / 100 * svg_height
    sections: List[SectionResult] = []
    warnings: List[str] = []
    table_counter = 0

    for z in zones:
        try:
            name = str(z.get("name", "Section")).strip() or "Section"
            raw_type = str(z.get("type", "RESERVED")).upper().strip()
            section_type = raw_type if raw_type in VALID_TYPES else "RESERVED"
            bbox_pct = z.get("bbox", {})

            x1_pct = float(bbox_pct.get("x1", 0))
            y1_pct = float(bbox_pct.get("y1", 0))
            x2_pct = float(bbox_pct.get("x2", 100))
            y2_pct = float(bbox_pct.get("y2", 100))

            # Normalise — Claude sometimes returns coordinates swapped or out of order
            x1_pct, x2_pct = sorted([x1_pct, x2_pct])
            y1_pct, y2_pct = sorted([y1_pct, y2_pct])

            # Clamp to 0–100
            x1_pct = max(0.0, min(100.0, x1_pct))
            y1_pct = max(0.0, min(100.0, y1_pct))
            x2_pct = max(0.0, min(100.0, x2_pct))
            y2_pct = max(0.0, min(100.0, y2_pct))

            if x2_pct <= x1_pct or y2_pct <= y1_pct:
                warnings.append(f"Zone '{name}' has invalid bbox, skipped")
                continue

            # Scale to SVG coords via crop-offset + letterbox mapping
            left   = round(pct_to_svg_x(x1_pct), 2)
            top    = round(pct_to_svg_y(y1_pct), 2)
            right  = round(pct_to_svg_x(x2_pct), 2)
            bottom = round(pct_to_svg_y(y2_pct), 2)

            path = (
                f"M {left} {top} L {right} {top} "
                f"L {right} {bottom} L {left} {bottom} Z"
            )

            estimated_seats = 0
            if section_type in SEATED_TYPES:
                uw = max(0.0, (right - left)   - 2 * MARGIN)
                uh = max(0.0, (bottom - top) - 2 * MARGIN)
                estimated_seats = int((uw / SEAT_SPACING_X) * (uh / SEAT_SPACING_Y))

            # Chair count for TABLE — from Claude's "chairs" field if present
            table_chairs: Optional[int] = None
            if section_type == "TABLE":
                raw_chairs = z.get("chairs")
                if isinstance(raw_chairs, (int, float)) and raw_chairs > 0:
                    table_chairs = int(raw_chairs)
                table_counter += 1
                # Use the text Claude read from inside the table; fall back to T1/T2/...
                raw_label = name.strip()
                label = raw_label if len(raw_label) <= 6 else _make_label(name)
            else:
                label = _make_label(name)

            sections.append(SectionResult(
                name=name,
                label=label,
                sectionType=section_type,
                polygonPath=path,
                rows=[],
                sourceLayerName=name,
                confidence=0.9,      # Claude vision is high confidence
                estimatedSeats=estimated_seats,
                bbox={"top": top, "left": left, "bottom": bottom, "right": right},
                tableChairs=table_chairs,
            ))

        except Exception as exc:
            warnings.append(f"Skipped zone: {exc}")

    # Post-process: drop non-TABLE zones that are almost entirely INSIDE a single table bbox.
    # This catches cases where Claude returns a "Dance Floor" zone that is really just one
    # large table cluster. We only drop it if it fits inside one table's bbox with >80% overlap
    # of the non-TABLE zone's own area. Using a single-table test (not cumulative sum) prevents
    # accidentally dropping STAGE/BAR objects that merely border several tables.
    table_bboxes = [
        s.bbox for s in sections if s.sectionType == "TABLE" and s.bbox
    ]

    def _overlap_area(a: dict, b: dict) -> float:
        ix1 = max(a["left"], b["left"]); ix2 = min(a["right"], b["right"])
        iy1 = max(a["top"],  b["top"]);  iy2 = min(a["bottom"], b["bottom"])
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        return (ix2 - ix1) * (iy2 - iy1)

    filtered: List[SectionResult] = []
    for s in sections:
        if s.sectionType == "TABLE" or not s.bbox:
            filtered.append(s)
            continue
        b = s.bbox
        area = max(1.0, (b["right"] - b["left"]) * (b["bottom"] - b["top"]))
        # Only drop if THIS zone fits almost entirely inside a single table bbox
        max_single_overlap = max((_overlap_area(b, tb) for tb in table_bboxes), default=0.0)
        if max_single_overlap / area > 0.80:
            warnings.append(f"Zone '{s.name}' contained within a table zone — skipped")
            continue
        filtered.append(s)

    return filtered, warnings


# ── Public entry points ───────────────────────────────────────────────────────

def analyze_dxf_with_vision(
    file_bytes: bytes,
    svg_width: int,
    svg_height: int,
    api_key: str,
) -> dict:
    png = render_dxf_to_png(file_bytes)
    zones = call_claude_vision(png, api_key)
    sections, warnings = zones_to_sections(zones, svg_width, svg_height)
    return {
        "sections": [s.model_dump() for s in sections],
        "psdWidth": svg_width,
        "psdHeight": svg_height,
        "warnings": warnings,
    }


def analyze_psd_with_vision(
    file_bytes: bytes,
    svg_width: int,
    svg_height: int,
    api_key: str,
) -> dict:
    png = render_psd_to_png(file_bytes)
    zones = call_claude_vision(png, api_key)
    sections, warnings = zones_to_sections(zones, svg_width, svg_height)
    return {
        "sections": [s.model_dump() for s in sections],
        "psdWidth": svg_width,
        "psdHeight": svg_height,
        "warnings": warnings,
    }
