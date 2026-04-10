"""
Generates test_venue.dxf — a realistic venue with varied, irregular shapes
to stress-test both the layer parser and Claude vision analyzer.

Shapes used:
  - Simple rectangles (stage, bar, checkin)
  - L-shaped polygon (seating section wrapping a corner)
  - Trapezoid (fan-shaped GA floor)
  - Hexagon (round bar / circular dance floor)
  - Irregular polygon (accessible section with cutout)
  - Thin rectangles (walls, doors)
  - Overlapping-edge stairwells (touching but not overlapping)
  - Angled parking bays (rotated rectangle via polygon)

Usage (from packages/analyzer/ with venv active):
    python generate_test_venue.py
"""

import math
import ezdxf
from ezdxf.enums import TextEntityAlignment


def poly(msp, layer: str, points: list[tuple[float, float]], close: bool = True):
    msp.add_lwpolyline(points, close=close, dxfattribs={"layer": layer})


def rect(msp, layer: str, x: float, y: float, w: float, h: float):
    poly(msp, layer, [(x, y), (x+w, y), (x+w, y+h), (x, y+h)])


def circle_pts(cx, cy, r, n=20):
    return [(cx + r * math.cos(2*math.pi*i/n),
             cy + r * math.sin(2*math.pi*i/n)) for i in range(n)]


def regular_polygon_pts(cx, cy, r, sides, start_angle_deg=0):
    return [(cx + r * math.cos(math.radians(start_angle_deg + 360*i/sides)),
             cy + r * math.sin(math.radians(start_angle_deg + 360*i/sides)))
            for i in range(sides)]


