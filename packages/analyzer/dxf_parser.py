from __future__ import annotations

import io
import math
from typing import List, Tuple

import ezdxf
from ezdxf import recover

from models import SectionResult
from psd_parser import infer_section_type, make_label
from seat_generator import MARGIN, SEAT_SPACING_X, SEAT_SPACING_Y, SEATED_TYPES

# ---------------------------------------------------------------------------
# Layers to always skip (AutoCAD system layers / dimension helpers)
# ---------------------------------------------------------------------------
SKIP_LAYERS = {"defpoints", "acad_pstylemode"}

# Minimum polygon area in model units² to be considered a section
# (filters out tiny annotation shapes, dimension ticks, etc.)
MIN_AREA_FRACTION = 0.0005  # must be at least 0.05% of total model area


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def polygon_area(pts: List[Tuple[float, float]]) -> float:
    """Shoelace formula — returns absolute area of a polygon."""
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def arc_to_points(cx: float, cy: float, r: float,
                  start_deg: float, end_deg: float,
                  segments: int = 16) -> List[Tuple[float, float]]:
    """Approximate an arc with line segments."""
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    if end < start:
        end += 2 * math.pi
    step = (end - start) / segments
    return [(cx + r * math.cos(start + i * step),
             cy + r * math.sin(start + i * step))
            for i in range(segments + 1)]


def circle_to_points(cx: float, cy: float, r: float,
                     segments: int = 24) -> List[Tuple[float, float]]:
    return [(cx + r * math.cos(2 * math.pi * i / segments),
             cy + r * math.sin(2 * math.pi * i / segments))
            for i in range(segments)]


def lwpolyline_pts(entity) -> List[Tuple[float, float]]:
    """Extract (x, y) from an LWPOLYLINE (ignores bulge/width)."""
    return [(p[0], p[1]) for p in entity.get_points()]


def polyline_pts(entity) -> List[Tuple[float, float]]:
    """Extract (x, y) from an old-style POLYLINE."""
    return [(v.dxf.location.x, v.dxf.location.y)
            for v in entity.vertices
            if hasattr(v.dxf, "location")]


def hatch_boundary_pts(entity) -> List[List[Tuple[float, float]]]:
    """Extract outer boundary polygons from a HATCH entity."""
    polys: List[List[Tuple[float, float]]] = []
    for path in entity.paths:
        pts: List[Tuple[float, float]] = []
        if hasattr(path, "vertices"):
            pts = [(v[0], v[1]) for v in path.vertices]
        elif hasattr(path, "edges"):
            for edge in path.edges:
                etype = type(edge).__name__
                if etype == "LineEdge":
                    pts.append((edge.start[0], edge.start[1]))
                elif etype == "ArcEdge":
                    pts.extend(arc_to_points(
                        edge.center[0], edge.center[1], edge.radius,
                        edge.start_angle, edge.end_angle))
        if len(pts) >= 3:
            polys.append(pts)
    return polys


# ---------------------------------------------------------------------------
# Coordinate scaling: model space → SVG space
# DXF Y-axis points UP; SVG Y-axis points DOWN → flip Y
# ---------------------------------------------------------------------------

def make_scaler(min_x: float, min_y: float,
                model_w: float, model_h: float,
                svg_w: int, svg_h: int):
    def to_svg(x: float, y: float) -> Tuple[float, float]:
        sx = (x - min_x) / model_w * svg_w
        sy = (1.0 - (y - min_y) / model_h) * svg_h  # flip Y
        return round(sx, 2), round(sy, 2)
    return to_svg