def label(msp, text, cx, cy, h=2.5):
    msp.add_text(text, dxfattribs={"layer": "LABELS", "height": h}).set_placement(
        (cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)


doc = ezdxf.new("R2010")
msp = doc.modelspace()

# ═══════════════════════════════════════════════════════════
#  CANVAS  200 × 150  (all shapes tile without overlap)
#
#  The venue is intentionally asymmetric to challenge vision:
#  left side = tiered seating, right side = open + tables
# ═══════════════════════════════════════════════════════════

# ── Outer perimeter (two rectangles joined = L-shaped venue) ─
# Main hall: 0–140 wide, 0–150 tall
poly(msp, "WALL", [
    (0, 0), (140, 0), (140, 80), (200, 80),
    (200, 150), (0, 150)
])
label(msp, "VENUE OUTLINE", 100, 145, h=2)

# ── STAGE — trapezoid (wider at back, narrower at front) ─────
#   Simulates a thrust stage
poly(msp, "STAGE", [
    (20, 120), (120, 120),   # back edge (wide)
    (100, 140), (40, 140),   # front edge (narrower)
])
label(msp, "STAGE", 70, 130)

# ── GA floor — fan / trapezoid spreading from stage ──────────
poly(msp, "GA", [
    (10, 85), (130, 85),
    (120, 120), (20, 120),
])
label(msp, "STANDING GA", 70, 102)

# ── RESERVED Section A — L-shaped (wraps around left corner) ─
poly(msp, "RESERVED", [
    (0, 30), (30, 30),
    (30, 55), (15, 55),
    (15, 80), (0, 80),
])
label(msp, "Sec A", 12, 52, h=2)

# ── RESERVED Section B — simple rectangle, left mid ──────────
rect(msp, "RESERVED", 0, 0, 30, 28)
label(msp, "Sec B", 15, 14)

# ── RESERVED Section C — rectangle, bottom centre ────────────
rect(msp, "RESERVED", 32, 0, 40, 30)
label(msp, "Sec C", 52, 15)

# ── RESERVED Section D — wider rectangle, bottom right ───────
rect(msp, "RESERVED", 74, 0, 64, 30)
label(msp, "Sec D", 106, 15)

# ── ACCESSIBLE — irregular 5-point polygon (notched corner) ──
poly(msp, "ACCESSIBLE", [
    (32, 32), (70, 32),
    (70, 55), (50, 55),
    (50, 45), (32, 45),
])
label(msp, "ACCESS", 50, 40, h=2)

# ── RESTRICTED — right side, irregular quadrilateral ─────────
poly(msp, "RESTRICTED", [
    (74, 32), (138, 32),
    (138, 58), (74, 58),
])
label(msp, "RESTRICTED", 106, 45)

# ── DANCING — hexagon (circular dance floor feel) ─────────────
dance_pts = regular_polygon_pts(cx=170, cy=115, r=22, sides=6, start_angle_deg=30)
poly(msp, "DANCING", dance_pts)
label(msp, "DANCE\nFLOOR", 170, 115)

# ── TABLE section — small rectangles scattered (banquet style) ─
for i, (tx, ty) in enumerate([(145, 82), (155, 82), (165, 82),
                                (145, 95), (155, 95), (165, 95)]):
    rect(msp, "TABLE", tx, ty, 8, 6)
label(msp, "BANQUET TABLES", 158, 104, h=2)

# ── BAR — elongated rectangle along right wall ────────────────
rect(msp, "BAR", 142, 80, 58, 14)
label(msp, "BAR", 171, 87)

# ── BATHROOM — two small rectangles (M/F) ────────────────────
rect(msp, "BATHROOM", 142, 32, 14, 14)
label(msp, "WC M", 149, 39, h=2)
rect(msp, "BATHROOM", 158, 32, 14, 14)
label(msp, "WC F", 165, 39, h=2)

# ── CHECKIN / entrance — bottom centre ───────────────────────
rect(msp, "CHECKIN", 55, -15, 50, 14)
label(msp, "ENTRANCE / CHECK-IN", 80, -8)

# ── DOOR openings — thin rectangles on walls ──────────────────
rect(msp, "DOOR",  55,  0, 20, 3)    # front centre door
rect(msp, "DOOR",   0, 55, 3, 15)    # left side door
rect(msp, "DOOR", 197, 95, 3, 15)    # right side door

# ── STAIRS — two L-shaped stairwells at corners ───────────────
poly(msp, "STAIRS", [
    (0, 82), (13, 82), (13, 84),
    (8, 84), (8, 100), (0, 100),
])
label(msp, "STAIR", 5, 90, h=1.8)

poly(msp, "STAIRS", [
    (127, 82), (140, 82), (140, 100),
    (132, 100), (132, 84), (127, 84),
])
label(msp, "STAIR", 135, 90, h=1.8)

# ── PARKING — angled bays (rotated rectangle via polygon) ─────
# Simulate diagonal parking stripes
for i in range(6):
    ox = 10 + i * 22
    poly(msp, "PARKING", [
        (ox,     -18), (ox+16, -18),
        (ox+20,  -2),  (ox+4,   -2),
    ])
label(msp, "PARKING (ANGLED BAYS)", 80, -22, h=2)

# ── Internal partition walls ───────────────────────────────────
# Horizontal wall separating GA from seating
poly(msp, "WALL", [(0, 83), (140, 83)], close=False)
# Vertical partition between reserved and restricted
poly(msp, "WALL", [(72, 0), (72, 60)], close=False)
# Right section wall
poly(msp, "WALL", [(140, 0), (140, 80)], close=False)

out = "test_venue.dxf"
doc.saveas(out)

print(f"✓  Written: {out}")
print()
print("  Shapes used:")
print("  STAGE        — trapezoid (asymmetric thrust stage)")
print("  GA           — fan/trapezoid spreading from stage")
print("  RESERVED ×4  — 1× L-shape, 3× rectangles (varied sizes)")
print("  ACCESSIBLE   — irregular 5-point notched polygon")
print("  RESTRICTED   — wide quadrilateral on the right")
print("  DANCING      — hexagon (circular dance floor)")
print("  TABLE ×6     — small banquet table rectangles")
print("  BAR          — long rectangle along right wall")
print("  BATHROOM ×2  — two small adjacent rectangles (M/F)")
print("  CHECKIN      — rectangle below the venue")
print("  DOOR ×3      — thin rectangles on walls")
print("  STAIRS ×2    — L-shaped stairwells at corners")
print("  PARKING      — 6× angled (rotated) parallelogram bays")
print("  WALL         — perimeter + internal partitions")