def points_to_path(pts: List[Tuple[float, float]]) -> str:
    first = pts[0]
    rest = pts[1:]
    return f"M {first[0]} {first[1]} " + " ".join(f"L {p[0]} {p[1]}" for p in rest) + " Z"


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def parse_dxf(file_bytes: bytes, svg_width: int, svg_height: int) -> dict:
    """
    Parse a DXF (or best-effort DWG) file and return a dict matching
    AnalyzeResponse. Groups closed polygon entities by DXF layer, infers
    section types from layer names, and auto-generates rows/seats.
    """
    # DWG files start with "AC" + 4-char version (e.g. "AC1015", "AC1032").
    # ezdxf cannot read DWG — it only handles DXF (ASCII or binary R2007+).
    if file_bytes[:2] == b"AC":
        raise ValueError(
            "This is a DWG file. ezdxf cannot read DWG directly. "
            "In AutoCAD: File → Save As → AutoCAD DXF (.dxf). "
            "In LibreCAD or FreeCAD: File → Export → DXF."
        )

    try:
        doc, auditor = recover.read(io.BytesIO(file_bytes))
    except Exception as exc:
        raise ValueError(f"Could not read DXF/DWG: {exc}") from exc

    warnings: List[str] = []
    if auditor.has_errors:
        warnings.append(f"File had {len(auditor.errors)} recoverable error(s)")

    msp = doc.modelspace()

    # ── Pass 1: collect all closed polygons in model space ────────────────
    # layer_name -> list of (points, area) tuples
    layer_polygons: dict[str, List[Tuple[List[Tuple[float, float]], float]]] = {}

    def add_polygon(layer: str, pts: List[Tuple[float, float]]) -> None:
        if len(pts) < 3:
            return
        area = polygon_area(pts)
        if area <= 0:
            return
        if layer not in layer_polygons:
            layer_polygons[layer] = []
        layer_polygons[layer].append((pts, area))

    for entity in msp:
        try:
            etype = entity.dxftype()
            layer = entity.dxf.layer if hasattr(entity.dxf, "layer") else "0"

            if etype == "LWPOLYLINE":
                pts = lwpolyline_pts(entity)
                if entity.is_closed and len(pts) >= 3:
                    add_polygon(layer, pts)

            elif etype == "POLYLINE":
                pts = polyline_pts(entity)
                closed = bool(entity.dxf.get("flags", 0) & 1)
                if closed and len(pts) >= 3:
                    add_polygon(layer, pts)

            elif etype == "CIRCLE":
                cx, cy = entity.dxf.center.x, entity.dxf.center.y
                pts = circle_to_points(cx, cy, entity.dxf.radius)
                add_polygon(layer, pts)

            elif etype == "HATCH":
                for poly in hatch_boundary_pts(entity):
                    add_polygon(layer, poly)

        except Exception:
            continue

    if not layer_polygons:
        raise ValueError("No closed polygon shapes found in the file")

    # ── Pass 2: area-based filtering using the 75th-percentile polygon ──────
    # max_area is dominated by the outer building perimeter and makes everything
    # else look tiny. Using the 75th-percentile area as the reference gives a
    # threshold that reflects typical meaningful shapes in the file.
    all_areas = sorted(area for polys in layer_polygons.values() for _, area in polys)
    p75 = all_areas[int(len(all_areas) * 0.75)] if all_areas else 1.0
    # Keep anything >= 0.1% of the 75th-percentile shape.
    # This is intentionally permissive — junk sections are deselected in the
    # preview modal rather than being silently dropped here.
    min_area = p75 * 0.001

    valid_layer_polys: dict[str, List[List[Tuple[float, float]]]] = {}
    skipped_layers: List[str] = []
    for layer_name, polys in layer_polygons.items():
        if layer_name.lower() in SKIP_LAYERS:
            continue
        kept = [pts for pts, area in polys if area >= min_area]
        if not kept:
            skipped_layers.append(layer_name)
            continue
        valid_layer_polys[layer_name] = kept

    if skipped_layers:
        warnings.append(f"{len(skipped_layers)} layers had only annotation-sized shapes and were skipped")

    if not valid_layer_polys:
        raise ValueError("All shapes were below the minimum size threshold")

    # ── Pass 3: tight bounding box from valid polygons only ───────────────
    # Ignores far-away annotation elements — gives proper SVG scaling.
    content_pts = [pt for polys in valid_layer_polys.values() for poly in polys for pt in poly]
    min_x = min(p[0] for p in content_pts)
    max_x = max(p[0] for p in content_pts)
    min_y = min(p[1] for p in content_pts)
    max_y = max(p[1] for p in content_pts)

    model_w = max_x - min_x or 1.0
    model_h = max_y - min_y or 1.0

    to_svg = make_scaler(min_x, min_y, model_w, model_h, svg_width, svg_height)

    # ── Build sections ────────────────────────────────────────────────────
    sections: List[SectionResult] = []

    for layer_name, polygons in valid_layer_polys.items():

        section_type, confidence = infer_section_type(layer_name)

        # Sort largest first so the primary shape of a layer is index 0
        polygons.sort(key=polygon_area, reverse=True)

        for idx, poly in enumerate(polygons):
            svg_pts = [to_svg(x, y) for x, y in poly]
            path = points_to_path(svg_pts)

            xs = [p[0] for p in svg_pts]
            ys = [p[1] for p in svg_pts]
            bbox_top    = min(ys)
            bbox_left   = min(xs)
            bbox_bottom = max(ys)
            bbox_right  = max(xs)

            name = layer_name if len(polygons) == 1 else f"{layer_name} {idx + 1}"

            # Estimate seat count for preview only; actual seats generated server-side on import
            estimated_seats = 0
            if section_type in SEATED_TYPES:
                uw = max(0.0, (bbox_right - bbox_left) - 2 * MARGIN)
                uh = max(0.0, (bbox_bottom - bbox_top) - 2 * MARGIN)
                estimated_seats = int((uw / SEAT_SPACING_X) * (uh / SEAT_SPACING_Y))

            sections.append(SectionResult(
                name=name,
                label=make_label(name),
                sectionType=section_type,
                polygonPath=path,
                rows=[],
                sourceLayerName=layer_name,
                confidence=confidence,
                estimatedSeats=estimated_seats,
                bbox={"top": round(bbox_top, 2), "left": round(bbox_left, 2),
                      "bottom": round(bbox_bottom, 2), "right": round(bbox_right, 2)},
            ))

    if not sections:
        warnings.append("No closed polygon shapes found. Make sure sections are drawn as closed polylines in AutoCAD.")

    return {
        "sections": [s.model_dump() for s in sections],
        "psdWidth": svg_width,   # reuse same fields; no native canvas size for DXF
        "psdHeight": svg_height,
        "warnings": warnings,
    }
