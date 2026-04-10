import { useState, useRef, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
type SeatShapeType = "circle" | "square" | "triangle" | "chair" | "wheelchair";
type TableShape = "rectangle" | "round" | "square" | "oval" | "booth";
interface TableMeta { shape: TableShape; w: number; h: number; cpl: number; cps: number; angle: number; selectMode?: "whole" | "seat" }
interface DoorMeta { w: number; h: number; angle: number }

interface Point { x: number; y: number }
interface SeatDot {
  id: string; x: number; y: number;
  seatNumber: string; rowLabel: string; rowId: string;
  shape?: SeatShapeType;
  zoneId?: string;  // per-seat pricing zone (overrides section-level zone)
}
interface RowInfo { id: string; label: string; curve: number; skew: number; }
interface DraftSection {
  id: string; name: string; label: string;
  sectionType: "RESERVED" | "GA" | "ACCESSIBLE" | "RESTRICTED" | "TABLE" | "TEXT" | VenueObjectType;
  points: Point[]; zoneId?: string; saved: boolean;
  edgeCurve: number;
  capacity?: number;   // GA / no-seat sections: total available spots
  maxPerOrder?: number; // GA: max tickets per order
  hideSeats?: boolean;  // Seated sections: hide seats until user clicks
  rows?: RowInfo[];
  seats?: SeatDot[];
  tableMeta?: TableMeta;
  doorMeta?: DoorMeta;
  stairsMeta?: DoorMeta;
  iconOffset?: { x: number; y: number };
  labelOffset?: { x: number; y: number };
  iconSize?: number;
  labelSize?: number;
  showIcon?: boolean;
  showLabel?: boolean;
  textColor?: string;
  textBold?: boolean;
  textAngle?: number;
}
interface Zone { id: string; name: string; color: string }
interface MapHold { id: string; name: string; color: string; seats: { seatId: string }[] }
interface MapEditorProps {
  mapId: string; svgViewBox: string;
  bgImageUrl?: string; initialZones?: Zone[];
}
type Tool = "select" | "polygon" | "seated" | "table" | "object" | "text";

// ── Venue object types ─────────────────────────────────────────────────────
const VENUE_OBJECT_TYPES = ["STAGE","BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN"] as const;
type VenueObjectType = typeof VENUE_OBJECT_TYPES[number];
const VENUE_OBJECT_CFG: Record<VenueObjectType, { label: string; color: string }> = {
  STAGE:    { label: "Stage",       color: "#C49A3C" },
  BAR:      { label: "Bar",         color: "#A0522D" },
  BATHROOM: { label: "Bathroom",    color: "#4A90D9" },
  DANCING:  { label: "Dance Floor", color: "#9B59B6" },
  PARKING:  { label: "Parking",     color: "#27AE60" },
  STAIRS:   { label: "Stairs",      color: "#7F8C8D" },
  WALL:     { label: "Wall",        color: "#555566" },
  DOOR:     { label: "Door",        color: "#E67E22" },
  CHECKIN:  { label: "Check-in",    color: "#E74C3C" },
};
function isVenueObject(type: string): type is VenueObjectType {
  if (type === "TEXT") return false;
  return (VENUE_OBJECT_TYPES as readonly string[]).includes(type);
}

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_ZOOM = 0.15, MAX_ZOOM = 8;

// ── Helpers ────────────────────────────────────────────────────────────────
function pointsToPath(pts: Point[]) {
  if (pts.length < 2) return "";
  return "M " + pts.map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
}
function pathToPoints(path: string): Point[] {
  const nums = path.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}
function centroid(pts: Point[]): Point {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}
function polyBBox(pts: Point[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
// Bounding box that accounts for bezier curve bulge on each edge
function curvedBBox(pts: Point[], curve: number) {
  const base = polyBBox(pts);
  if (Math.abs(curve) < 0.5) return base;
  const n = pts.length;
  let { minX, maxX, minY, maxY } = base;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    // bezier control point bulge: perpendicular direction scaled by curve
    const bx = mx + 0.5 * curve * (-dy / len);
    const by = my + 0.5 * curve * (dx / len);
    minX = Math.min(minX, bx); maxX = Math.max(maxX, bx);
    minY = Math.min(minY, by); maxY = Math.max(maxY, by);
  }
  return { minX, maxX, minY, maxY };
}
// Shoelace formula — area is rotation-invariant, unlike bbox dimensions
function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
// Compute a font size that makes text fit inside a bounding box with padding
function labelFontSize(text: string, bbox: { minX: number; maxX: number; minY: number; maxY: number }, max = 14, min = 7): number {
  const availW = (bbox.maxX - bbox.minX) * 0.78;
  const availH = (bbox.maxY - bbox.minY) * 0.52;
  const byWidth = availW / Math.max(1, text.length * 0.58);
  return Math.max(min, Math.min(max, byWidth, availH));
}
function rectContains(r: { x1: number; y1: number; x2: number; y2: number }, pt: Point) {
  return pt.x >= Math.min(r.x1, r.x2) && pt.x <= Math.max(r.x1, r.x2)
      && pt.y >= Math.min(r.y1, r.y2) && pt.y <= Math.max(r.y1, r.y2);
}

// ── Curved polygon path (quadratic bezier edges) ──────────────────────────
function curvedPath(pts: Point[], curve: number): string {
  if (Math.abs(curve) < 0.5 || pts.length < 2) return pointsToPath(pts);
  const n = pts.length;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    // perpendicular unit vector (left-hand side)
    const cpX = mx + curve * (-dy / len);
    const cpY = my + curve * (dx / len);
    d += ` Q ${cpX} ${cpY} ${p2.x} ${p2.y}`;
  }
  return d;
}

// ── Row transform: apply curve + skew offsets to seat display positions ────
function getDisplaySeats(seats: SeatDot[], rows: RowInfo[]): SeatDot[] {
  const rowMap = new Map(rows.map(r => [r.id, r]));
  // Build sorted-by-x lists per row once
  const rowSorted = new Map<string, SeatDot[]>();
  for (const seat of seats) {
    if (!rowSorted.has(seat.rowId)) rowSorted.set(seat.rowId, []);
    rowSorted.get(seat.rowId)!.push(seat);
  }
  for (const list of rowSorted.values()) list.sort((a, b) => a.x - b.x);

  return seats.map(seat => {
    const row = rowMap.get(seat.rowId);
    if (!row || (row.curve === 0 && row.skew === 0)) return seat;
    const list = rowSorted.get(seat.rowId)!;
    const n = list.length;
    const idx = list.findIndex(s => s.id === seat.id);
    const t = n > 1 ? idx / (n - 1) : 0.5;
    const dy = row.curve * (1 - (2 * t - 1) ** 2) + row.skew * (t - 0.5);
    return { ...seat, y: seat.y + dy };
  });
}

// ── Reshape polygon to hug all seat sides (per-row boundary tracing) ──────
function reshapeToFitSeats(displaySeats: SeatDot[], PAD = 16): Point[] {
  if (displaySeats.length === 0) return [];
  const rowMap = new Map<string, SeatDot[]>();
  for (const seat of displaySeats) {
    if (!rowMap.has(seat.rowId)) rowMap.set(seat.rowId, []);
    rowMap.get(seat.rowId)!.push(seat);
  }
  const orderedRows = Array.from(rowMap.values())
    .map(r => [...r].sort((a, b) => a.x - b.x))
    .sort((a, b) => {
      const ay = a.reduce((s, s2) => s + s2.y, 0) / a.length;
      const by = b.reduce((s, s2) => s + s2.y, 0) / b.length;
      return ay - by;
    });
  if (orderedRows.length === 1) {
    const row = orderedRows[0], ys = row.map(s => s.y);
    return [
      { x: row[0].x - PAD,            y: Math.min(...ys) - PAD },
      { x: row[row.length-1].x + PAD, y: Math.min(...ys) - PAD },
      { x: row[row.length-1].x + PAD, y: Math.max(...ys) + PAD },
      { x: row[0].x - PAD,            y: Math.max(...ys) + PAD },
    ];
  }
  const first = orderedRows[0], last = orderedRows[orderedRows.length - 1];
  const mid   = orderedRows.slice(1, -1);
  return [
    { x: first[0].x - PAD,              y: first[0].y - PAD },
    ...first.map(s => ({ x: s.x, y: s.y - PAD })),
    { x: first[first.length-1].x + PAD, y: first[first.length-1].y - PAD },
    ...mid.map(row => ({ x: row[row.length-1].x + PAD, y: row[row.length-1].y })),
    { x: last[last.length-1].x + PAD,   y: last[last.length-1].y + PAD },
    ...[...last].reverse().map(s => ({ x: s.x, y: s.y + PAD })),
    { x: last[0].x - PAD,               y: last[0].y + PAD },
    ...[...mid].reverse().map(row => ({ x: row[0].x - PAD, y: row[0].y })),
  ];
}

// ── Seat shape renderer ───────────────────────────────────────────────────
function renderSeat(
  x: number, y: number,
  shape: SeatShapeType, r: number,
  fill: string, stroke: string, sw: number
): React.ReactNode {
  switch (shape) {
    case "circle":
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "triangle":
      return <polygon
        points={`${x},${y - r} ${x - r * 0.87},${y + r * 0.5} ${x + r * 0.87},${y + r * 0.5}`}
        fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "chair":
      return <g style={{ pointerEvents: "none" }}>
        <rect x={x - r * 0.75} y={y - r * 1.1} width={r * 1.5} height={r * 0.65} rx={1.5} fill={fill} stroke={stroke} strokeWidth={sw} />
        <rect x={x - r * 0.75} y={y - r * 0.35} width={r * 1.5} height={r * 1.1} rx={1.5} fill={fill} stroke={stroke} strokeWidth={sw} />
      </g>;
    case "wheelchair": {
      const s = (r * 2) / 551.43;
      const tx = x - (483.22 * s) / 2;
      const ty = y - (551.43 * s) / 2;
      return <g style={{ pointerEvents: "none" }} transform={`translate(${tx},${ty}) scale(${s})`}>
        <path fillRule="evenodd" clipRule="evenodd" fill={fill} stroke={stroke} strokeWidth={sw / s}
          d="M161.9882813,98.1240234c24.9628906-2.3046875,44.3574219-23.8110352,44.3574219-48.9658203C206.3457031,22.0830078,184.2626953,0,157.1875,0s-49.1572266,22.0830078-49.1572266,49.1582031c0,8.2568359,2.3037109,16.7055664,6.1445313,23.8105469l17.515625,246.4667969l180.3964844,0.0488281l73.9912109,173.3652344l97.1445313-38.0976563l-15.0429688-35.8203125l-54.3662109,19.625l-71.5908203-165.2802734l-167.7294922,1.1269531l-2.3027344-31.2128906l121.4228516,0.0483398v-46.1831055l-126.0546875-0.0493164L161.9882813,98.1240234z"/>
        <path fillRule="evenodd" clipRule="evenodd" fill={fill} stroke={stroke} strokeWidth={sw / s}
          d="M343.4199219,451.5908203c-30.4472656,60.1875-94.1748047,99.8398438-162.1503906,99.8398438C81.4296875,551.4306641,0,470.0009766,0,370.1611328c0-70.1005859,42.4853516-135.2436523,105.8818359-164.1210938l4.1025391,53.5375977c-37.4970703,23.628418-60.6123047,66.262207-60.6123047,110.9506836c0,72.4267578,59.0712891,131.4970703,131.4970703,131.4970703c66.2617188,0,122.7646484-50.8515625,130.4697266-116.0869141L343.4199219,451.5908203z"/>
      </g>;
    }
  }
}

// ── Table geometry helpers ────────────────────────────────────────────────

function rotateAround(pts: Point[], cx: number, cy: number, angleDeg: number): Point[] {
  if (angleDeg === 0) return pts;
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return pts.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

function computeChairPositions(meta: TableMeta, cx: number, cy: number): Point[] {
  const { shape, w, h, cpl, cps } = meta;
  const hw = w / 2, hh = h / 2;
  const GAP = 14;
  const pts: Point[] = [];
  if (shape === "round" || shape === "oval") {
    const count = Math.max(1, cpl);
    const rx = (shape === "oval" ? hw : Math.min(hw, hh)) + GAP;
    const ry = (shape === "oval" ? hh : Math.min(hw, hh)) + GAP;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
  } else if (shape === "booth") {
    const stepL = w / (cpl + 1);
    for (let i = 1; i <= cpl; i++) pts.push({ x: cx - hw + i * stepL, y: cy - hh - GAP });
    for (let i = 1; i <= cpl; i++) pts.push({ x: cx + hw - i * stepL, y: cy + hh + GAP });
  } else {
    // rectangle / square
    const s = shape === "square" ? Math.min(hw, hh) : hw;
    const t = shape === "square" ? Math.min(hw, hh) : hh;
    const stepL = (s * 2) / (cpl + 1);
    const stepS = (t * 2) / (cps + 1);
    for (let i = 1; i <= cpl; i++) {
      pts.push({ x: cx - s + i * stepL, y: cy - t - GAP });
      pts.push({ x: cx + s - i * stepL, y: cy + t + GAP });
    }
    for (let i = 1; i <= cps; i++) {
      pts.push({ x: cx - s - GAP, y: cy - t + i * stepS });
      pts.push({ x: cx + s + GAP, y: cy + t - i * stepS });
    }
  }
  return rotateAround(pts, cx, cy, meta.angle);
}

function tableBoundingPoints(meta: TableMeta, cx: number, cy: number): Point[] {
  const PAD = 30; // chair clearance
  const hw = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.w) / 2 + PAD;
  const hh = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.h) / 2 + PAD;
  const corners = [
    { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
  ];
  return rotateAround(corners, cx, cy, meta.angle);
}

function tableBodyPath(meta: TableMeta, cx: number, cy: number): string {
  const { shape, w, h } = meta;
  const hw = (shape === "square" ? Math.min(w, h) : w) / 2;
  const hh = (shape === "square" ? Math.min(w, h) : h) / 2;
  if (shape === "round") {
    const r = Math.min(hw, hh);
    // Two-arc approach: guaranteed to center at (cx, cy)
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} Z`;
  }
  if (shape === "oval") {
    // Two-arc approach: guaranteed to center at (cx, cy) with correct rx/ry
    return `M ${cx + hw} ${cy} A ${hw} ${hh} 0 1 0 ${cx - hw} ${cy} A ${hw} ${hh} 0 1 0 ${cx + hw} ${cy} Z`;
  }
  const rx = Math.min(10, hw * 0.2, hh * 0.2);
  return (
    `M ${cx - hw + rx} ${cy - hh}` +
    ` H ${cx + hw - rx} Q ${cx + hw} ${cy - hh} ${cx + hw} ${cy - hh + rx}` +
    ` V ${cy + hh - rx} Q ${cx + hw} ${cy + hh} ${cx + hw - rx} ${cy + hh}` +
    ` H ${cx - hw + rx} Q ${cx - hw} ${cy + hh} ${cx - hw} ${cy + hh - rx}` +
    ` V ${cy - hh + rx} Q ${cx - hw} ${cy - hh} ${cx - hw + rx} ${cy - hh} Z`
  );
}

// Door rectangle helpers
function doorRectPoints(cx: number, cy: number, w: number, h: number, angle: number): Point[] {
  const hw = w / 2, hh = h / 2;
  const corners: Point[] = [
    { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
  ];
  return rotateAround(corners, cx, cy, angle);
}

function doorMetaFromPoints(points: Point[], prevAngle: number): DoorMeta {
  const c = centroid(points);
  const rad = (prevAngle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  let maxLX = 0, maxLY = 0;
  for (const p of points) {
    const dx = p.x - c.x, dy = p.y - c.y;
    maxLX = Math.max(maxLX, Math.abs(dx * cosA + dy * sinA));
    maxLY = Math.max(maxLY, Math.abs(-dx * sinA + dy * cosA));
  }
  return { w: Math.max(10, maxLX * 2), h: Math.max(10, maxLY * 2), angle: prevAngle };
}

// Renders table surface + chairs as SVG elements
function renderTableGraphic(
  s: DraftSection, color: string, isSel: boolean, scale: number
): React.ReactNode {
  const meta = s.tableMeta!;
  const bbox = polyBBox(s.points);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const hw = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.w) / 2;
  const hh = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.h) / 2;

  return (
    <g>
      {/* Table surface */}
      <path
        d={tableBodyPath(meta, cx, cy)}
        transform={`rotate(${meta.angle}, ${cx}, ${cy})`}
        fill={color + "35"} stroke={color}
        strokeWidth={isSel ? 2.5 : 1.5}
        strokeDasharray={s.saved ? "none" : "6 3"}
        style={{ cursor: "pointer" }} />
      {/* Wood grain lines */}
      {(meta.shape !== "round" && meta.shape !== "oval") && (
        <g transform={`rotate(${meta.angle}, ${cx}, ${cy})`} style={{ pointerEvents: "none" }}>
          {[-0.3, 0, 0.3].map(f => (
            <line key={f}
              x1={cx - hw * 0.85} y1={cy + f * hh * 0.6}
              x2={cx + hw * 0.85} y2={cy + f * hh * 0.6}
              stroke={color + "22"} strokeWidth={0.8} />
          ))}
        </g>
      )}
      {/* Table label */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        transform={`rotate(${meta.angle}, ${cx}, ${cy})`}
        fontSize={Math.max(10, Math.min(14, meta.w / 8))} fontWeight={600}
        fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>
        {s.label}
      </text>
      {/* Chair count sub-label */}
      <text x={cx} y={cy + Math.max(10, Math.min(14, meta.w / 8)) * 0.9}
        textAnchor="middle" dominantBaseline="hanging"
        transform={`rotate(${meta.angle}, ${cx}, ${cy})`}
        fontSize={8} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>
        {(s.seats && s.seats.length > 0 ? s.seats.length : computeChairPositions(meta, cx, cy).length)} chairs
      </text>
      {/* Selection ring */}
      {isSel && (
        <path d={pointsToPath(s.points)} fill="none"
          stroke={color} strokeWidth={1 / scale} strokeDasharray={`${5 / scale} ${3 / scale}`}
          style={{ pointerEvents: "none" }} />
      )}
    </g>
  );
}

// ── Venue object SVG icons (normalized, centered at origin) ───────────────
function renderVenueIcon(type: VenueObjectType, color: string, size: number): React.ReactNode {
  const s = size;
  const sw = Math.max(0.8, s * 0.06);
  const base = { stroke: color, strokeWidth: sw, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "STAGE": {
      // Theater stage SVG — viewBox 0 0 243.1 168.7, content center (121.55, 65)
      const f = s / 121.55 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-121.55, -65)`} fill={color} fillOpacity={0.85} stroke="none">
          <path d="M236.8,4.7H6c-1.1,0-2,0.9-2,2v38.5v80.9v38.5v0h4v0h230.9v0v-38.5V45.2V6.7C238.8,5.6,237.9,4.7,236.8,4.7z M231.9,8.7l-31.6,31.6v-8.8l0.8-0.8c4.4-4.4,4.4-11.4,0-15.8c-0.3-0.3-0.5-0.5-0.8-0.7V8.7H231.9z M234.8,11.6v31.6h-31.6L234.8,11.6z M193.5,43.1h-4.8l2.4-2.4L193.5,43.1z M196.3,8.7V12c-3.8-1.1-8-0.1-11,2.8l-7.2,7.2L164.8,8.7H196.3z M196.3,35.5v4.8l-2.4-2.4L196.3,35.5z M161.9,11.6l13.4,13.4l-12,12l6.3,6.3h-7.7V11.6z M132.6,36.8l25.3-25.3v31.6h-25.3V36.8z M155,8.7l-22.4,22.4v-9c0-5.5-3.9-10-9.2-11V8.7H155z M119.4,8.7v2.4c-5.2,1-9.2,5.5-9.2,11v9L87.8,8.7H119.4z M84.9,11.6l25.3,25.3v6.3H84.9V11.6z M46.5,35.5l2.4,2.4l-2.4,2.4V35.5z M51.7,40.7l2.4,2.4h-4.8L51.7,40.7z M67.5,24.9l13.4-13.4v31.6h-7.7l6.3-6.3L67.5,24.9z M78,8.7L64.7,22.1l-7.2-7.2c-3-3-7.2-3.9-11-2.8V8.7H78z M42.4,8.7v5.4c-0.3,0.2-0.5,0.5-0.8,0.7c-4.4,4.4-4.4,11.4,0,15.8l0.8,0.8v8.8L10.9,8.7H42.4z M8,11.6l31.6,31.6H8V11.6z M226.6,126.1V54.4h-38.5v71.7H54.6V54.4H16.2v71.7H8V47.2h50.2l5.5,5.5l5.5-5.5h41v6.1h22.4v-6.1h41l5.5,5.5l5.5-5.5h50.2v78.9H226.6z M207.4,94c6.6,0,12,5.4,12,12c0,6.6-5.4,12-12,12c-6.6,0-12-5.4-12-12C195.4,99.3,200.8,94,207.4,94z M195.4,74.5c0-6.6,5.4-12,12-12c6.6,0,12,5.4,12,12c0,6.6-5.4,12-12,12C200.8,86.5,195.4,81.1,195.4,74.5z M35.4,94c6.6,0,12,5.4,12,12c0,6.6-5.4,12-12,12c-6.6,0-12-5.4-12-12C23.4,99.3,28.8,94,35.4,94z M23.4,74.5c0-6.6,5.4-12,12-12c6.6,0,12,5.4,12,12c0,6.6-5.4,12-12,12C28.8,86.5,23.4,81.1,23.4,74.5z"/>
          <ellipse transform="matrix(0.9871 -0.1602 0.1602 0.9871 -11.4779 6.6309)" cx="35.4" cy="74.5" rx="8.5" ry="8.5"/>
          <ellipse transform="matrix(0.9871 -0.1602 0.1602 0.9871 -16.5149 7.0369)" cx="35.4" cy="106" rx="8.5" ry="8.5"/>
          <ellipse transform="matrix(0.9871 -0.1602 0.1602 0.9871 -9.2567 34.185)" cx="207.4" cy="74.5" rx="8.5" ry="8.5"/>
          <ellipse transform="matrix(0.9871 -0.1602 0.1602 0.9871 -14.2938 34.591)" cx="207.4" cy="106" rx="8.5" ry="8.5"/>
        </g>
      );
    }
    case "BAR": {
      // Wine-glass path from SVG viewBox "131 -131 512 512", center (387,125)
      // normalized: newCoord = (origCoord - center) * s/256
      const f = s / 256 * 0.25;
      return <g {...base} strokeWidth={sw * 0.4}>
        <path
          d={`M ${155.9*f} ${193*f} H ${34.1*f} V ${17.5*f} L ${255.6*f} ${-256*f} H ${-255.6*f} l ${225.8*f} ${272.6*f} v ${177.2*f} h ${-121*f} c ${-40.9*f} 0 ${-40.9*f} ${62.2*f} 0 ${62.2*f} h ${306.7*f} C ${197.6*f} ${255.1*f} ${197.6*f} ${193*f} ${155.9*f} ${193*f} Z`}
          fill={color+"25"}
        />
        <circle cx={40.1*f} cy={-102.7*f} r={39.2*f} fill={color+"55"} stroke="none" />
      </g>;
    }
    case "BATHROOM": {
      // Male+female restroom SVG — viewBox 0 0 512 512, center (256, 256)
      const f = s / 256 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-256, -256)`} fill={color} fillOpacity={0.85} stroke="none">
          <path d="M55.4,490.9c0,13,8.1,21.1,21.1,21.1c13,0,21.1-8.1,21.1-21.1V295.6h21.1v195.3c0,13,8.1,21.1,21.1,21.1c13,0,21.1-8.1,21.1-21.1V158.3h10.6v119.4c0,25.3,31.7,25.3,31.7,0V149.5c0-27.9-20.1-43.9-52.8-43.9H66c-29.8,0-52.8,12.9-52.8,43.1V285c0,21.1,31.7,21.1,31.7,0V158.3h10.6V490.9z"/>
          <circle cx="106.9" cy="43.5" r="43.5"/>
          <circle cx="370.8" cy="43.5" r="43.5"/>
          <path d="M476.8,332.5l-62.4-171.4l-0.4-1.8c0-2.5,2.1-4.5,4.7-4.5c2.2,0,4.1,1.5,4.6,3.5l42.4,110.9c2.8,6.3,14.4,10.6,22,10.6c10.2,0,11.2-20,11-21.1l-42.4-106.7c-3.7-24.5-28.4-46.4-56.7-46.4h-55.3c-28.2,0-54.8,21.9-58.5,46.4l-40.5,108c-0.9,2.1,0,20.5,11,20.5c8.6,0,19.9-3.3,22-10.9L319.4,158c0.7-1.8,2.4-3.1,4.5-3.1c2.6,0,4.7,2,4.7,4.5l-0.3,1.6l-60.8,171.6v13.2c0,3.7,8.8,13.2,12.6,13.2h39.2v133c0,11,9.7,20.1,21.1,20.1c11.4,0,21.1-9.1,21.1-20.1V353.5c0-3,21.1-2.9,21.1,0.1v137.2c0,11,9.7,21.1,21.1,21.1c11.5,0,21.1-10.1,21.1-21.1v-132h40.8c3.8,0,11-9.5,11-13.2V332.5z"/>
        </g>
      );
    }
    case "DANCING": {
      // Globe+sparkle dancing SVG — viewBox 0 0 512 512, center (256, 256)
      const f = s / 256 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-256, -256)`} fill={color} fillOpacity={0.85} stroke="none">
          <path d="M305.169,89.716V50.772c0-4.428-3.589-8.017-8.017-8.017h-26.188V8.017c0-4.428-3.589-8.017-8.017-8.017s-8.017,3.588-8.017,8.017v34.739h-26.188c-4.427,0-8.017,3.588-8.017,8.017v38.944C123.298,109.364,49.704,195.624,49.704,298.756C49.704,416.339,145.364,512,262.948,512c30.267,0,59.951-6.441,87.156-18.619l0.509,2.035c0.891,3.569,4.098,6.072,7.777,6.072c3.679,0,6.885-2.503,7.777-6.072l2.93-11.718c11.606-6.659,22.63-14.425,32.889-23.255c3.356-2.888,3.735-7.95,0.847-11.306c-2.888-3.355-7.95-3.736-11.306-0.847c-5.387,4.637-11.004,8.954-16.816,12.952l3.51-14.041l42.618-14.552c3.245-1.108,5.426-4.158,5.426-7.587c0-3.429-2.182-6.479-5.426-7.587l-42.618-14.552l-12.054-48.215c-0.891-3.569-4.098-6.072-7.777-6.072c-3.679,0-6.885,2.503-7.777,6.072l-12.054,48.215l-42.618,14.552c-3.245,1.108-5.426,4.158-5.426,7.587c0,3.429,2.182,6.479,5.426,7.587l42.618,14.552l7.588,30.351c-19.241,8.95-39.873,14.777-61.103,17.171c5.623-10.129,10.552-24.753,14.858-43.997c0.966-4.322-1.752-8.608-6.073-9.574c-4.319-0.96-8.607,1.754-9.573,6.073c-8.901,39.786-18.608,48.741-21.307,48.741c-2.903,0-13.248-9.87-22.385-53.728c-0.546-2.623-1.074-5.31-1.586-8.05c7.906,0.559,15.903,0.851,23.971,0.851c4.427,0,8.017-3.588,8.017-8.017c0-4.428-3.589-8.017-8.017-8.017c-9.016,0-17.934-0.378-26.716-1.104c-3.151-20.793-5.426-44.123-6.731-68.935c10.96,0.37,22.135,0.561,33.447,0.561c11.306,0,22.473-0.191,33.427-0.56c-0.93,17.595-2.344,34.561-4.221,50.359c-0.523,4.396,2.619,8.384,7.015,8.906c4.389,0.528,8.383-2.619,8.907-7.015c1.972-16.595,3.442-34.437,4.389-52.929c27.632-1.408,53.55-3.996,76.364-7.642c-2.282,16.076-5.891,31.656-10.828,46.598c-1.389,4.204,0.894,8.738,5.098,10.127c4.2,1.391,8.737-0.893,10.127-5.098c5.767-17.456,9.823-35.711,12.166-54.568c1.452-0.286,2.89-0.575,4.309-0.87c20.226-4.214,35.736-9.071,46.68-14.631c-7.522,23.029-26.099,44.285-54.132,61.42c-3.779,2.309-4.968,7.243-2.659,11.021c2.309,3.779,7.243,4.968,11.021,2.659c14.915-9.117,27.455-19.375,37.455-30.485c-4.532,12.338-10.291,24.24-17.26,35.51c-2.329,3.765-1.164,8.706,2.602,11.034c3.765,2.327,8.706,1.163,11.035-2.603c20.771-33.588,31.75-72.319,31.75-112.006C476.192,195.624,402.598,109.364,305.169,89.716z M323.34,425.063l24.529-8.376c2.574-0.879,4.527-3.004,5.186-5.642l5.335-21.338l5.335,21.338c0.659,2.639,2.612,4.763,5.186,5.642l24.529,8.376l-24.529,8.376c-2.574,0.879-4.527,3.004-5.186,5.642l-5.335,21.338l-5.335-21.338c-0.66-2.639-2.612-4.763-5.186-5.642L323.34,425.063z M236.76,58.789h52.376v28.332c-8.584-1.056-17.322-1.61-26.188-1.61c-8.865,0-17.604,0.554-26.188,1.61V58.789z M262.948,162.472c-8.068,0-16.066,0.292-23.971,0.851c0.512-2.74,1.04-5.428,1.586-8.05c9.137-43.858,19.482-53.728,22.385-53.728s13.248,9.87,22.385,53.728c0.546,2.623,1.074,5.311,1.586,8.05C279.013,162.764,271.016,162.472,262.948,162.472z M289.664,179.609c3.151,20.793,5.426,44.123,6.731,68.935c-10.96-0.37-22.135-0.561-33.447-0.561c-11.312,0-22.486,0.191-33.447,0.561c1.305-24.812,3.58-48.142,6.731-68.935c8.782-0.726,17.7-1.104,26.716-1.104C271.964,178.505,280.882,178.884,289.664,179.609z M239.793,104.744c-5.684,10.972-10.639,26.676-14.926,47.259c-0.867,4.159-1.689,8.47-2.472,12.906c-21.685,2.637-42.459,7.387-61.703,14.084C179.779,140.876,207.732,113.692,239.793,104.744z M212.736,332.203c-28.29-1.488-54.659-4.235-77.53-8.105c-0.698-8.299-1.06-16.757-1.06-25.341s0.362-17.042,1.06-25.34c22.871-3.87,49.239-6.619,77.53-8.106c-0.37,10.96-0.561,22.135-0.561,33.447C212.175,310.068,212.367,321.242,212.736,332.203z M213.415,348.288c1.236,24.237,3.379,47.155,6.347,67.816c-24.395-3.333-47.441-9.49-68.12-18.209c-6.692-17.548-11.664-36.811-14.562-57.246C159.886,344.294,185.795,346.881,213.415,348.288z M213.415,249.223c-27.621,1.408-53.529,3.994-76.334,7.638c2.899-20.435,7.869-39.698,14.563-57.246c20.679-8.719,43.724-14.876,68.12-18.209C216.795,202.069,214.651,224.986,213.415,249.223z M187.263,116.656c-9.996,9.02-19.307,19.901-27.73,32.535c-7.835,11.751-14.628,24.634-20.329,38.384c-9.011,4.097-17.583,8.659-25.622,13.684c-14.149,8.843-26.114,18.734-35.727,29.415C96.859,179.17,136.782,137.715,187.263,116.656z M122.079,214.855c2.988-1.867,6.063-3.66,9.204-5.392c-4.987,15.989-8.607,32.877-10.774,50.34c-1.453,0.286-2.895,0.576-4.314,0.871c-20.215,4.211-35.719,9.065-46.661,14.622C76.926,252.721,94.949,231.811,122.079,214.855z M65.737,298.756c0-2.89,9.795-13.156,53.155-22.263c-0.512,7.349-0.779,14.775-0.779,22.263s0.267,14.914,0.779,22.263C75.532,311.912,65.737,301.646,65.737,298.756z M116.195,336.837c1.419,0.296,2.861,0.586,4.314,0.871c2.168,17.463,5.787,34.351,10.774,50.34c-3.141-1.733-6.217-3.525-9.204-5.392c-27.13-16.956-45.153-37.866-52.546-60.442C80.476,327.772,95.981,332.626,116.195,336.837z M77.854,366.838c9.613,10.68,21.578,20.572,35.727,29.415c8.039,5.025,16.611,9.587,25.622,13.684c5.701,13.75,12.494,26.633,20.329,38.384c8.423,12.634,17.734,23.515,27.73,32.535C136.782,459.796,96.859,418.341,77.854,366.838z M239.793,492.767c-32.061-8.948-60.014-36.133-79.101-74.249c19.244,6.697,40.018,11.447,61.703,14.084c0.782,4.436,1.606,8.747,2.472,12.906C229.156,466.092,234.109,481.796,239.793,492.767z M297.084,332.904c-11.168,0.39-22.575,0.591-34.136,0.591c-11.564,0-22.976-0.201-34.148-0.591c-0.39-11.172-0.591-22.583-0.591-34.148c0-11.565,0.201-22.976,0.591-34.148c11.172-0.39,22.584-0.591,34.148-0.591c11.564,0,22.976,0.201,34.148,0.591c0.39,11.172,0.591,22.583,0.591,34.148C297.687,310.241,297.482,321.664,297.084,332.904z M303.501,164.909c-0.784-4.436-1.605-8.747-2.472-12.906c-4.288-20.584-9.242-36.287-14.926-47.259c32.061,8.948,60.014,36.132,79.101,74.249C345.959,172.296,325.185,167.546,303.501,164.909z M306.132,181.407c24.395,3.333,47.441,9.49,68.12,18.209c6.693,17.548,11.664,36.811,14.563,57.246c-22.805-3.643-48.714-6.231-76.334-7.638C311.245,224.986,309.102,202.069,306.132,181.407z M390.689,324.097c-22.872,3.87-49.242,6.617-77.534,8.105c0.375-11.02,0.565-22.207,0.565-33.447c0-11.312-0.191-22.486-0.561-33.447c28.29,1.488,54.659,4.235,77.53,8.106c0.698,8.298,1.06,16.756,1.06,25.34C391.75,307.31,391.387,315.761,390.689,324.097z M386.691,187.575c-5.701-13.75-12.494-26.633-20.329-38.384c-8.423-12.634-17.734-23.515-27.73-32.535c50.481,21.059,90.404,62.513,109.408,114.018c-9.61-10.68-21.576-20.571-35.726-29.415C404.275,196.235,395.703,191.672,386.691,187.575z M405.386,259.802c-2.168-17.463-5.787-34.351-10.774-50.34c3.141,1.733,6.217,3.525,9.204,5.391c27.13,16.956,45.153,37.866,52.546,60.442c-10.942-5.557-26.448-10.411-46.661-14.622C408.281,260.377,406.839,260.087,405.386,259.802z M407.005,321.018c0.51-7.344,0.778-14.766,0.778-22.262c0-7.487-0.267-14.913-0.779-22.263c43.361,9.107,53.155,19.373,53.155,22.263C460.159,301.646,450.364,311.912,407.005,321.018z"/>
          <path d="M504.971,68.839l-42.618-14.552L450.299,6.072C449.407,2.503,446.2,0,442.522,0c-3.678,0-6.885,2.503-7.777,6.072l-12.054,48.215l-42.618,14.552c-3.245,1.108-5.426,4.158-5.426,7.587s2.182,6.479,5.426,7.587l42.618,14.552l12.054,48.215c0.891,3.569,4.098,6.072,7.777,6.072c3.679,0,6.885-2.503,7.777-6.072l12.054-48.215l42.618-14.552c3.245-1.108,5.426-4.158,5.426-7.587S508.215,69.947,504.971,68.839z M453.043,84.802c-2.574,0.879-4.527,3.004-5.186,5.642l-5.335,21.338l-5.335-21.338c-0.659-2.639-2.612-4.763-5.186-5.642l-24.529-8.376l24.529-8.376c2.574-0.879,4.527-3.004,5.186-5.642l5.335-21.338l5.335,21.338c0.66,2.639,2.612,4.763,5.186,5.642l24.529,8.376L453.043,84.802z"/>
          <path d="M131.927,103.043L89.309,88.492L77.255,40.277c-0.893-3.569-4.099-6.072-7.777-6.072c-3.678,0-6.885,2.503-7.777,6.072L49.647,88.492L7.029,103.043c-3.208,1.097-5.426,4.196-5.426,7.587c0,3.391,2.218,6.49,5.426,7.587l42.618,14.552l12.054,48.215c0.893,3.569,4.099,6.072,7.777,6.072c3.678,0,6.885-2.503,7.777-6.072l12.054-48.215l42.618-14.552c3.245-1.108,5.426-4.158,5.426-7.587S135.171,104.152,131.927,103.043z M79.999,119.006c-2.574,0.879-4.527,3.004-5.186,5.642l-5.335,21.338l-5.335-21.338c-0.66-2.639-2.612-4.763-5.186-5.642l-24.529-8.376l24.529-8.376c2.574-0.879,4.527-3.004,5.186-5.642l5.335-21.338l5.335,21.338c0.659,2.639,2.612,4.763,5.186,5.642l24.529,8.376L79.999,119.006z"/>
        </g>
      );
    }
    case "PARKING": {
      // Boxed P SVG — viewBox 0 0 24 24, center (12, 12)
      const f = s / 12 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-12, -12)`} fill={color} fillOpacity={0.85} stroke="none">
          <path fillRule="evenodd" clipRule="evenodd" d="M11 6C9.34315 6 8 7.34315 8 9V17C8 17.5523 8.44772 18 9 18C9.55229 18 10 17.5523 10 17V14L12.0045 14C12.2149 13.9987 12.426 13.974 12.6332 13.9395C12.9799 13.8817 13.4575 13.7642 13.9472 13.5194C14.4409 13.2725 14.9649 12.8866 15.3633 12.289C15.7659 11.6851 16 10.9249 16 9.99996C16 9.07499 15.7659 8.31478 15.3633 7.71092C14.9649 7.11332 14.4408 6.7274 13.9472 6.48058C13.4575 6.23573 12.9799 6.11828 12.6332 6.06049C12.4248 6.02575 12.2117 6.0001 12 6H11ZM10 12V9C10 8.44772 10.4477 8 11 8L12.0004 8.00018C12.3603 8.01218 12.7318 8.10893 13.0528 8.26944C13.3092 8.39762 13.5351 8.5742 13.6992 8.82033C13.8591 9.06021 14 9.42497 14 9.99996C14 10.575 13.8591 10.9397 13.6992 11.1796C13.5351 11.4258 13.3091 11.6023 13.0528 11.7305C12.7318 11.891 12.3603 11.9878 12.0003 11.9998L10 12Z"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M20 1C21.6569 1 23 2.34315 23 4V20C23 21.6569 21.6569 23 20 23H4C2.34315 23 1 21.6569 1 20V4C1 2.34315 2.34315 1 4 1H20ZM20 3C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3H20Z"/>
        </g>
      );
    }
    case "STAIRS":
      return <g {...base}>
        <path d={`M ${s*.4} ${s*.4} L ${s*.4} ${s*.13} L ${s*.13} ${s*.13} L ${s*.13} ${-s*.13} L ${-s*.13} ${-s*.13} L ${-s*.13} ${-s*.4} L ${-s*.4} ${-s*.4} L ${-s*.4} ${s*.4} Z`} fill={color+"25"} />
        <path d={`M ${-s*.05} ${s*.2} L ${-s*.05} ${-s*.3} M ${-s*.15} ${-s*.2} L ${-s*.05} ${-s*.3} L ${s*.05} ${-s*.2}`} stroke={color+"99"} strokeWidth={sw*.6} />
      </g>;
    case "WALL":
      return <g {...base} strokeWidth={sw*.6}>
        <rect x={-s*.42} y={-s*.42} width={s*.84} height={s*.84} fill={color+"18"} strokeWidth={sw} />
        <line x1={-s*.42} y1={-s*.14} x2={s*.42} y2={-s*.14} />
        <line x1={-s*.42} y1={s*.14}  x2={s*.42} y2={s*.14} />
        {([-s*.28,0,s*.28] as number[]).map((x,i)=><line key={i} x1={x} y1={-s*.42} x2={x} y2={-s*.14} />)}
        {([-s*.14,s*.14] as number[]).map((x,i)=><line key={i} x1={x} y1={-s*.14} x2={x} y2={s*.14} />)}
        {([-s*.28,0,s*.28] as number[]).map((x,i)=><line key={i} x1={x} y1={s*.14} x2={x} y2={s*.42} />)}
      </g>;
    case "DOOR":
      return <g {...base}>
        <path d={`M ${-s*.28} ${s*.42} L ${-s*.28} ${-s*.32} Q 0 ${-s*.45} ${s*.28} ${-s*.32} L ${s*.28} ${s*.42}`} fill={color+"20"} />
        <line x1={-s*.28} y1={s*.42} x2={s*.28} y2={s*.42} />
        <rect x={-s*.18} y={-s*.28} width={s*.36} height={s*.3} rx={s*.03} strokeWidth={sw*.5} />
        <circle cx={s*.16} cy={0} r={s*.055} fill={color+"80"} strokeWidth={sw*.6} />
      </g>;
    case "CHECKIN": {
      // Camera-frame check-in SVG — viewBox 0 0 24 24, center (12, 12)
      const f = s / 12 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-12, -12)`} fill={color} fillOpacity={0.85} stroke="none">
          <path fillRule="evenodd" clipRule="evenodd" d="M5 8a1 1 0 0 1-2 0V5.923c0-.76.082-1.185.319-1.627.223-.419.558-.754.977-.977C4.738 3.082 5.162 3 5.923 3H8a1 1 0 0 1 0 2H5.923c-.459 0-.57.022-.684.082a.364.364 0 0 0-.157.157c-.06.113-.082.225-.082.684V8zm3 11a1 1 0 1 1 0 2H5.923c-.76 0-1.185-.082-1.627-.319a2.363 2.363 0 0 1-.977-.977C3.082 19.262 3 18.838 3 18.077V16a1 1 0 1 1 2 0v2.077c0 .459.022.57.082.684.038.07.087.12.157.157.113.06.225.082.684.082H8zm7-15a1 1 0 0 0 1 1h2.077c.459 0 .57.022.684.082.07.038.12.087.157.157.06.113.082.225.082.684V8a1 1 0 1 0 2 0V5.923c0-.76-.082-1.185-.319-1.627a2.363 2.363 0 0 0-.977-.977C19.262 3.082 18.838 3 18.077 3H16a1 1 0 0 0-1 1zm4 12a1 1 0 1 1 2 0v2.077c0 .76-.082 1.185-.319 1.627a2.364 2.364 0 0 1-.977.977c-.442.237-.866.319-1.627.319H16a1 1 0 1 1 0-2h2.077c.459 0 .57-.022.684-.082a.363.363 0 0 0 .157-.157c.06-.113.082-.225.082-.684V16zM3 11a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3z"/>
        </g>
      );
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MapEditor({ mapId, svgViewBox, bgImageUrl, initialZones = [] }: MapEditorProps) {
  const [, , vw, vh] = svgViewBox.split(" ").map(Number);

  // Canvas transform
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  // Editor state
  const [tool, setTool]               = useState<Tool>("select");
  const [sections, setSections]       = useState<DraftSection[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [focusedSection, setFocused]  = useState<string | null>(null);
  const [drawing, setDrawing]         = useState<Point[]>([]);
  const [mouse, setMouse]             = useState<Point | null>(null);
  const [zones, setZones]             = useState<Zone[]>(initialZones);
  const [holds, setHolds]             = useState<MapHold[]>([]);
  const [newHold, setNewHold]         = useState({ name: "", color: "#cc4444" });
  const [activeHoldId, setActiveHoldId] = useState<string | null>(null);
  const [holdEditDraft, setHoldEditDraft] = useState<{ id: string; name: string; color: string } | null>(null);
  const [sidebarTab, setSidebarTab]   = useState<"editor" | "holds">("editor");
  const [showRows, setShowRows]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [bakingTransforms, setBaking] = useState(false);
  const [newZone, setNewZone]         = useState({ name: "", color: "#7F77DD" });
  const [seatRadius, setSeatRadius]   = useState(5);
  const [seatShape, setSeatShape]     = useState<SeatShapeType>("circle");
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [editingSeat, setEditingSeat] = useState<{ id: string; value: string; shape: SeatShapeType; sectionId: string; screenX: number; screenY: number } | null>(null);
  const [editingRow, setEditingRow]   = useState<{ id: string; value: string; screenX: number; screenY: number } | null>(null);
  // Table tool state
  const [tableCfg, setTableCfg] = useState<TableMeta>({ shape: "rectangle", w: 120, h: 60, cpl: 4, cps: 2, angle: 0 });
  const [tableDraft, setTableDraft] = useState<{ startPt: Point; endPt: Point } | null>(null);
  const [editingTable, setEditingTable] = useState<{ sectionId: string; screenX: number; screenY: number } | null>(null);
  // Object tool state
  const [objectType, setObjectType] = useState<VenueObjectType>("STAGE");
  const [objectCreateDraft, setObjectCreateDraft] = useState<{ sectionId: string; name: string; iconType: VenueObjectType } | null>(null);
  // Text edit widget
  const [textEditId, setTextEditId] = useState<string | null>(null);

  // PSD import modal
  interface ImportPreviewSection {
    name: string; label: string;
    sectionType: DraftSection["sectionType"];
    polygonPath: string;
    rows: { label: string; startX: number; startY: number; angle: number; seats: { seatNumber: string; x: number; y: number }[] }[];
    sourceLayerName: string;
    confidence: number;
    estimatedSeats: number;
    bbox?: { top: number; left: number; bottom: number; right: number };
    include: boolean;
  }
  const [importModal, setImportModal] = useState<{
    stage: "uploading" | "preview" | "saving";
    sections: ImportPreviewSection[];
    warnings: string[];
    error: string | null;
    fileLabel: string;
    previewUrl?: string;
  } | null>(null);
  const [importElapsed, setImportElapsed] = useState(0);
  const importTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seated section placement (tool === "seated")
  const [seatedPlacement, setSeatedPlacement] = useState<Point | null>(null);

  // Global curve/skew for applying to all rows at once
  const [globalCurve, setGlobalCurve] = useState(0);
  const [globalSkew, setGlobalSkew]   = useState(0);
  const [rowCfg, setRowCfg] = useState({
    count: 5, seatsPerRow: 10,
    startX: 200, startY: 200,
    spacingX: 28, spacingY: 24,
    rowLabelType: "letters" as "letters" | "numbers",
    rowStart: 0,
    seatOrder: "ltr" as "ltr" | "rtl",
    seatStart: 1,
  });

  // Seat hover
  const [hoveredSeat, setHoveredSeat] = useState<{
    seat: SeatDot; sectionName: string; zoneName: string; zoneColor: string;
    screenX: number; screenY: number;
  } | null>(null);

  // Refs
  const containerRef     = useRef<HTMLDivElement>(null);
  const transformRef     = useRef(transform);
  const sectionsRef      = useRef(sections);
  const drawingRef       = useRef(drawing);
  const toolRef          = useRef(tool);
  const focusedRef       = useRef(focusedSection);
  const selectedSeatsRef = useRef(selectedSeats);
  const seatRadiusRef    = useRef(seatRadius);
  const objectTypeRef    = useRef(objectType);
  const selectedRef      = useRef(selected);
  const multiSelectedRef = useRef(multiSelected);
  const sidebarTabRef    = useRef(sidebarTab);
  const activeHoldIdRef  = useRef(activeHoldId);

  useEffect(() => { transformRef.current     = transform;      }, [transform]);
  useEffect(() => { sectionsRef.current      = sections;       }, [sections]);
  useEffect(() => { drawingRef.current       = drawing;        }, [drawing]);
  useEffect(() => { toolRef.current          = tool;           }, [tool]);
  useEffect(() => { focusedRef.current       = focusedSection; }, [focusedSection]);
  useEffect(() => { selectedSeatsRef.current = selectedSeats;  }, [selectedSeats]);
  useEffect(() => { seatRadiusRef.current    = seatRadius;     }, [seatRadius]);
  useEffect(() => { objectTypeRef.current    = objectType;     }, [objectType]);
  useEffect(() => { selectedRef.current      = selected;       }, [selected]);
  useEffect(() => { multiSelectedRef.current = multiSelected;  }, [multiSelected]);
  useEffect(() => { sidebarTabRef.current    = sidebarTab;     }, [sidebarTab]);
  useEffect(() => { activeHoldIdRef.current  = activeHoldId;   }, [activeHoldId]);
  // Deselect section/seats when switching to Holds tab
  useEffect(() => {
    if (sidebarTab === "holds") {
      setSelected(null);
      setSelectedSeats(new Set());
    }
  }, [sidebarTab]);
  // Clear seat selection whenever the selected section changes (handles table deselect)
  useEffect(() => { setSelectedSeats(new Set()); }, [selected]);
  // Close text edit widget when the text section is deselected
  useEffect(() => { if (textEditId && selected !== textEditId) setTextEditId(null); }, [selected, textEditId]);

  // Drag state refs
  const panState = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const sectionDragState = useRef<{
    sectionId: string;
    startClientX: number; startClientY: number;
    origPoints: Point[]; origSeats: SeatDot[];
    downTarget: Element;
    extra: { id: string; origPoints: Point[]; origSeats: SeatDot[] }[];
  } | null>(null);
  const vertexDragState = useRef<{
    sectionId: string; vertexIndex: number;
    startClientX: number; startClientY: number;
    origPoints: Point[];
    origDoorMeta?: DoorMeta;
    origStairsMeta?: DoorMeta;
    origTableMeta?: TableMeta;
  } | null>(null);
  const seatDragState = useRef<{
    primarySeatId: string;
    origSeats: { id: string; x: number; y: number }[];
    startClientX: number; startClientY: number;
    sectionId: string;
  } | null>(null);
  const marqueeStateRef = useRef<{ startSvgX: number; startSvgY: number; sectionId: string | null } | null>(null);
  const rowLabelDownRef = useRef<{ rowId: string; screenX: number; screenY: number } | null>(null);
  const rotationDragState = useRef<{
    sectionId: string;
    centerX: number; centerY: number;
    startAngle: number;
    origPoints: Point[];
    origSeats: { id: string; x: number; y: number }[];
    origDisplaySeats: { id: string; x: number; y: number }[]; // display (curve-applied) positions
    sectionHasRows: boolean; // if true, rotate display seats and zero curve/skew
    origTableAngle?: number;  // for TABLE sections: original tableMeta.angle
    origDoorAngle?: number;   // for DOOR sections: original doorMeta.angle
    origStairsAngle?: number; // for STAIRS sections: original stairsMeta.angle
    origTextAngle?: number;   // for TEXT sections: original textAngle
  } | null>(null);
  const groupRotationDragState = useRef<{
    centerX: number; centerY: number; startAngle: number;
    sections: {
      id: string; origPoints: Point[]; origSeats: { id: string; x: number; y: number }[];
      origTableAngle?: number; origDoorAngle?: number; origStairsAngle?: number; origTextAngle?: number;
    }[];
  } | null>(null);
  const tableDraftRef = useRef(tableDraft);
  useEffect(() => { tableDraftRef.current = tableDraft; }, [tableDraft]);

  // Debounce ref for icon-offset PATCH
  const iconOffsetPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDragged = useRef(false);
  const clipboardRef = useRef<DraftSection[]>([]);

  const sel    = sections.find(s => s.id === selected);
  const focSec = sections.find(s => s.id === focusedSection);

  // ── Init transform ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw / vw, ch / vh) * 0.85;
    setTransform({ scale, x: (cw - vw * scale) / 2, y: (ch - vh * scale) / 2 });
  }, [vw, vh]);

  // ── Load map ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/maps/${mapId}`)
      .then(r => r.json())
      .then((map: {
        sections: {
          id: string; name: string; label: string;
          sectionType: DraftSection["sectionType"];
          polygonPath: string;
          notes?: string | null;
          zoneMappings: { zoneId: string }[];
          rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string; notes?: string | null }[] }[];
        }[];
        pricingZones: Zone[];
        mapHolds?: MapHold[];
      }) => {
        setSections(map.sections.map(s => {
          let tableMeta: TableMeta | undefined;
          let doorMeta: DoorMeta | undefined;
          let stairsMeta: DoorMeta | undefined;
          let iconOffset: { x: number; y: number } | undefined;
          let labelOffset: { x: number; y: number } | undefined;
          let iconSize: number | undefined;
          let labelSize: number | undefined;
          let showIcon: boolean | undefined;
          let showLabel: boolean | undefined;
          let textColor: string | undefined;
          let textBold: boolean | undefined;
          let textAngle: number | undefined;
          if (s.sectionType === "TABLE" && s.notes) {
            try { tableMeta = JSON.parse(s.notes) as TableMeta; } catch {}
          }
          if (s.sectionType === "DOOR" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { w?: number; h?: number; angle?: number; showLabel?: boolean; labelOffset?: { x: number; y: number }; labelSize?: number };
              if (p.w && p.h !== undefined) doorMeta = { w: p.w, h: p.h, angle: p.angle ?? 0 };
              if (p.showLabel === false) showLabel = false;
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
            } catch {}
          }
          if (s.sectionType === "STAIRS" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { w?: number; h?: number; angle?: number; showLabel?: boolean; labelOffset?: { x: number; y: number }; labelSize?: number };
              if (p.w && p.h !== undefined) stairsMeta = { w: p.w, h: p.h, angle: p.angle ?? 0 };
              if (p.showLabel === false) showLabel = false;
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
            } catch {}
          }
          if (isVenueObject(s.sectionType) && s.sectionType !== "WALL" && s.sectionType !== "DOOR" && s.notes) {
            try {
              const parsed = JSON.parse(s.notes) as {
                iconOffset?: { x: number; y: number };
                labelOffset?: { x: number; y: number };
                iconSize?: number;
                labelSize?: number;
                showIcon?: boolean;
                showLabel?: boolean;
                textColor?: string;
                textBold?: boolean;
                textAngle?: number;
              };
              if (parsed.iconOffset) iconOffset = parsed.iconOffset;
              if (parsed.labelOffset) labelOffset = parsed.labelOffset;
              if (parsed.iconSize) iconSize = parsed.iconSize;
              if (parsed.labelSize) labelSize = parsed.labelSize;
              if (parsed.showIcon === false) showIcon = false;
              if (parsed.showLabel === false) showLabel = false;
              if (parsed.textColor) textColor = parsed.textColor;
              if (parsed.textBold) textBold = parsed.textBold;
              if (parsed.textAngle !== undefined) textAngle = parsed.textAngle;
            } catch {}
          }
          // Regular sections: parse labelOffset, labelSize, edgeCurve, capacity, maxPerOrder, hideSeats from notes
          let edgeCurve = 0;
          let capacity: number | undefined;
          let maxPerOrder: number | undefined;
          let hideSeats: boolean | undefined;
          if (!isVenueObject(s.sectionType) && s.sectionType !== "TABLE" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { labelOffset?: { x: number; y: number }; labelSize?: number; edgeCurve?: number; capacity?: number; maxPerOrder?: number; hideSeats?: boolean };
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
              if (p.edgeCurve) edgeCurve = p.edgeCurve;
              if (p.capacity !== undefined) capacity = p.capacity;
              if (p.maxPerOrder !== undefined) maxPerOrder = p.maxPerOrder;
              if (p.hideSeats !== undefined) hideSeats = p.hideSeats;
            } catch {}
          }
          return {
          id: s.id, name: s.name, label: s.label,
          sectionType: s.sectionType,
          zoneId: s.zoneMappings[0]?.zoneId,
          saved: true,
          edgeCurve,
          capacity,
          maxPerOrder,
          hideSeats,
          tableMeta,
          doorMeta,
          stairsMeta,
          iconOffset,
          labelOffset,
          iconSize,
          labelSize,
          showIcon,
          showLabel,
          textColor,
          textBold,
          textAngle,
          rows: s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 })),
          seats: s.rows.flatMap(row =>
            row.seats.map(seat => {
              const SHAPES = ["circle","square","triangle","chair","wheelchair"];
              let shape: SeatShapeType | undefined;
              let seatZoneId: string | undefined;
              if (seat.notes) {
                if (SHAPES.includes(seat.notes)) { shape = seat.notes as SeatShapeType; }
                else { try { const p = JSON.parse(seat.notes); if (SHAPES.includes(p.s ?? "")) shape = p.s; if (p.z) seatZoneId = p.z; } catch {} }
              }
              return { id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id, shape, zoneId: seatZoneId };
            })
          ),
          // For sections with seats, recompute the boundary from actual seat positions.
          // This heals any stored polygon corruption (e.g. from edgeCurve being applied
          // to a reshaped boundary) without requiring a manual row regeneration.
          // TABLE sections must skip reshapeToFitSeats — their polygon is derived from
          // tableMeta dimensions, not chair positions. Fitting to chairs shifts the
          // computed center for asymmetric chair counts, causing the table surface to
          // render offset and cover chairs that should be outside it.
          points: (() => {
            if (s.sectionType === "TABLE") return pathToPoints(s.polygonPath);
            const rawSeats = s.rows.flatMap(row =>
              row.seats.map(seat => ({
                id: seat.id, x: seat.x, y: seat.y,
                seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id,
              }))
            );
            if (rawSeats.length > 0) {
              const fitted = reshapeToFitSeats(rawSeats);
              if (fitted.length > 0) return fitted;
            }
            return pathToPoints(s.polygonPath);
          })(),
          };
        }));
        if (map.pricingZones.length > 0) setZones(map.pricingZones);
        if (map.mapHolds) setHolds(map.mapHolds);
      });
  }, [mapId]);

  const upd = (id: string, u: Partial<DraftSection>) =>
    setSections(p => p.map(s => s.id === id ? { ...s, ...u } : s));

  // ── Focus section ─────────────────────────────────────────────────────
  const focusSection = (sectionId: string) => {
    const s = sectionsRef.current.find(sec => sec.id === sectionId);
    if (!s || !containerRef.current) return;
    const bbox = polyBBox(s.points);
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const PAD = 120;
    const scale = Math.min(
      (cw - PAD * 2) / Math.max(bbox.maxX - bbox.minX, 1),
      (ch - PAD * 2) / Math.max(bbox.maxY - bbox.minY, 1),
      MAX_ZOOM
    );
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    setTransform({ scale, x: cw / 2 - cx * scale, y: ch / 2 - cy * scale });
    setFocused(sectionId);
    setSelected(sectionId);
    setSelectedSeats(new Set());
    // Init global sliders from the section's current row values.
    // If all rows share the same value use it; if mixed use 0.
    const rowCurves = s.rows?.map(r => r.curve ?? 0) ?? [];
    const rowSkews  = s.rows?.map(r => r.skew  ?? 0) ?? [];
    setGlobalCurve(rowCurves.length > 0 && rowCurves.every(c => c === rowCurves[0]) ? rowCurves[0] : 0);
    setGlobalSkew (rowSkews.length  > 0 && rowSkews.every(c  => c === rowSkews[0])  ? rowSkews[0]  : 0);
  };

  const exitFocus = () => {
    setFocused(null);
    setSelectedSeats(new Set());
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw / vw, ch / vh) * 0.85;
    setTransform({ scale, x: (cw - vw * scale) / 2, y: (ch - vh * scale) / 2 });
  };

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tableDraftRef.current) { setTableDraft(null); setTool("select"); return; }
        if (focusedRef.current) { exitFocus(); return; }
        if (toolRef.current === "polygon" || toolRef.current === "object") {
          setDrawing([]);
          setTool("select");
          return;
        }
        if (toolRef.current === "seated") {
          setSeatedPlacement(null);
          setTool("select");
          return;
        }
        setEditingTable(null);
        setSelected(null);
        setMultiSelected(new Set());
        return;
      }
      // Ctrl+C: copy selected sections
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        const allIds = new Set([...multiSelectedRef.current]);
        if (selectedRef.current) allIds.add(selectedRef.current);
        clipboardRef.current = sectionsRef.current.filter(s => allIds.has(s.id)).map(s => ({ ...s }));
        return;
      }
      // Ctrl+V: paste copied sections
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        const toPaste = clipboardRef.current;
        if (!toPaste.length) return;
        const OFFSET = 20;
        const newSections: DraftSection[] = toPaste.map(orig => ({
          ...orig,
          id: crypto.randomUUID(),
          saved: false,
          points: orig.points.map(p => ({ x: p.x + OFFSET, y: p.y + OFFSET })),
          seats: orig.seats?.map(seat => ({ ...seat, id: crypto.randomUUID(), x: seat.x + OFFSET, y: seat.y + OFFSET })),
          rows: orig.rows?.map(r => ({ ...r, id: crypto.randomUUID() })),
        }));
        setSections(prev => [...prev, ...newSections]);
        setMultiSelected(new Set(newSections.map(s => s.id)));
        if (newSections.length > 0) setSelected(newSections[0].id);
        savePastedSections(newSections);
        return;
      }
      // Arrow keys — Shift+Arrow moves label (all sections); Arrow alone moves icon (venue objects)
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
        const sel = sectionsRef.current.find(s => s.id === selectedRef.current);
        if (!sel) return;
        const isObj = isVenueObject(sel.sectionType);
        if (!isObj && !e.shiftKey) return; // non-objects only respond to Shift+Arrow
        e.preventDefault();
        const step = (e.ctrlKey || e.metaKey) ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;

        if (e.shiftKey) {
          // Shift+Arrow — move text label (all section types)
          const newLabelOffset = { x: (sel.labelOffset?.x ?? 0) + dx, y: (sel.labelOffset?.y ?? 0) + dy };
          setSections(prev => prev.map(s => s.id === sel.id ? { ...s, labelOffset: newLabelOffset } : s));
          if (sel.saved) {
            if (iconOffsetPatchTimer.current) clearTimeout(iconOffsetPatchTimer.current);
            iconOffsetPatchTimer.current = setTimeout(() => {
              const latest = sectionsRef.current.find(s => s.id === sel.id);
              if (!latest) return;
              let n: Record<string, unknown> = { labelOffset: newLabelOffset };
              if (isObj && sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS") {
                if (latest.iconOffset) n.iconOffset = latest.iconOffset;
                if (latest.iconSize) n.iconSize = latest.iconSize;
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showIcon === false) n.showIcon = false;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (sel.sectionType === "DOOR" && latest.doorMeta) {
                n = { w: latest.doorMeta.w, h: latest.doorMeta.h, angle: latest.doorMeta.angle, labelOffset: newLabelOffset };
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (sel.sectionType === "STAIRS" && latest.stairsMeta) {
                n = { w: latest.stairsMeta.w, h: latest.stairsMeta.h, angle: latest.stairsMeta.angle, labelOffset: newLabelOffset };
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (!isObj) {
                if (latest.labelSize) n.labelSize = latest.labelSize;
              }
              fetch(`/api/sections/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: JSON.stringify(n) }) });
            }, 400);
          }
        } else {
          // Arrow alone — move icon (venue objects only)
          const newIconOffset = { x: (sel.iconOffset?.x ?? 0) + dx, y: (sel.iconOffset?.y ?? 0) + dy };
          setSections(prev => prev.map(s => s.id === sel.id ? { ...s, iconOffset: newIconOffset } : s));
          if (sel.saved) {
            if (iconOffsetPatchTimer.current) clearTimeout(iconOffsetPatchTimer.current);
            iconOffsetPatchTimer.current = setTimeout(() => {
              const latest = sectionsRef.current.find(s => s.id === sel.id);
              if (!latest) return;
              const n: Record<string, unknown> = { iconOffset: newIconOffset };
              if (latest.labelOffset) n.labelOffset = latest.labelOffset;
              if (latest.iconSize) n.iconSize = latest.iconSize;
              if (latest.labelSize) n.labelSize = latest.labelSize;
              if (latest.showIcon === false) n.showIcon = false;
              if (latest.showLabel === false) n.showLabel = false;
              fetch(`/api/sections/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: JSON.stringify(n) }) });
            }, 400);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Zoom ──────────────────────────────────────────────────────────────
  // Must use a native (non-passive) wheel listener so preventDefault() actually blocks page scroll.
  // React's onWheel synthetic handler is passive since React 17 — calling preventDefault() there
  // produces a browser warning and has no effect.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      const t = transformRef.current;
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * (1 - e.deltaY * 0.001)));
      const sf = ns / t.scale;
      setTransform({ scale: ns, x: ox - sf * (ox - t.x), y: oy - sf * (oy - t.y) });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);
  const zoom = (factor: number) => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const ox = cw / 2, oy = ch / 2;
    setTransform(t => {
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * factor));
      const sf = ns / t.scale;
      return { scale: ns, x: ox - sf * (ox - t.x), y: oy - sf * (oy - t.y) };
    });
  };
  const resetZoom = () => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw / vw, ch / vh) * 0.85;
    setTransform({ scale, x: (cw - vw * scale) / 2, y: (ch - vh * scale) / 2 });
  };

  // ── SVG coord helper ──────────────────────────────────────────────────
  const clientToSvg = (clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const t = transformRef.current;
    return { x: (clientX - rect.left - t.x) / t.scale, y: (clientY - rect.top - t.y) / t.scale };
  };

  // ── Mouse down ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hasDragged.current = false;
    const target = e.target as Element;
    const t = transformRef.current;
    const focused = focusedRef.current;

    // Holds mode: seat click toggles selection directly (no focus mode needed)
    if (sidebarTabRef.current === "holds") {
      const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
      if (seatEl?.dataset.seatId) {
        const seatId = seatEl.dataset.seatId!;
        setSelectedSeats(prev => {
          const next = new Set(prev);
          if (next.has(seatId)) next.delete(seatId); else next.add(seatId);
          return next;
        });
        return;
      }
      // Shift+drag in holds mode → marquee select seats across all sections
      if (e.shiftKey) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: null };
        setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
        return;
      }
      // Empty canvas click in holds mode → just pan
      panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
      return;
    }

    if (toolRef.current === "select") {
      // 0. Group rotation handle (multi-selection)
      if (!focusedRef.current && target.closest("[data-group-rotation-handle]")) {
        const allPts = [...multiSelectedRef.current].flatMap(id => {
          const s = sectionsRef.current.find(sec => sec.id === id);
          return s ? s.points : [];
        });
        if (allPts.length > 0 && containerRef.current) {
          const bbox = polyBBox(allPts);
          const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
          const svgPt = clientToSvg(e.clientX, e.clientY);
          groupRotationDragState.current = {
            centerX: cx, centerY: cy,
            startAngle: Math.atan2(svgPt.y - cy, svgPt.x - cx),
            sections: [...multiSelectedRef.current].flatMap(id => {
              const s = sectionsRef.current.find(sec => sec.id === id);
              return s ? [{
                id,
                origPoints: s.points.map(p => ({ ...p })),
                origSeats: (s.seats ?? []).map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
                origTableAngle:  s.tableMeta?.angle,
                origDoorAngle:   s.doorMeta?.angle,
                origStairsAngle: s.stairsMeta?.angle,
                origTextAngle:   s.sectionType === "TEXT" ? (s.textAngle ?? 0) : undefined,
              }] : [];
            }),
          };
          return;
        }
      }

      // 1. Rotation handle
      const rotEl = target.closest("[data-rotation-handle]") as HTMLElement | null;
      if (rotEl) {
        const sectionId = rotEl.dataset.rotationHandle!;
        const s = sectionsRef.current.find(sec => sec.id === sectionId);
        if (s && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const svgX = (e.clientX - rect.left - transformRef.current.x) / transformRef.current.scale;
          const svgY = (e.clientY - rect.top  - transformRef.current.y) / transformRef.current.scale;
          // Rotation pivot — must match how the icon/label center is computed in the render:
          // • Seated sections: display-seat bbox center (curve/skew offsets included)
          // • All other sections (venue objects, GA polygons): vertex centroid of polygon.
          //   centroid is exactly preserved when all points are rotated around the centroid,
          //   so the icon/label stays pixel-perfect fixed throughout the drag.
          const cx = (() => {
            if (s.sectionType === "TEXT") {
              // Pivot at the text's visual center (centroid + labelOffset)
              const ctr = centroid(s.points);
              return { x: ctr.x + (s.labelOffset?.x ?? 0), y: ctr.y + (s.labelOffset?.y ?? 0) };
            }
            if (s.seats && s.seats.length > 0) {
              const ds = (s.rows && s.rows.length > 0)
                ? getDisplaySeats(s.seats, s.rows)
                : s.seats;
              const xs = ds.map(seat => seat.x);
              const ys = ds.map(seat => seat.y);
              return {
                x: (Math.min(...xs) + Math.max(...xs)) / 2,
                y: (Math.min(...ys) + Math.max(...ys)) / 2,
              };
            }
            return centroid(s.points);
          })();
          const hasRows = !!(s.rows && s.rows.length > 0 && s.seats && s.seats.length > 0);
          const dispSeats = hasRows
            ? getDisplaySeats(s.seats!, s.rows!)
            : (s.seats ?? []);
          rotationDragState.current = {
            sectionId, centerX: cx.x, centerY: cx.y,
            startAngle: Math.atan2(svgY - cx.y, svgX - cx.x),
            origPoints: s.points.map(p => ({ ...p })),
            origSeats: (s.seats ?? []).map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
            origDisplaySeats: dispSeats.map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
            sectionHasRows: hasRows,
            origTableAngle: s.tableMeta?.angle,
            origDoorAngle: s.doorMeta?.angle,
            origStairsAngle: s.stairsMeta?.angle,
            origTextAngle: s.sectionType === "TEXT" ? (s.textAngle ?? 0) : undefined,
          };
          return;
        }
      }

      // 2. Vertex handle
      const vertexEl = target.closest("[data-vertex-index]") as HTMLElement | null;
      if (vertexEl && !vertexEl.hasAttribute("data-section-id")) {
        const sectionEl = vertexEl.closest("[data-section-id]") as HTMLElement | null;
        if (sectionEl) {
          const sectionId = sectionEl.dataset.sectionId!;
          const s = sectionsRef.current.find(sec => sec.id === sectionId);
          if (s) {
            vertexDragState.current = {
              sectionId, vertexIndex: parseInt(vertexEl.dataset.vertexIndex!),
              startClientX: e.clientX, startClientY: e.clientY,
              origPoints: s.points.map(p => ({ ...p })),
              origDoorMeta: s.doorMeta ? { ...s.doorMeta } : undefined,
              origStairsMeta: s.stairsMeta ? { ...s.stairsMeta } : undefined,
              origTableMeta: s.tableMeta ? { ...s.tableMeta } : undefined,
            };
            return;
          }
        }
      }

      if (focused) {
        // 2. Row label click (focus mode) – track for rename on mouseup
        const rowEl = target.closest("[data-row-id]") as HTMLElement | null;
        if (rowEl) {
          rowLabelDownRef.current = { rowId: rowEl.dataset.rowId!, screenX: e.clientX, screenY: e.clientY };
          panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
          return;
        }

        // 3. Seat drag / click (focus mode)
        const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
        const seatSecEl = seatEl?.closest("[data-section-id]") as HTMLElement | null;
        if (seatEl && seatSecEl?.dataset.sectionId === focused) {
          const seatId = seatEl.dataset.seatId!;
          const section = sectionsRef.current.find(s => s.id === focused);
          if (section) {
            if (e.shiftKey) {
              setSelectedSeats(prev => {
                const next = new Set(prev);
                if (next.has(seatId)) next.delete(seatId); else next.add(seatId);
                return next;
              });
              return;
            }
            const selectedNow = selectedSeatsRef.current;
            const dragSeats = selectedNow.has(seatId)
              ? section.seats?.filter(s => selectedNow.has(s.id)) ?? []
              : section.seats?.filter(s => s.id === seatId) ?? [];
            if (!selectedNow.has(seatId)) setSelectedSeats(new Set([seatId]));
            seatDragState.current = {
              primarySeatId: seatId,
              origSeats: dragSeats.map(s => ({ id: s.id, x: s.x, y: s.y })),
              startClientX: e.clientX, startClientY: e.clientY,
              sectionId: focused,
            };
            return;
          }
        }

        // 4. Shift+drag → marquee select
        if (e.shiftKey) {
          const svgPt = clientToSvg(e.clientX, e.clientY);
          marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: focused };
          setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
          return;
        }
      }

      // 5. Shift+drag in editor (non-focus) → marquee select objects/sections
      if (e.shiftKey && !focused) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: null };
        setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
        return;
      }

      // 6. Section body drag
      const sectionEl = target.closest("[data-section-id]") as HTMLElement | null;
      if (sectionEl) {
        const sectionId = sectionEl.dataset.sectionId!;
        const s = sectionsRef.current.find(sec => sec.id === sectionId);
        if (s) {
          if (e.shiftKey) {
            // Shift+click: toggle in multi-selection
            setMultiSelected(prev => {
              const next = new Set(prev);
              if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
              return next;
            });
            if (!selectedRef.current) setSelected(sectionId);
            return;
          }
          // If not in multi-selection, reset it to just this section
          if (!multiSelectedRef.current.has(sectionId)) {
            setMultiSelected(new Set([sectionId]));
          }
          // Set selected immediately so isSel = true right away (prevents flash of multiSelected dashed outline)
          if (!e.shiftKey) setSelected(sectionId);
          // Build extra sections for simultaneous drag
          const allSel = multiSelectedRef.current.size > 1 ? [...multiSelectedRef.current] : [sectionId];
          const extra = allSel
            .filter(id => id !== sectionId)
            .flatMap(id => {
              const sec = sectionsRef.current.find(sec2 => sec2.id === id);
              return sec ? [{ id, origPoints: sec.points.map(p => ({ ...p })), origSeats: (sec.seats ?? []).map(seat => ({ ...seat })) }] : [];
            });
          sectionDragState.current = {
            sectionId,
            startClientX: e.clientX, startClientY: e.clientY,
            origPoints: s.points.map(p => ({ ...p })),
            origSeats: (s.seats ?? []).map(seat => ({ ...seat })),
            downTarget: target,
            extra,
          };
          return;
        }
      }
    }

    if (toolRef.current === "table") {
      const pt = clientToSvg(e.clientX, e.clientY);
      setTableDraft({ startPt: pt, endPt: pt });
      return;
    }

    panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
  };

  // ── Mouse move ────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const t = transformRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    setMouse({ x: (e.clientX - rect.left - t.x) / t.scale, y: (e.clientY - rect.top - t.y) / t.scale });

    if (groupRotationDragState.current) {
      const { centerX, centerY, startAngle, sections } = groupRotationDragState.current;
      if (!hasDragged.current) hasDragged.current = true;
      const svgX = (e.clientX - rect.left - t.x) / t.scale;
      const svgY = (e.clientY - rect.top  - t.y) / t.scale;
      const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rotPt = (p: Point) => ({
        x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
        y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
      });
      const angleDeg = angle * (180 / Math.PI);
      setSections(prev => prev.map(s => {
        const orig = sections.find(sec => sec.id === s.id);
        if (!orig) return s;
        const next: typeof s = {
          ...s,
          points: orig.origPoints.map(rotPt),
          seats: s.seats?.map(seat => {
            const o = orig.origSeats.find(os => os.id === seat.id);
            return o ? { ...seat, ...rotPt(o) } : seat;
          }),
        };
        if (next.tableMeta && orig.origTableAngle !== undefined)
          next.tableMeta = { ...next.tableMeta, angle: orig.origTableAngle + angleDeg };
        if (next.doorMeta && orig.origDoorAngle !== undefined)
          next.doorMeta = { ...next.doorMeta, angle: orig.origDoorAngle + angleDeg };
        if (next.stairsMeta && orig.origStairsAngle !== undefined)
          next.stairsMeta = { ...next.stairsMeta, angle: orig.origStairsAngle + angleDeg };
        if (next.sectionType === "TEXT" && orig.origTextAngle !== undefined)
          next.textAngle = orig.origTextAngle + angleDeg;
        return next;
      }));

    } else if (rotationDragState.current) {
      const { centerX, centerY, startAngle, sectionId, origPoints, origSeats, origDisplaySeats, sectionHasRows, origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } = rotationDragState.current;
      if (!hasDragged.current) hasDragged.current = true;
      const svgX = (e.clientX - rect.left - t.x) / t.scale;
      const svgY = (e.clientY - rect.top  - t.y) / t.scale;
      const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rotate = (p: { x: number; y: number }) => ({
        x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
        y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
      });
      setSections(prev => prev.map(s => {
        if (s.id !== sectionId) return s;
        const angleDeg = angle * (180 / Math.PI);
        // TEXT: only update textAngle — polygon stays fixed (it's just a tiny hit-area placeholder)
        if (s.sectionType === "TEXT" && origTextAngle !== undefined) {
          return { ...s, textAngle: origTextAngle + angleDeg };
        }
        // DOOR: only update doorMeta.angle — polygon corners stay fixed so the SVG center never drifts
        if (s.doorMeta !== undefined && origDoorAngle !== undefined) {
          return { ...s, doorMeta: { ...s.doorMeta, angle: origDoorAngle + angleDeg } };
        }
        // STAIRS: only update stairsMeta.angle — same rationale as DOOR
        if (s.stairsMeta !== undefined && origStairsAngle !== undefined) {
          return { ...s, stairsMeta: { ...s.stairsMeta, angle: origStairsAngle + angleDeg } };
        }
        const next: typeof s = {
          ...s,
          points: origPoints.map(rotate),
          seats: sectionHasRows
            // Rotate display (curve-applied) positions and store as raw — zero out curve/skew so getDisplaySeats adds no extra offset
            ? s.seats?.map(seat => {
                const orig = origDisplaySeats.find(o => o.id === seat.id);
                return orig ? { ...seat, ...rotate(orig) } : seat;
              })
            : s.seats?.map(seat => {
                const orig = origSeats.find(o => o.id === seat.id);
                return orig ? { ...seat, ...rotate(orig) } : seat;
              }),
          // Zero out curve/skew so getDisplaySeats is a no-op and baked-in positions display correctly
          rows: sectionHasRows
            ? s.rows?.map(r => ({ ...r, curve: 0, skew: 0 }))
            : s.rows,
        };
        // For TABLE sections, rotate tableMeta.angle so the surface follows
        if (next.tableMeta !== undefined && origTableAngle !== undefined) {
          next.tableMeta = { ...next.tableMeta, angle: origTableAngle + angleDeg };
        }
        return next;
      }));

    } else if (seatDragState.current) {
      const { startClientX, startClientY, origSeats, sectionId } = seatDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 3) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      const section = sectionsRef.current.find(s => s.id === sectionId);
      if (!section) return;
      const bbox = polyBBox(section.points);
      const r = seatRadiusRef.current;
      const isTable = section.sectionType === "TABLE";
      const origMap = new Map(origSeats.map(o => [o.id, o]));
      setSections(prev => prev.map(s => s.id !== sectionId ? s : {
        ...s,
        seats: s.seats?.map(seat => {
          const orig = origMap.get(seat.id);
          if (!orig) return seat;
          return {
            ...seat,
            x: isTable ? orig.x + sdx : Math.max(bbox.minX + r, Math.min(bbox.maxX - r, orig.x + sdx)),
            y: isTable ? orig.y + sdy : Math.max(bbox.minY + r, Math.min(bbox.maxY - r, orig.y + sdy)),
          };
        }),
      }));

    } else if (marqueeStateRef.current) {
      const svgPt = clientToSvg(e.clientX, e.clientY);
      if (!hasDragged.current) hasDragged.current = true;
      setMarqueeRect(prev => prev ? { ...prev, x2: svgPt.x, y2: svgPt.y } : null);

    } else if (vertexDragState.current) {
      const { startClientX, startClientY, sectionId, vertexIndex, origPoints, origDoorMeta, origStairsMeta, origTableMeta } = vertexDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 2) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      setSections(prev => prev.map(s => {
        if (s.id !== sectionId) return s;
        // DOOR: maintain rectangle shape — fix opposite corner, resize from dragged corner
        if (s.sectionType === "DOOR" && origDoorMeta) {
          const angle = origDoorMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(10, Math.abs(ddx * cosA + ddy * sinA));
          const newH = Math.max(10, Math.abs(-ddx * sinA + ddy * cosA));
          return { ...s, points: doorRectPoints(newCx, newCy, newW, newH, angle), doorMeta: { ...origDoorMeta, w: newW, h: newH } };
        }
        if (s.sectionType === "STAIRS" && origStairsMeta) {
          const angle = origStairsMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(10, Math.abs(ddx * cosA + ddy * sinA));
          const newH = Math.max(10, Math.abs(-ddx * sinA + ddy * cosA));
          return { ...s, points: doorRectPoints(newCx, newCy, newW, newH, angle), stairsMeta: { ...origStairsMeta, w: newW, h: newH } };
        }
        if (s.sectionType === "TABLE" && origTableMeta) {
          const angle = origTableMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          // tableBoundingPoints adds PAD=30 on each side, so bbox span = meta.w + 60.
          // Subtract 60 to recover the actual table surface dimensions.
          const newW = Math.max(40, Math.abs(ddx * cosA + ddy * sinA) - 60);
          const newH = Math.max(30, Math.abs(-ddx * sinA + ddy * cosA) - 60);
          const newMeta = { ...origTableMeta, w: newW, h: newH };
          const newChairPts = computeChairPositions(newMeta, newCx, newCy);
          const updatedSeats = s.seats && s.seats.length > 0
            ? s.seats.map((seat, i) => i < newChairPts.length ? { ...seat, x: newChairPts[i].x, y: newChairPts[i].y } : seat)
            : s.seats;
          return { ...s, points: tableBoundingPoints(newMeta, newCx, newCy), tableMeta: newMeta, seats: updatedSeats };
        }
        return { ...s, points: origPoints.map((p, i) => i === vertexIndex ? { x: p.x + sdx, y: p.y + sdy } : { ...p }) };
      }));

    } else if (sectionDragState.current) {
      const { startClientX, startClientY, sectionId, origPoints, origSeats, extra } = sectionDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 4) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      const extraMap = new Map(extra.map(x => [x.id, x]));
      setSections(prev => prev.map(s => {
        if (s.id === sectionId) return { ...s, points: origPoints.map(p => ({ x: p.x + sdx, y: p.y + sdy })), seats: origSeats.map(seat => ({ ...seat, x: seat.x + sdx, y: seat.y + sdy })) };
        const ex = extraMap.get(s.id);
        if (ex) return { ...s, points: ex.origPoints.map(p => ({ x: p.x + sdx, y: p.y + sdy })), seats: ex.origSeats.map(seat => ({ ...seat, x: seat.x + sdx, y: seat.y + sdy })) };
        return s;
      }));

    } else if (tableDraftRef.current) {
      const pt = clientToSvg(e.clientX, e.clientY);
      setTableDraft(prev => prev ? { ...prev, endPt: pt } : null);

    } else if (panState.current) {
      const { startX, startY, startTx, startTy } = panState.current;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 4) hasDragged.current = true;
      if (!hasDragged.current) return;
      setTransform(prev => ({ ...prev, x: startTx + dx, y: startTy + dy }));
    }
  };

  // ── Mouse up ──────────────────────────────────────────────────────────
  const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const t = transformRef.current;

    // Group rotation drag
    if (groupRotationDragState.current) {
      const { centerX, centerY, startAngle, sections } = groupRotationDragState.current;
      groupRotationDragState.current = null;
      if (hasDragged.current) {
        const r = containerRef.current!.getBoundingClientRect();
        const svgX = (e.clientX - r.left - t.x) / t.scale;
        const svgY = (e.clientY - r.top  - t.y) / t.scale;
        const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
        const angleDeg = angle * (180 / Math.PI);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const rotPt = (p: { x: number; y: number }) => ({
          x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
          y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
        });
        for (const { id, origPoints, origSeats, origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } of sections) {
          const sec = sectionsRef.current.find(s => s.id === id);
          if (!sec?.saved) continue;
          const finalPts = origPoints.map(rotPt);
          const finalSeats = origSeats.map(s => ({ id: s.id, ...rotPt(s) }));
          let notes: string | undefined;
          if (sec.sectionType === "TEXT" && origTextAngle !== undefined) {
            const n: Record<string, unknown> = { textAngle: origTextAngle + angleDeg };
            if (sec.textColor) n.textColor = sec.textColor;
            if (sec.textBold) n.textBold = sec.textBold;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            notes = JSON.stringify(n);
          } else if (sec.tableMeta && origTableAngle !== undefined) {
            notes = JSON.stringify({ ...sec.tableMeta, angle: origTableAngle + angleDeg });
          } else if (sec.doorMeta && origDoorAngle !== undefined) {
            const n: Record<string, unknown> = { w: sec.doorMeta.w, h: sec.doorMeta.h, angle: origDoorAngle + angleDeg };
            if (sec.showLabel === false) n.showLabel = false;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            notes = JSON.stringify(n);
          } else if (sec.stairsMeta && origStairsAngle !== undefined) {
            const n: Record<string, unknown> = { w: sec.stairsMeta.w, h: sec.stairsMeta.h, angle: origStairsAngle + angleDeg };
            if (sec.showLabel === false) n.showLabel = false;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            notes = JSON.stringify(n);
          }
          await fetch(`/api/sections/${id}/rotate`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(finalPts), seats: finalSeats, ...(notes !== undefined ? { notes } : {}) }),
          });
        }
      }
      hasDragged.current = false;
      return;
    }

    // Rotation drag
    if (rotationDragState.current) {
      // Capture the full drag state BEFORE clearing — sectionsRef may be stale (useEffect
      // updates it after render, but we're still inside the event handler right now).
      const drag = rotationDragState.current;
      rotationDragState.current = null;
      if (hasDragged.current) {
        const { sectionId, centerX, centerY, startAngle,
                origPoints, origSeats, origDisplaySeats, sectionHasRows,
                origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } = drag;

        // Recompute final angle from cursor (same formula as mousemove)
        const rect = containerRef.current!.getBoundingClientRect();
        const svgX = (e.clientX - rect.left - t.x) / t.scale;
        const svgY = (e.clientY - rect.top  - t.y) / t.scale;
        const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
        const angleDeg = angle * (180 / Math.PI);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const rotPt = (p: { x: number; y: number }) => ({
          x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
          y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
        });

        // Grab the section from ref only for metadata (doorMeta etc.) — not for positions
        const section = sectionsRef.current.find(s => s.id === sectionId);

        if (origTextAngle !== undefined && section?.sectionType === "TEXT") {
          const finalTextAngle = origTextAngle + angleDeg;
          const n: Record<string, unknown> = { textAngle: finalTextAngle };
          if (section.textColor) n.textColor = section.textColor;
          if (section.textBold) n.textBold = section.textBold;
          if (section.labelSize) n.labelSize = section.labelSize;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.saved) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: JSON.stringify(n) }),
            });
          }
        } else if (origDoorAngle !== undefined && section?.doorMeta) {
          const m = section.doorMeta;
          const n: Record<string, unknown> = { w: m.w, h: m.h, angle: origDoorAngle + angleDeg };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: JSON.stringify(n) }),
          });
        } else if (origStairsAngle !== undefined && section?.stairsMeta) {
          const m = section.stairsMeta;
          const n: Record<string, unknown> = { w: m.w, h: m.h, angle: origStairsAngle + angleDeg };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: JSON.stringify(n) }),
          });
        } else {
          // Compute final positions directly from drag-state snapshots — never from stale ref
          const finalPoints = origPoints.map(rotPt);
          const finalSeats = sectionHasRows
            ? origDisplaySeats.map(s => ({ id: s.id, ...rotPt(s) }))
            : origSeats.map(s => ({ id: s.id, ...rotPt(s) }));

          await fetch(`/api/sections/${sectionId}/rotate`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(finalPoints), seats: finalSeats }),
          });
          // Bake curve/skew=0 into DB for sections with rows
          if (sectionHasRows && section?.rows?.length) {
            await Promise.all(section.rows.map(row =>
              fetch(`/api/rows/${row.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ curve: 0, skew: 0 }),
              })
            ));
          }
          // TABLE: persist the updated angle in notes
          if (origTableAngle !== undefined && section?.tableMeta) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: JSON.stringify({ ...section.tableMeta, angle: origTableAngle + angleDeg }) }),
            });
          }
          // Also rotate all other multi-selected sections by the same angle
          const otherIds = [...multiSelectedRef.current].filter(id => id !== sectionId);
          for (const otherId of otherIds) {
            const other = sectionsRef.current.find(s => s.id === otherId);
            if (!other || !other.saved) continue;
            const oc = centroid(other.points);
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const rotOther = (p: Point) => ({
              x: oc.x + (p.x - oc.x) * cosA - (p.y - oc.y) * sinA,
              y: oc.y + (p.x - oc.x) * sinA + (p.y - oc.y) * cosA,
            });
            const finalPts = other.points.map(rotOther);
            const finalSts = (other.seats ?? []).map(s => ({ id: s.id, ...rotOther(s) }));
            setSections(prev => prev.map(s => s.id !== otherId ? s : {
              ...s,
              points: finalPts,
              seats: s.seats?.map(seat => { const f = finalSts.find(fs => fs.id === seat.id); return f ? { ...seat, x: f.x, y: f.y } : seat; }),
            }));
            if (other.sectionType !== "DOOR" && other.sectionType !== "STAIRS") {
              await fetch(`/api/sections/${otherId}/rotate`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ polygonPath: pointsToPath(finalPts), seats: finalSts }),
              });
            }
          }
        }
      }
      hasDragged.current = false;
      return;
    }

    // Row label click
    if (rowLabelDownRef.current) {
      const info = rowLabelDownRef.current;
      rowLabelDownRef.current = null;
      panState.current = null;
      if (!hasDragged.current) {
        const section = sectionsRef.current.find(s => s.id === focusedRef.current);
        const row = section?.rows?.find(r => r.id === info.rowId);
        if (row) setEditingRow({ id: info.rowId, value: row.label, screenX: info.screenX, screenY: info.screenY });
      }
      hasDragged.current = false;
      return;
    }

    if (seatDragState.current) {
      const { primarySeatId, origSeats, startClientX, startClientY, sectionId } = seatDragState.current;
      seatDragState.current = null;
      if (hasDragged.current) {
        const dx = (e.clientX - startClientX) / t.scale;
        const dy = (e.clientY - startClientY) / t.scale;
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section) {
          const bbox = polyBBox(section.points);
          const r = seatRadiusRef.current;
          const isTable = section.sectionType === "TABLE";
          for (const orig of origSeats) {
            const nx = isTable ? orig.x + dx : Math.max(bbox.minX + r, Math.min(bbox.maxX - r, orig.x + dx));
            const ny = isTable ? orig.y + dy : Math.max(bbox.minY + r, Math.min(bbox.maxY - r, orig.y + dy));
            await fetch(`/api/seats/${orig.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ x: nx, y: ny }),
            });
          }
        }
      } else if (origSeats.length === 1) {
        // Single-click just selects the seat — editing opens on double-click
        setSelectedSeats(new Set([primarySeatId]));
      }

    } else if (marqueeStateRef.current) {
      const { startSvgX, startSvgY, sectionId } = marqueeStateRef.current;
      marqueeStateRef.current = null;
      const svgPt = clientToSvg(e.clientX, e.clientY);
      const box = { x1: startSvgX, y1: startSvgY, x2: svgPt.x, y2: svgPt.y };
      if (sectionId === null) {
        // Global marquee: holds mode → select seats across all sections; editor → select sections
        if (sidebarTabRef.current === "holds") {
          const ids: string[] = [];
          for (const s of sectionsRef.current) {
            if (!s.seats) continue;
            const displaySeats = (s.rows && s.rows.length > 0) ? getDisplaySeats(s.seats, s.rows) : s.seats;
            for (const seat of displaySeats) { if (rectContains(box, seat)) ids.push(seat.id); }
          }
          setSelectedSeats(new Set(ids));
        } else {
          // Select sections whose centroid falls inside the marquee
          const ids = sectionsRef.current
            .filter(s => { const c = centroid(s.points); return rectContains(box, c); })
            .map(s => s.id);
          if (ids.length > 0) {
            setMultiSelected(new Set(ids));
            setSelected(ids[0]);
          }
        }
      } else {
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section?.seats) {
          const displaySeats = (section.rows && section.rows.length > 0)
            ? getDisplaySeats(section.seats, section.rows)
            : section.seats;
          setSelectedSeats(new Set(displaySeats.filter(seat => rectContains(box, seat)).map(s => s.id)));
        }
      }
      setMarqueeRect(null);

    } else if (vertexDragState.current) {
      const { sectionId, vertexIndex, startClientX, startClientY, origPoints, origTableMeta } = vertexDragState.current;
      vertexDragState.current = null;
      if (hasDragged.current) {
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section?.sectionType === "DOOR" && section.doorMeta) {
          const n: Record<string, unknown> = { w: section.doorMeta.w, h: section.doorMeta.h, angle: section.doorMeta.angle };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(section.points), notes: JSON.stringify(n) }),
          });
        } else if (section?.sectionType === "STAIRS" && section.stairsMeta) {
          const n: Record<string, unknown> = { w: section.stairsMeta.w, h: section.stairsMeta.h, angle: section.stairsMeta.angle };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(section.points), notes: JSON.stringify(n) }),
          });
        } else if (section?.sectionType === "TABLE" && origTableMeta) {
          // Recompute final meta from drag delta (avoids stale sectionsRef)
          const dx = (e.clientX - startClientX) / t.scale;
          const dy = (e.clientY - startClientY) / t.scale;
          const newCorner = { x: origPoints[vertexIndex].x + dx, y: origPoints[vertexIndex].y + dy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (origTableMeta.angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(40, Math.abs(ddx * cosA + ddy * sinA) - 60);
          const newH = Math.max(30, Math.abs(-ddx * sinA + ddy * cosA) - 60);
          const newMeta = { ...origTableMeta, w: newW, h: newH };
          const newPts = tableBoundingPoints(newMeta, newCx, newCy);
          upd(sectionId, { tableMeta: newMeta, points: newPts });
          if (section.saved) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ polygonPath: pointsToPath(newPts), notes: JSON.stringify(newMeta) }),
            });
            // Recreate chairs at new positions
            const newChairPts = computeChairPositions(newMeta, newCx, newCy);
            if (section.rows?.[0]) {
              await fetch(`/api/rows/${section.rows[0].id}`, { method: "DELETE" });
              const rowRes = await fetch(`/api/sections/${sectionId}/rows`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  label: "chairs", startX: newCx, startY: newCy,
                  seats: newChairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
                }),
              });
              const savedRow = await rowRes.json();
              upd(sectionId, {
                rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
                seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
                  id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
                  rowLabel: "chairs", rowId: savedRow.id,
                })),
              });
            }
          }
        } else {
          const dx = (e.clientX - startClientX) / t.scale;
          const dy = (e.clientY - startClientY) / t.scale;
          const newPoints = origPoints.map((p, i) => i === vertexIndex ? { x: p.x + dx, y: p.y + dy } : { ...p });
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(newPoints) }),
          });
        }
      }

    } else if (sectionDragState.current) {
      const { sectionId, startClientX, startClientY, origPoints, origSeats, extra } = sectionDragState.current;
      sectionDragState.current = null;
      if (!hasDragged.current) {
        setSelected(sectionId);
        if (!e.shiftKey) setMultiSelected(new Set([sectionId]));
      } else {
        const dx = (e.clientX - startClientX) / t.scale;
        const dy = (e.clientY - startClientY) / t.scale;
        const allToSave = [
          { id: sectionId, origPoints, origSeats },
          ...extra.map(x => ({ id: x.id, origPoints: x.origPoints, origSeats: x.origSeats })),
        ];
        for (const item of allToSave) {
          const sec = sectionsRef.current.find(s => s.id === item.id);
          if (sec?.saved) {
            await fetch(`/api/sections/${item.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ polygonPath: pointsToPath(item.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }))) }),
            });
            if (item.origSeats.length > 0) {
              await fetch(`/api/sections/${item.id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dx, dy }),
              });
            }
          }
        }
      }

    } else if (tableDraftRef.current) {
      const draft = tableDraftRef.current;
      setTableDraft(null);
      const dx = Math.abs(draft.endPt.x - draft.startPt.x);
      const dy = Math.abs(draft.endPt.y - draft.startPt.y);
      if (dx > 20 || dy > 20) {
        const cx = (draft.startPt.x + draft.endPt.x) / 2;
        const cy = (draft.startPt.y + draft.endPt.y) / 2;
        const meta: TableMeta = { ...tableCfg, w: Math.max(40, dx), h: Math.max(30, dy), angle: 0 };
        const pts = tableBoundingPoints(meta, cx, cy);
        const id = crypto.randomUUID();
        const tableNum = sectionsRef.current.filter(s => s.sectionType === "TABLE").length + 1;
        setSections(prev => [...prev, {
          id, name: `Table ${tableNum}`, label: `T${tableNum}`,
          sectionType: "TABLE", points: pts, saved: false, edgeCurve: 0, tableMeta: meta,
        }]);
        setSelected(id);
        setTool("select");
      }

    } else if (panState.current) {
      panState.current = null;
      if (!hasDragged.current) {
        if (toolRef.current === "seated") {
          const pt = clientToSvg(e.clientX, e.clientY);
          setSeatedPlacement(pt);
          hasDragged.current = false; return;
        }

        if (toolRef.current === "text") {
          const pt = clientToSvg(e.clientX, e.clientY);
          const textNum = sectionsRef.current.filter(s => s.sectionType === "TEXT").length + 1;
          const id = crypto.randomUUID();
          // Tiny 2x2 invisible polygon as hit area, centered at click point
          const pts = [
            { x: pt.x - 1, y: pt.y - 1 }, { x: pt.x + 1, y: pt.y - 1 },
            { x: pt.x + 1, y: pt.y + 1 }, { x: pt.x - 1, y: pt.y + 1 },
          ];
          setSections(p => [...p, {
            id, name: `Text ${textNum}`, label: `Text ${textNum}`,
            sectionType: "TEXT" as DraftSection["sectionType"],
            points: pts, saved: false, edgeCurve: 0,
            textColor: "#ffffff", labelSize: 18,
          }]);
          setSelected(id);
          setTextEditId(id);
          setTool("select");
          hasDragged.current = false; return;
        }

        if (toolRef.current === "polygon" || toolRef.current === "object") {
          const pt = clientToSvg(e.clientX, e.clientY);
          const d = drawingRef.current;

          // All venue objects (except WALL/TABLE): single click places an 80×80 square
          const OBJ_SZ = 80;
          if (toolRef.current === "object" && objectTypeRef.current === "DOOR") {
            const meta: DoorMeta = { w: OBJ_SZ, h: OBJ_SZ, angle: 0 };
            const pts = doorRectPoints(pt.x, pt.y, OBJ_SZ, OBJ_SZ, 0);
            const id = crypto.randomUUID();
            setSections(p => [...p, { id, name: "Door", label: "Door", sectionType: "DOOR", points: pts, saved: false, edgeCurve: 0, doorMeta: meta }]);
            setSelected(id); setTool("select");
            setObjectCreateDraft({ sectionId: id, name: "Door", iconType: "DOOR" });
            hasDragged.current = false; return;
          }
          if (toolRef.current === "object" && objectTypeRef.current === "STAIRS") {
            const meta: DoorMeta = { w: OBJ_SZ, h: OBJ_SZ, angle: 0 };
            const pts = doorRectPoints(pt.x, pt.y, OBJ_SZ, OBJ_SZ, 0);
            const id = crypto.randomUUID();
            setSections(p => [...p, { id, name: "Stairs", label: "Stairs", sectionType: "STAIRS", points: pts, saved: false, edgeCurve: 0, stairsMeta: meta }]);
            setSelected(id); setTool("select");
            setObjectCreateDraft({ sectionId: id, name: "Stairs", iconType: "STAIRS" });
            hasDragged.current = false; return;
          }
          if (toolRef.current === "object" && objectTypeRef.current !== "WALL") {
            const objCfg = VENUE_OBJECT_CFG[objectTypeRef.current];
            const pts = doorRectPoints(pt.x, pt.y, OBJ_SZ, OBJ_SZ, 0);
            const id = crypto.randomUUID();
            setSections(p => [...p, {
              id, name: objCfg?.label ?? objectTypeRef.current, label: objCfg?.label ?? objectTypeRef.current,
              sectionType: objectTypeRef.current as DraftSection["sectionType"],
              points: pts, saved: false, edgeCurve: 0,
            }]);
            setSelected(id); setTool("select");
            setObjectCreateDraft({ sectionId: id, name: objCfg?.label ?? objectTypeRef.current, iconType: objectTypeRef.current });
            hasDragged.current = false; return;
          }

          // WALL: second point auto-finishes the line
          if (toolRef.current === "object" && objectTypeRef.current === "WALL") {
            const newPts = [...d, pt];
            if (newPts.length === 2) {
              const id = crypto.randomUUID();
              setSections(p => [...p, { id, name: "Wall", label: "Wall", sectionType: "WALL", points: newPts, saved: false, edgeCurve: 0 }]);
              setDrawing([]);
              setSelected(id);
              setTool("select");
              setObjectCreateDraft({ sectionId: id, name: "Wall", iconType: "WALL" });
              hasDragged.current = false; return;
            }
            setDrawing(prev => [...prev, pt]);
            hasDragged.current = false; return;
          }

          if (d.length >= 2 && Math.hypot(pt.x - d[0].x, pt.y - d[0].y) < 20 / t.scale) {
            finishPolygon(); hasDragged.current = false; return;
          }
          setDrawing(prev => [...prev, pt]);
        } else {
          if (focusedRef.current) exitFocus();
          else { setSelected(null); setMultiSelected(new Set()); }
        }
      }
    }
    hasDragged.current = false;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolRef.current === "polygon" || toolRef.current === "object") { finishPolygon(); return; }
    const target = e.target as Element;
    // Double-click on a seat → open seat editor
    const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
    if (seatEl) {
      const seatId = seatEl.dataset.seatId!;
      const sectionId = focusedRef.current;
      if (!sectionId) return;
      const section = sectionsRef.current.find(s => s.id === sectionId);
      const seat = section?.seats?.find(s => s.id === seatId);
      if (seat) setEditingSeat({ id: seat.id, value: seat.seatNumber, shape: seat.shape ?? seatShape, sectionId, screenX: e.clientX, screenY: e.clientY });
      return;
    }
    const sectionEl = target.closest("[data-section-id]") as HTMLElement | null;
    if (sectionEl) {
      const sectionId = sectionEl.dataset.sectionId!;
      const s = sectionsRef.current.find(sec => sec.id === sectionId);
      if (!s) return;
      if (s.sectionType === "TABLE") {
        setEditingTable({ sectionId: s.id, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      if (s.sectionType === "TEXT") {
        setTextEditId(s.id);
        setSelected(s.id);
        return;
      }
      if (s.seats && s.seats.length > 0) focusSection(sectionId);
    }
  };

  const handleMouseLeave = () => {
    panState.current = null;
    sectionDragState.current = null;
    rotationDragState.current = null;
    groupRotationDragState.current = null;
  };

  // ── Polygon ───────────────────────────────────────────────────────────
  const finishPolygon = () => {
    const d = drawingRef.current;
    if (d.length < 3) return;
    const id = crypto.randomUUID();
    const isObj = toolRef.current === "object";
    const objCfg = isObj ? VENUE_OBJECT_CFG[objectTypeRef.current] : null;
    setSections(p => [...p, {
      id,
      name:  objCfg ? objCfg.label : `Section ${p.length + 1}`,
      label: objCfg ? objCfg.label : `S${p.length + 1}`,
      sectionType: (isObj ? objectTypeRef.current : "GA") as DraftSection["sectionType"],
      points: [...d], saved: false, edgeCurve: 0,
    }]);
    setDrawing([]);
    setSelected(id);
    setTool("select");
    if (isObj) {
      setObjectCreateDraft({ sectionId: id, name: objCfg!.label, iconType: objectTypeRef.current });
    }
  };

  // ── Section save ──────────────────────────────────────────────────────
  const saveSection = async (s: DraftSection) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: s.name, label: s.label, sectionType: s.sectionType, polygonPath: pointsToPath(s.points),
      };
      if (s.sectionType === "DOOR" && s.doorMeta) {
        const n: Record<string, unknown> = { w: s.doorMeta.w, h: s.doorMeta.h, angle: s.doorMeta.angle };
        if (s.showLabel === false) n.showLabel = false;
        if (s.labelOffset) n.labelOffset = s.labelOffset;
        if (s.labelSize) n.labelSize = s.labelSize;
        body.notes = JSON.stringify(n);
      } else if (s.sectionType === "STAIRS" && s.stairsMeta) {
        const n: Record<string, unknown> = { w: s.stairsMeta.w, h: s.stairsMeta.h, angle: s.stairsMeta.angle };
        if (s.showLabel === false) n.showLabel = false;
        if (s.labelOffset) n.labelOffset = s.labelOffset;
        if (s.labelSize) n.labelSize = s.labelSize;
        body.notes = JSON.stringify(n);
      } else if (s.sectionType === "TEXT") {
        const notesObj: Record<string, unknown> = {};
        if (s.textColor) notesObj.textColor = s.textColor;
        if (s.textBold) notesObj.textBold = s.textBold;
        if (s.textAngle) notesObj.textAngle = s.textAngle;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      } else if (s.sectionType !== "WALL" && isVenueObject(s.sectionType)) {
        const notesObj: Record<string, unknown> = {};
        if (s.iconOffset) notesObj.iconOffset = s.iconOffset;
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (s.iconSize) notesObj.iconSize = s.iconSize;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.showIcon === false) notesObj.showIcon = false;
        if (s.showLabel === false) notesObj.showLabel = false;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      } else if (!isVenueObject(s.sectionType) && s.sectionType !== "TABLE") {
        const notesObj: Record<string, unknown> = {};
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.edgeCurve) notesObj.edgeCurve = s.edgeCurve;
        if (s.capacity !== undefined) notesObj.capacity = s.capacity;
        if (s.maxPerOrder !== undefined) notesObj.maxPerOrder = s.maxPerOrder;
        if (s.hideSeats) notesObj.hideSeats = s.hideSeats;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      }
      if (s.saved) {
        await fetch(`/api/sections/${s.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (s.zoneId) await fetch(`/api/sections/${s.id}/zone`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: s.zoneId }),
        });
      } else {
        const res = await fetch(`/api/maps/${mapId}/sections`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const saved = await res.json();
        if (s.zoneId) await fetch(`/api/sections/${saved.id}/zone`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: s.zoneId }),
        });
        upd(s.id, { saved: true, id: saved.id });
      }
    } finally { setSaving(false); }
  };

  // ── Generate rows ─────────────────────────────────────────────────────
  const generateRows = async () => {
    if (!selected) return;
    const sectionId = selected;
    setSaving(true);
    try {
      const { count, seatsPerRow, startX, startY, spacingX, spacingY,
              rowLabelType, rowStart, seatOrder, seatStart } = rowCfg;
      for (let r = 0; r < count; r++) {
        const rowY = startY + r * spacingY;
        const rowLabel = rowLabelType === "letters"
          ? String.fromCharCode(65 + rowStart + r)
          : String(rowStart + r + 1);
        const seats = Array.from({ length: seatsPerRow }, (_, i) => {
          const num = seatOrder === "rtl" ? (seatStart + seatsPerRow - 1 - i) : (seatStart + i);
          return { seatNumber: String(num), x: startX + i * spacingX, y: rowY };
        });
        await fetch(`/api/sections/${sectionId}/rows`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: rowLabel, startX, startY: rowY, seats }),
        });
      }
      const map = await fetch(`/api/maps/${mapId}`).then(r => r.json());
      const fresh = map.sections.find((s: { id: string }) => s.id === sectionId);
      if (fresh) {
        type FR = { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string }[] };
        const newSeats: SeatDot[] = fresh.rows.flatMap((row: FR) =>
          row.seats.map(seat => ({ id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id }))
        );
        const newRows: RowInfo[] = fresh.rows.map((row: FR) => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 }));
        const PAD = 16;
        const xs = newSeats.map(s => s.x), ys = newSeats.map(s => s.y);
        const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
        const x1 = Math.max(...xs) + PAD, y1 = Math.max(...ys) + PAD;
        const newPoints: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        const sec = sectionsRef.current.find(s => s.id === sectionId);
        const notesObj: Record<string, unknown> = { seatRadius };
        if (sec?.edgeCurve) notesObj.edgeCurve = sec.edgeCurve;
        if (sec?.labelOffset) notesObj.labelOffset = sec.labelOffset;
        if (sec?.labelSize) notesObj.labelSize = sec.labelSize;
        if (sec?.capacity !== undefined) notesObj.capacity = sec.capacity;
        if (sec?.hideSeats) notesObj.hideSeats = sec.hideSeats;
        await fetch(`/api/sections/${sectionId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygonPath: pointsToPath(newPoints), notes: JSON.stringify(notesObj) }),
        });
        upd(sectionId, { seats: newSeats, points: newPoints, rows: newRows });
      }
      setShowRows(false);
    } finally { setSaving(false); }
  };

  // ── Create seated section from config + placement point ──────────────
  const createSeatedSection = async (origin: Point) => {
    if (!origin) return;
    const { count, seatsPerRow, spacingX, spacingY, rowLabelType, rowStart, seatOrder, seatStart } = rowCfg;
    setSaving(true);
    try {
      const secNum = sectionsRef.current.filter(s => s.sectionType === "RESERVED").length + 1;
      const secRes = await fetch(`/api/maps/${mapId}/sections`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Section ${secNum}`, label: `S${secNum}`,
          sectionType: "RESERVED",
          polygonPath: pointsToPath([origin, { x: origin.x + 1, y: origin.y }, { x: origin.x + 1, y: origin.y + 1 }, { x: origin.x, y: origin.y + 1 }]),
        }),
      });
      if (!secRes.ok) return;
      const created = await secRes.json();
      const sectionId: string = created.id;
      for (let r = 0; r < count; r++) {
        const rowY = origin.y + r * spacingY;
        const rowLabel = rowLabelType === "letters"
          ? String.fromCharCode(65 + rowStart + r)
          : String(rowStart + r + 1);
        const seats = Array.from({ length: seatsPerRow }, (_, i) => {
          const num = seatOrder === "rtl" ? (seatStart + seatsPerRow - 1 - i) : (seatStart + i);
          return { seatNumber: String(num), x: origin.x + i * spacingX, y: rowY };
        });
        await fetch(`/api/sections/${sectionId}/rows`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: rowLabel, startX: origin.x, startY: rowY, seats }),
        });
      }
      // Re-fetch to get DB-assigned IDs, then update polygon to hug seats
      const map = await fetch(`/api/maps/${mapId}`).then(r => r.json());
      const fresh = map.sections.find((s: { id: string }) => s.id === sectionId);
      if (fresh) {
        type FR = { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string }[] };
        const newSeats: SeatDot[] = fresh.rows.flatMap((row: FR) =>
          row.seats.map((seat: FR["seats"][0]) => ({ id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id }))
        );
        const newRows: RowInfo[] = fresh.rows.map((row: FR) => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 }));
        const newPoints = reshapeToFitSeats(newSeats);
        await fetch(`/api/sections/${sectionId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygonPath: pointsToPath(newPoints), notes: JSON.stringify({ seatRadius }) }),
        });
        setSections(prev => [...prev, {
          id: sectionId, name: `Section ${secNum}`, label: `S${secNum}`,
          sectionType: "RESERVED", points: newPoints, saved: true, edgeCurve: 0,
          seats: newSeats, rows: newRows,
        }]);
        setSelected(sectionId);
        setSeatedPlacement(null);
        setTool("select");
        focusSection(sectionId);
      }
    } finally { setSaving(false); }
  };

  // ── Seat rename + shape ───────────────────────────────────────────────
  const saveSeatRename = async () => {
    if (!editingSeat) return;
    await fetch(`/api/seats/${editingSeat.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatNumber: editingSeat.value, shape: editingSeat.shape }),
    });
    setSections(prev => prev.map(s => ({
      ...s, seats: s.seats?.map(seat =>
        seat.id === editingSeat.id
          ? { ...seat, seatNumber: editingSeat.value, shape: editingSeat.shape }
          : seat
      ),
    })));
    setEditingSeat(null);
  };

  // ── Row rename ────────────────────────────────────────────────────────
  const saveRowRename = async () => {
    if (!editingRow) return;
    const sectionId = focusedSection;
    if (!sectionId) { setEditingRow(null); return; }
    await fetch(`/api/rows/${editingRow.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editingRow.value }),
    });
    setSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s,
      rows: s.rows?.map(r => r.id === editingRow.id ? { ...r, label: editingRow.value } : r),
      seats: s.seats?.map(seat => seat.rowId === editingRow.id ? { ...seat, rowLabel: editingRow.value } : seat),
    }));
    setEditingRow(null);
  };

  // ── Row curve/skew update — syncs s.points live via reshapeToFitSeats ──
  const updRowTransform = (rowId: string, patch: { curve?: number; skew?: number }) => {
    if (!focusedSection) return;
    setSections(prev => prev.map(s => {
      if (s.id !== focusedSection) return s;
      const newRows = s.rows?.map(r => r.id === rowId ? { ...r, ...patch } : r) ?? [];
      const disp = getDisplaySeats(s.seats ?? [], newRows);
      const pts  = disp.length > 0 ? reshapeToFitSeats(disp) : null;
      return { ...s, rows: newRows, ...(pts ? { points: pts } : {}) };
    }));
    // Persist to DB
    fetch(`/api/rows/${rowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const applyGlobalTransform = () => {
    if (!focusedSection) return;
    const sec = sectionsRef.current.find(s => s.id === focusedSection);
    setSections(prev => prev.map(s => {
      if (s.id !== focusedSection) return s;
      const newRows = s.rows?.map(r => ({ ...r, curve: globalCurve, skew: globalSkew })) ?? [];
      const disp = getDisplaySeats(s.seats ?? [], newRows);
      const pts  = disp.length > 0 ? reshapeToFitSeats(disp) : null;
      return { ...s, rows: newRows, ...(pts ? { points: pts } : {}) };
    }));
    // Persist all rows
    for (const row of sec?.rows ?? []) {
      fetch(`/api/rows/${row.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curve: globalCurve, skew: globalSkew }),
      });
    }
  };

  // Bake all row curve/skew into actual seat positions and save to DB
  const bakeRowTransforms = async () => {
    if (!focusedSection) return;
    const section = sectionsRef.current.find(s => s.id === focusedSection);
    if (!section?.seats || !section.rows) return;
    setBaking(true);
    try {
      const displayed = getDisplaySeats(section.seats, section.rows);
      const bakedPoints = reshapeToFitSeats(displayed);
      upd(focusedSection, {
        seats: displayed,
        rows: section.rows.map(r => ({ ...r, curve: 0, skew: 0 })),
        points: bakedPoints,
      });
      for (const seat of displayed) {
        await fetch(`/api/seats/${seat.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: seat.x, y: seat.y }),
        });
      }
      await fetch(`/api/sections/${focusedSection}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygonPath: pointsToPath(bakedPoints) }),
      });
    } finally { setBaking(false); }
  };

  // ── Delete / fill-gaps helpers ────────────────────────────────────────
  const deleteSeat = async (seatId: string, sectionId: string) => {
    await fetch(`/api/seats/${seatId}`, { method: "DELETE" });
    setSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s, seats: s.seats?.filter(seat => seat.id !== seatId),
    }));
    setSelectedSeats(prev => { const n = new Set(prev); n.delete(seatId); return n; });
    setEditingSeat(null);
  };

  const deleteSelectedSeats = async () => {
    if (!focusedSection || selectedSeats.size === 0) return;
    for (const seatId of selectedSeats) {
      await fetch(`/api/seats/${seatId}`, { method: "DELETE" });
    }
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : {
      ...s, seats: s.seats?.filter(seat => !selectedSeats.has(seat.id)),
    }));
    setSelectedSeats(new Set());
  };

  // Fill gaps: redistribute seats evenly within each row (same span, equal spacing)
  const fillGaps = async () => {
    if (!focusedSection) return;
    const section = sectionsRef.current.find(s => s.id === focusedSection);
    if (!section?.seats) return;
    const rowMap = new Map<string, SeatDot[]>();
    for (const seat of section.seats) {
      if (!rowMap.has(seat.rowId)) rowMap.set(seat.rowId, []);
      rowMap.get(seat.rowId)!.push(seat);
    }
    const updates: { id: string; x: number; y: number }[] = [];
    const updatedSeats = section.seats.map(seat => ({ ...seat }));
    for (const [, rowSeats] of rowMap) {
      const sorted = [...rowSeats].sort((a, b) => a.x - b.x);
      if (sorted.length < 2) continue;
      const x0 = sorted[0].x, x1 = sorted[sorted.length - 1].x;
      const avgY = sorted.reduce((s, seat) => s + seat.y, 0) / sorted.length;
      const step = (x1 - x0) / (sorted.length - 1);
      sorted.forEach((seat, i) => {
        const nx = x0 + i * step, ny = avgY;
        updates.push({ id: seat.id, x: nx, y: ny });
        const idx = updatedSeats.findIndex(s => s.id === seat.id);
        if (idx >= 0) { updatedSeats[idx].x = nx; updatedSeats[idx].y = ny; }
      });
    }
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : { ...s, seats: updatedSeats }));
    for (const u of updates) {
      await fetch(`/api/seats/${u.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: u.x, y: u.y }),
      });
    }
  };

  const hasAnyTransform = focSec?.rows?.some(r => r.curve !== 0 || r.skew !== 0) ?? false;

  // ── Persist section field changes to DB ──────────────────────────────
  const saveSectionPatch = (sectionId: string, data: Record<string, unknown>) => {
    fetch(`/api/sections/${sectionId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };

  const saveZoneChange = async (sectionId: string, zoneId: string | undefined) => {
    await fetch(`/api/sections/${sectionId}/zone`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId }),
    });
  };

  const deleteSection = async (sectionId: string, saved: boolean) => {
    if (saved) await fetch(`/api/sections/${sectionId}`, { method: "DELETE" });
    setSections(p => p.filter(s => s.id !== sectionId));
    setSelected(null);
    if (focusedSection === sectionId) setFocused(null);
  };

  const deleteMultiSelected = async () => {
    const ids = [...multiSelected];
    for (const id of ids) {
      const s = sectionsRef.current.find(sec => sec.id === id);
      if (s?.saved) await fetch(`/api/sections/${id}`, { method: "DELETE" });
    }
    setSections(p => p.filter(s => !multiSelected.has(s.id)));
    setMultiSelected(new Set());
    setSelected(null);
  };

  // ── Auto-save pasted sections to DB ──────────────────────────────────
  const savePastedSections = async (newSecs: DraftSection[]) => {
    const idMap = new Map<string, string>(); // tempId -> realId
    for (const s of newSecs) {
      try {
        if (s.sectionType === "TABLE" && s.tableMeta) {
          const meta = s.tableMeta;
          const res = await fetch(`/api/maps/${mapId}/sections`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: s.name, label: s.label, sectionType: "TABLE", polygonPath: pointsToPath(s.points), notes: JSON.stringify(meta) }),
          });
          const savedSec = await res.json();
          const realId: string = savedSec.id;
          idMap.set(s.id, realId);
          const bbox = polyBBox(s.points);
          const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
          const chairPts = (s.seats && s.seats.length > 0) ? s.seats : computeChairPositions(meta, cx, cy);
          const rowRes = await fetch(`/api/sections/${realId}/rows`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: "chairs", startX: cx, startY: cy,
              seats: chairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
            }),
          });
          const savedRow = await rowRes.json();
          upd(s.id, {
            id: realId, saved: true,
            rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
            seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
              id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: "chairs", rowId: savedRow.id,
            })),
          });
        } else {
          // Build notes body same way as saveSection
          const body: Record<string, unknown> = {
            name: s.name, label: s.label, sectionType: s.sectionType,
            polygonPath: pointsToPath(s.points),
          };
          if (s.sectionType === "DOOR" && s.doorMeta) {
            const n: Record<string, unknown> = { w: s.doorMeta.w, h: s.doorMeta.h, angle: s.doorMeta.angle };
            if (s.showLabel === false) n.showLabel = false;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            body.notes = JSON.stringify(n);
          } else if (s.sectionType === "STAIRS" && s.stairsMeta) {
            const n: Record<string, unknown> = { w: s.stairsMeta.w, h: s.stairsMeta.h, angle: s.stairsMeta.angle };
            if (s.showLabel === false) n.showLabel = false;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            body.notes = JSON.stringify(n);
          } else if (s.sectionType === "TEXT") {
            const n: Record<string, unknown> = {};
            if (s.textColor) n.textColor = s.textColor;
            if (s.textBold) n.textBold = s.textBold;
            if (s.textAngle) n.textAngle = s.textAngle;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          } else if (s.sectionType !== "WALL" && isVenueObject(s.sectionType)) {
            const n: Record<string, unknown> = {};
            if (s.iconOffset) n.iconOffset = s.iconOffset;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.iconSize) n.iconSize = s.iconSize;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.showIcon === false) n.showIcon = false;
            if (s.showLabel === false) n.showLabel = false;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          } else {
            const n: Record<string, unknown> = {};
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.edgeCurve) n.edgeCurve = s.edgeCurve;
            if (s.capacity !== undefined) n.capacity = s.capacity;
            if (s.maxPerOrder !== undefined) n.maxPerOrder = s.maxPerOrder;
            if (s.hideSeats) n.hideSeats = s.hideSeats;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          }
          const res = await fetch(`/api/maps/${mapId}/sections`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const saved = await res.json();
          const realId: string = saved.id;
          idMap.set(s.id, realId);
          upd(s.id, { saved: true, id: realId });
          if (s.zoneId) {
            await fetch(`/api/sections/${realId}/zone`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ zoneId: s.zoneId }),
            });
          }
          // Save rows/seats if any
          if (s.rows && s.seats && s.rows.length > 0) {
            const rowMap = new Map<string, SeatDot[]>();
            for (const seat of s.seats) {
              if (!rowMap.has(seat.rowId)) rowMap.set(seat.rowId, []);
              rowMap.get(seat.rowId)!.push(seat);
            }
            const finalRows: RowInfo[] = [];
            const finalSeats: SeatDot[] = [];
            for (const row of s.rows) {
              const rSeats = rowMap.get(row.id) ?? [];
              const rRes = await fetch(`/api/sections/${realId}/rows`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  label: row.label,
                  startX: rSeats[0]?.x ?? 0, startY: rSeats[0]?.y ?? 0,
                  seats: rSeats.map(seat => ({ seatNumber: seat.seatNumber, x: seat.x, y: seat.y })),
                }),
              });
              const savedRow = await rRes.json();
              finalRows.push({ id: savedRow.id, label: savedRow.label, curve: row.curve, skew: row.skew });
              savedRow.seats.forEach((seat: { id: string; x: number; y: number; seatNumber: string }, i: number) => {
                finalSeats.push({
                  id: seat.id, x: seat.x, y: seat.y,
                  seatNumber: seat.seatNumber, rowLabel: savedRow.label, rowId: savedRow.id,
                  shape: rSeats[i]?.shape,
                });
              });
            }
            setSections(prev => prev.map(sec => sec.id === realId ? { ...sec, rows: finalRows, seats: finalSeats } : sec));
          }
        }
      } catch (e) {
        console.error("Failed to save pasted section", e);
      }
    }
    // Update multiSelected and selected to use real IDs
    if (idMap.size > 0) {
      setMultiSelected(prev => {
        const next = new Set<string>();
        for (const id of prev) next.add(idMap.get(id) ?? id);
        return next;
      });
      setSelected(prev => prev ? (idMap.get(prev) ?? prev) : prev);
    }
  };

  // ── Save new table to DB ─────────────────────────────────────────────
  const saveTable = async (s: DraftSection) => {
    if (!s.tableMeta) return;
    setSaving(true);
    try {
      const meta = s.tableMeta;
      const bbox = polyBBox(s.points);
      const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
      const res = await fetch(`/api/maps/${mapId}/sections`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name, label: s.label, sectionType: "TABLE",
          polygonPath: pointsToPath(s.points), notes: JSON.stringify(meta),
        }),
      });
      const saved = await res.json();
      const chairPts = computeChairPositions(meta, cx, cy);
      const rowRes = await fetch(`/api/sections/${saved.id}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "chairs", startX: cx, startY: cy,
          seats: chairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
        }),
      });
      const savedRow = await rowRes.json();
      if (s.zoneId) await fetch(`/api/sections/${saved.id}/zone`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: s.zoneId }),
      });
      upd(s.id, {
        id: saved.id, saved: true,
        rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
        seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
          id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
          rowLabel: "chairs", rowId: savedRow.id,
        })),
      });
    } finally { setSaving(false); }
  };

  // ── Update table meta (shape/size/chairs) ────────────────────────────
  const updateTableMeta = async (sectionId: string, patch: Partial<TableMeta>) => {
    const s = sectionsRef.current.find(sec => sec.id === sectionId);
    if (!s?.tableMeta) return;
    const newMeta = { ...s.tableMeta, ...patch };
    const bbox = polyBBox(s.points);
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    const newPts = tableBoundingPoints(newMeta, cx, cy);
    const newChairPts = computeChairPositions(newMeta, cx, cy);
    upd(sectionId, { tableMeta: newMeta, points: newPts });
    if (!s.saved) return;
    await fetch(`/api/sections/${sectionId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygonPath: pointsToPath(newPts), notes: JSON.stringify(newMeta) }),
    });
    const oldCount = s.seats?.length ?? 0;
    if (oldCount !== newChairPts.length && s.rows?.[0]) {
      const rowId = s.rows[0].id;
      await fetch(`/api/rows/${rowId}`, { method: "DELETE" });
      const rowRes = await fetch(`/api/sections/${sectionId}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "chairs", startX: cx, startY: cy,
          seats: newChairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
        }),
      });
      const savedRow = await rowRes.json();
      upd(sectionId, {
        rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
        seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
          id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
          rowLabel: "chairs", rowId: savedRow.id,
        })),
      });
    } else {
      const seats = s.seats ?? [];
      upd(sectionId, {
        seats: seats.map((seat, i) => i < newChairPts.length ? { ...seat, x: newChairPts[i].x, y: newChairPts[i].y } : seat),
      });
      for (let i = 0; i < Math.min(seats.length, newChairPts.length); i++) {
        await fetch(`/api/seats/${seats[i].id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: newChairPts[i].x, y: newChairPts[i].y }),
        });
      }
    }
  };

  // ── Row rename from sidebar blur ──────────────────────────────────────


  // ── Add zone ──────────────────────────────────────────────────────────
  const addZone = async () => {
    if (!newZone.name) return;
    const zone = await fetch(`/api/maps/${mapId}/zones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newZone),
    }).then(r => r.json());
    setZones(p => [...p, zone]);
    setNewZone({ name: "", color: "#7F77DD" });
  };

  const deleteZone = async (zoneId: string) => {
    await fetch(`/api/zones/${zoneId}`, { method: "DELETE" });
    setZones(p => p.filter(z => z.id !== zoneId));
    // Clear section-level zone references
    setSections(p => p.map(s => s.zoneId === zoneId ? { ...s, zoneId: undefined } : s));
  };

  // ── Per-seat zone assignment (focused seated sections) ─────────────────
  const applyZoneToSelectedSeats = async (zoneId: string | null) => {
    if (!focusedSection || selectedSeats.size === 0) return;
    const ids = Array.from(selectedSeats);
    await fetch(`/api/maps/${mapId}/seats/batch-zone`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds: ids, zoneId }),
    });
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : {
      ...s, seats: s.seats?.map(seat =>
        selectedSeats.has(seat.id) ? { ...seat, zoneId: zoneId ?? undefined } : seat
      ),
    }));
  };

  // ── Map holds ─────────────────────────────────────────────────────────
  const addHold = async () => {
    if (!newHold.name) return;
    const hold = await fetch(`/api/maps/${mapId}/holds`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newHold),
    }).then(r => r.json());
    setHolds(p => [...p, hold]);
    setNewHold({ name: "", color: "#cc4444" });
  };
  const deleteHold = async (holdId: string) => {
    await fetch(`/api/holds/${holdId}`, { method: "DELETE" });
    setHolds(p => p.filter(h => h.id !== holdId));
    if (activeHoldId === holdId) setActiveHoldId(null);
  };
  const assignSeatsToHold = async (holdId: string, seatIds: string[]) => {
    const hold = await fetch(`/api/holds/${holdId}/seats`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds }),
    }).then(r => r.json());
    if (hold.ok) {
      setHolds(p => p.map(h => h.id === holdId ? { ...h, seats: seatIds.map(id => ({ seatId: id })) } : h));
    }
  };
  // seatId → hold lookup (for visual rendering)
  const seatHoldMap = new Map<string, MapHold>();
  for (const hold of holds) for (const { seatId } of hold.seats) seatHoldMap.set(seatId, hold);

  // ── Styles ────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = {
    width: "100%", padding: "5px 8px", borderRadius: 6, fontSize: 13,
    border: "1px solid #444", background: "#1a1a1a", color: "#fff", boxSizing: "border-box",
  };
  const pbtn: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "none", background: "#534AB7", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 };
  const sbtn: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #444", background: "transparent", color: "#ccc", cursor: "pointer", fontSize: 13 };
  const dbtn: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "none", background: "#3d1a1a", color: "#f09595", cursor: "pointer", fontSize: 13 };
  const zbtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 6, border: "1px solid #444", background: "#1a1a1a", color: "#ccc", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };

  // ── PSD import handlers ────────────────────────────────────────────────
  const dxfFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, endpoint: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const fileLabel = endpoint === "analyze-psd" ? "PSD" : endpoint === "analyze-dxf" ? "DXF/DWG" : "Image";
    const previewUrl = endpoint === "analyze-image" ? URL.createObjectURL(file) : undefined;
    setImportElapsed(0);
    setImportModal({ stage: "uploading", sections: [], warnings: [], error: null, fileLabel, previewUrl });
    importTimerRef.current = setInterval(() => setImportElapsed(s => s + 1), 1000);
    const stopTimer = () => { if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; } };
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/maps/${mapId}/${endpoint}`, { method: "POST", body: formData });
      stopTimer();
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Analysis failed" }));
        setImportModal(m => m ? { ...m, stage: "preview", error: body.error ?? "Analysis failed" } : null);
        return;
      }
      const data = await res.json() as { sections: Omit<ImportPreviewSection, "include">[]; warnings: string[] };
      setImportModal({
        stage: "preview",
        sections: data.sections.map(s => ({ ...s, include: true })),
        warnings: data.warnings,
        error: null,
        fileLabel,
        previewUrl,
      });
    } catch {
      stopTimer();
      setImportModal(m => m ? { ...m, stage: "preview", error: "Network error" } : null);
    }
  };

  const handleImportConfirm = async () => {
    if (!importModal) return;
    const toImport = importModal.sections.filter(s => s.include);
    if (toImport.length === 0) { setImportModal(null); return; }
    setImportModal(m => m ? { ...m, stage: "saving" } : null);
    try {
      const res = await fetch(`/api/maps/${mapId}/import-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: toImport }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setImportModal(m => m ? { ...m, stage: "preview", error: body.error ?? "Save failed" } : null);
        return;
      }
      // Reload map from server — reuse the same deserialization as the initial load useEffect
      const mapRes = await fetch(`/api/maps/${mapId}`);
      if (mapRes.ok) {
        const fresh = await mapRes.json() as {
          sections: { id: string; name: string; label: string; sectionType: DraftSection["sectionType"]; polygonPath: string; notes?: string | null; zoneMappings: { zoneId: string }[]; rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string; notes?: string | null }[] }[] }[];
          pricingZones: Zone[];
          mapHolds?: MapHold[];
        };
        setSections(fresh.sections.map(s => {
          let tableMeta: TableMeta | undefined;
          let doorMeta: DoorMeta | undefined;
          let stairsMeta: DoorMeta | undefined;
          if (s.sectionType === "TABLE" && s.notes) {
            try { tableMeta = JSON.parse(s.notes) as TableMeta; } catch {}
          }
          if (s.sectionType === "DOOR" && s.notes) {
            try { doorMeta = JSON.parse(s.notes) as DoorMeta; } catch {}
          }
          if (s.sectionType === "STAIRS" && s.notes) {
            try { stairsMeta = JSON.parse(s.notes) as DoorMeta; } catch {}
          }
          const SHAPES2 = ["circle","square","triangle","chair","wheelchair"];
          const rawSeats = s.rows.flatMap(row => row.seats.map(seat => {
            let shape: SeatShapeType | undefined;
            let seatZoneId: string | undefined;
            if (seat.notes) {
              if (SHAPES2.includes(seat.notes)) { shape = seat.notes as SeatShapeType; }
              else { try { const p = JSON.parse(seat.notes); if (SHAPES2.includes(p.s ?? "")) shape = p.s; if (p.z) seatZoneId = p.z; } catch {} }
            }
            return { id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id, shape, zoneId: seatZoneId };
          }));
          return {
            id: s.id, name: s.name, label: s.label,
            sectionType: s.sectionType,
            zoneId: s.zoneMappings[0]?.zoneId,
            saved: true,
            edgeCurve: 0,
            tableMeta,
            doorMeta,
            stairsMeta,
            rows: s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 })),
            seats: rawSeats,
            points: (() => {
              if (s.sectionType === "TABLE") return pathToPoints(s.polygonPath);
              if (rawSeats.length > 0) { const fitted = reshapeToFitSeats(rawSeats); if (fitted.length > 0) return fitted; }
              return pathToPoints(s.polygonPath);
            })(),
          };
        }));
      }
      if (importModal?.previewUrl) URL.revokeObjectURL(importModal.previewUrl);
      setImportModal(null);
    } catch {
      setImportModal(m => m ? { ...m, stage: "preview", error: "Network error" } : null);
    }
  };

  const canvasCursor = (seatDragState.current || sectionDragState.current) ? "grabbing" : (tool === "polygon" || tool === "table" || tool === "object" || tool === "text") ? "crosshair" : "grab";

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#111", color: "#fff" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside style={{ width: 272, flexShrink: 0, borderRight: "1px solid #333", background: "#1a1a1a", overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #333", flexShrink: 0 }}>
          {(["editor", "holds"] as const).map(tab => (
            <button key={tab} onClick={() => setSidebarTab(tab)}
              style={{ flex: 1, padding: "10px 0", border: "none", borderBottom: sidebarTab === tab ? "2px solid #534AB7" : "2px solid transparent", background: "transparent", color: sidebarTab === tab ? "#a09ce8" : "#666", fontSize: 13, fontWeight: sidebarTab === tab ? 600 : 400, cursor: "pointer", textTransform: "capitalize" }}>
              {tab === "holds" ? `Holds${holds.length ? ` (${holds.length})` : ""}` : "Editor"}
            </button>
          ))}
        </div>

        {/* Focus mode banner — visible on both tabs */}
        {focusedSection && focSec && (
          <div style={{ padding: "10px 16px", background: "#2d2a5e", borderBottom: "1px solid #534AB7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#a09ce8" }}>✏ {focSec.name}</span>
            <button onClick={exitFocus} style={{ ...sbtn, padding: "3px 8px", fontSize: 12, borderColor: "#534AB7", color: "#a09ce8" }}>✕ Exit</button>
          </div>
        )}

        {sidebarTab === "editor" && <>

        {/* Seat style (focus mode) */}
        {focusedSection && focSec && (focSec.seats?.length ?? 0) > 0 && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Seat style</div>
            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                <span>Size</span><span style={{ color: "#aaa" }}>{seatRadius * 2}px</span>
              </div>
              <input type="range" min={3} max={14} value={seatRadius}
                onChange={e => setSeatRadius(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#534AB7" }} />
            </label>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Shape</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {(["circle", "square", "triangle", "chair", "wheelchair"] as SeatShapeType[]).map(sh => (
                <button key={sh} onClick={() => setSeatShape(sh)} style={{
                  padding: "5px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${seatShape === sh ? "#534AB7" : "#444"}`,
                  background: seatShape === sh ? "#2d2a5e" : "transparent",
                  color: seatShape === sh ? "#a09ce8" : "#ccc",
                }}>{sh.charAt(0).toUpperCase() + sh.slice(1)}</button>
              ))}
            </div>
            {selectedSeats.size > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#7F77DD" }}>{selectedSeats.size} selected</span>
                  <button onClick={() => setSelectedSeats(new Set())} style={{ ...sbtn, padding: "2px 8px", fontSize: 11 }}>Clear</button>
                </div>
                <button onClick={deleteSelectedSeats} style={{ ...dbtn, width: "100%", fontSize: 12, padding: "4px 0" }}>
                  Delete selected
                </button>
              </div>
            )}
            <button onClick={fillGaps} style={{ ...sbtn, width: "100%", marginTop: 6, fontSize: 12, padding: "4px 0", textAlign: "center" }}>
              Fill gaps (re-space rows)
            </button>
            {/* Per-seat zone assignment */}
            {zones.length > 0 && (
              <div style={{ marginTop: 10, borderTop: "1px solid #2a2a2a", paddingTop: 10 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Assign zone to seats</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {zones.map(z => (
                    <button key={z.id} onClick={() => applyZoneToSelectedSeats(z.id)}
                      disabled={selectedSeats.size === 0}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: selectedSeats.size > 0 ? "pointer" : "default", border: `1px solid ${z.color}44`, background: selectedSeats.size > 0 ? z.color + "22" : "#111", color: selectedSeats.size > 0 ? z.color : "#444" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: z.color, flexShrink: 0 }} />
                      {z.name}
                    </button>
                  ))}
                  <button onClick={() => applyZoneToSelectedSeats(null)}
                    disabled={selectedSeats.size === 0}
                    style={{ padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: selectedSeats.size > 0 ? "pointer" : "default", border: "1px solid #333", background: "transparent", color: selectedSeats.size > 0 ? "#888" : "#444" }}>
                    Clear
                  </button>
                </div>
                {selectedSeats.size === 0 && (
                  <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Select seats on canvas first</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Global curve/skew — apply to all rows at once (focus mode) */}
        {focusedSection && focSec && (focSec.rows?.length ?? 0) > 0 && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #333" }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>Apply to all rows</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: "#666" }}>
                Curve
                <input type="number" value={globalCurve}
                  onChange={e => setGlobalCurve(Number(e.target.value))}
                  style={{ ...inp, padding: "3px 6px", fontSize: 11, marginTop: 3 }} />
              </label>
              <label style={{ fontSize: 11, color: "#666" }}>
                Skew
                <input type="number" value={globalSkew}
                  onChange={e => setGlobalSkew(Number(e.target.value))}
                  style={{ ...inp, padding: "3px 6px", fontSize: 11, marginTop: 3 }} />
              </label>
            </div>
            <button onClick={applyGlobalTransform} style={{ ...sbtn, width: "100%", fontSize: 11, padding: "4px 0", textAlign: "center" }}>
              Apply to all rows
            </button>
          </div>
        )}

        {/* Bake transforms button (focus mode, only when transforms exist) */}
        {focusedSection && focSec && (focSec.rows?.length ?? 0) > 0 && hasAnyTransform && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #333" }}>
            <button onClick={bakeRowTransforms} disabled={bakingTransforms} style={{ ...pbtn, width: "100%", fontSize: 12 }}>
              {bakingTransforms ? "Saving…" : "Bake transforms → save positions"}
            </button>
          </div>
        )}

        {/* Multi-selection status bar */}
        {multiSelected.size > 1 && !focusedSection && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #333", background: "#1e1a3a", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#a09ce8", fontWeight: 500 }}>{multiSelected.size} selected</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setMultiSelected(new Set()); setSelected(null); }}
                style={{ ...sbtn, padding: "3px 10px", fontSize: 11 }}>Deselect</button>
              <button onClick={deleteMultiSelected}
                style={{ ...dbtn, padding: "3px 10px", fontSize: 11 }}>Delete all</button>
            </div>
          </div>
        )}

        {/* Tools (hidden in focus mode) */}
        {!focusedSection && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Tools</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([["select","Select"],["table","Table"],["object","Object"],["text","Text"]] as [Tool,string][]).map(([t, label]) => (
                <button key={t} onClick={() => { setTool(t); setDrawing([]); setTableDraft(null); setSeatedPlacement(null); }} style={{
                  flex: 1, minWidth: 55, padding: "6px 4px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid",
                  borderColor: tool === t ? "#534AB7" : "#444",
                  background: tool === t ? "#2d2a5e" : "transparent",
                  color: tool === t ? "#a09ce8" : "#ccc",
                  fontWeight: tool === t ? 500 : 400,
                }}>{label}</button>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              {([["polygon","GA Section"],["seated","Seated"]] as [Tool,string][]).map(([t, label]) => (
                <button key={t} onClick={() => { setTool(t); setDrawing([]); setTableDraft(null); setSeatedPlacement(null); }} style={{
                  flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid",
                  borderColor: tool === t ? "#27AE60" : "#444",
                  background: tool === t ? "#1a3d28" : "transparent",
                  color: tool === t ? "#5dbb80" : "#ccc",
                  fontWeight: tool === t ? 500 : 400,
                }}>{label}</button>
              ))}
            </div>
            {(tool === "polygon" || tool === "object") && drawing.length === 0 && (
              <p style={{ fontSize: 11, color: "#666", marginTop: 8, marginBottom: 0 }}>Click canvas to place points. Click near start to close.</p>
            )}
            {tool === "seated" && !seatedPlacement && (
              <p style={{ fontSize: 11, color: "#666", marginTop: 8, marginBottom: 0 }}>Configure rows below, then click canvas to place.</p>
            )}
            {tool === "table" && (
              <p style={{ fontSize: 11, color: "#666", marginTop: 8, marginBottom: 0 }}>Click-drag on canvas to size and place a table.</p>
            )}
            {tool === "text" && (
              <p style={{ fontSize: 11, color: "#666", marginTop: 8, marginBottom: 0 }}>Click canvas to place a text label.</p>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
                Import PSD
              </button>
              <button
                onClick={() => dxfFileInputRef.current?.click()}
                style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
                Import DXF/DWG
              </button>
              <button
                onClick={() => imageFileInputRef.current?.click()}
                style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
                Import Image
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".psd"
              style={{ display: "none" }}
              onChange={e => handleFileImport(e, "analyze-psd")}
            />
            <input
              ref={dxfFileInputRef}
              type="file"
              accept=".dxf,.dwg"
              style={{ display: "none" }}
              onChange={e => handleFileImport(e, "analyze-dxf")}
            />
            <input
              ref={imageFileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              style={{ display: "none" }}
              onChange={e => handleFileImport(e, "analyze-image")}
            />
          </div>
        )}

        {/* Object type picker (shown when object tool is active) */}
        {!focusedSection && tool === "object" && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Object type</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {VENUE_OBJECT_TYPES.map(t => {
                const cfg = VENUE_OBJECT_CFG[t];
                const active = objectType === t;
                return (
                  <button key={t} onClick={() => setObjectType(t)} style={{
                    padding: "7px 4px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid",
                    borderColor: active ? cfg.color : "#444",
                    background: active ? cfg.color + "30" : "transparent",
                    color: active ? cfg.color : "#aaa",
                    fontWeight: active ? 600 : 400,
                  }}>{cfg.label}</button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "#666", marginTop: 10, marginBottom: 0 }}>
              Drawing: <span style={{ color: VENUE_OBJECT_CFG[objectType].color, fontWeight: 500 }}>{VENUE_OBJECT_CFG[objectType].label}</span>
            </p>
          </div>
        )}

        {/* Seated section row config (shown when seated tool is active) */}
        {!focusedSection && tool === "seated" && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#5dbb80" }}>Seated section config</div>
            {([
              ["count","Rows"],["seatsPerRow","Seats per row"],
              ["spacingX","Seat spacing"],["spacingY","Row spacing"],
              ["rowStart","Row start offset"],["seatStart","Seat start number"],
            ] as [keyof typeof rowCfg, string][]).map(([k, label]) => (
              <label key={k} style={{ display: "block", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 2 }}>{label}</span>
                <input type="number" value={rowCfg[k] as number}
                  onChange={e => setRowCfg(p => ({ ...p, [k]: Number(e.target.value) }))} style={inp} />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 2 }}>Row labels</span>
              <select value={rowCfg.rowLabelType}
                onChange={e => setRowCfg(p => ({ ...p, rowLabelType: e.target.value as "letters" | "numbers" }))} style={inp}>
                <option value="letters">A, B, C…</option>
                <option value="numbers">1, 2, 3…</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 2 }}>Seat order</span>
              <select value={rowCfg.seatOrder}
                onChange={e => setRowCfg(p => ({ ...p, seatOrder: e.target.value as "ltr" | "rtl" }))} style={inp}>
                <option value="ltr">Left → Right</option>
                <option value="rtl">Right → Left</option>
              </select>
            </label>
            {seatedPlacement ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => createSeatedSection(seatedPlacement)} disabled={saving}
                  style={{ ...pbtn, flex: 1 }}>{saving ? "Creating…" : "Create"}</button>
                <button onClick={() => setSeatedPlacement(null)} style={sbtn}>Cancel</button>
              </div>
            ) : (
              <p style={{ fontSize: 11, color: "#666", margin: 0 }}>Click on canvas to place →</p>
            )}
          </div>
        )}

        {/* Table config (shown when table tool is active) */}
        {!focusedSection && tool === "table" && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Table preset</div>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Shape</span>
              <select value={tableCfg.shape} onChange={e => setTableCfg(p => ({ ...p, shape: e.target.value as TableShape }))} style={inp}>
                {(["rectangle","round","square","oval","booth"] as TableShape[]).map(sh => (
                  <option key={sh} value={sh}>{sh.charAt(0).toUpperCase() + sh.slice(1)}</option>
                ))}
              </select>
            </label>
            {(tableCfg.shape === "round" || tableCfg.shape === "oval") ? (
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Total chairs</span>
                <input type="number" value={tableCfg.cpl} min={0} max={20}
                  onChange={e => setTableCfg(p => ({ ...p, cpl: Number(e.target.value) }))} style={inp} />
              </label>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/long</span>
                  <input type="number" value={tableCfg.cpl} min={0} max={12}
                    onChange={e => setTableCfg(p => ({ ...p, cpl: Number(e.target.value) }))} style={inp} />
                </label>
                {tableCfg.shape !== "booth" && (
                  <label>
                    <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/short</span>
                    <input type="number" value={tableCfg.cps} min={0} max={6}
                      onChange={e => setTableCfg(p => ({ ...p, cps: Number(e.target.value) }))} style={inp} />
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        {/* Table inspector (selected TABLE section, not in focus mode) */}
        {sel && !focusedSection && sel.sectionType === "TABLE" && sel.tableMeta && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#a09ce8" }}>Table</div>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Name</span>
              <input value={sel.name} style={inp}
                onChange={e => upd(sel.id, { name: e.target.value })}
                onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { name: e.target.value }); }} />
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Label</span>
              <input value={sel.label} style={inp}
                onChange={e => upd(sel.id, { label: e.target.value })}
                onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { label: e.target.value }); }} />
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Shape</span>
              <select value={sel.tableMeta.shape} style={inp}
                onChange={e => updateTableMeta(sel.id, { shape: e.target.value as TableShape })}>
                {(["rectangle","round","square","oval","booth"] as TableShape[]).map(sh => (
                  <option key={sh} value={sh}>{sh.charAt(0).toUpperCase() + sh.slice(1)}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <label>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Width</span>
                <input type="number" value={sel.tableMeta.w} min={40} max={500} style={inp}
                  onChange={e => updateTableMeta(sel.id, { w: Number(e.target.value) })} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Height</span>
                <input type="number" value={sel.tableMeta.h} min={30} max={400} style={inp}
                  onChange={e => updateTableMeta(sel.id, { h: Number(e.target.value) })} />
              </label>
            </div>
            {(sel.tableMeta.shape === "round" || sel.tableMeta.shape === "oval") ? (
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Total chairs</span>
                <input type="number" value={sel.tableMeta.cpl} min={0} max={24} style={inp}
                  onChange={e => updateTableMeta(sel.id, { cpl: Number(e.target.value) })} />
              </label>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/long</span>
                  <input type="number" value={sel.tableMeta.cpl} min={0} max={12} style={inp}
                    onChange={e => updateTableMeta(sel.id, { cpl: Number(e.target.value) })} />
                </label>
                {sel.tableMeta.shape !== "booth" && (
                  <label>
                    <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/short</span>
                    <input type="number" value={sel.tableMeta.cps} min={0} max={6} style={inp}
                      onChange={e => updateTableMeta(sel.id, { cps: Number(e.target.value) })} />
                  </label>
                )}
              </div>
            )}
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Zone</span>
              <select value={sel.zoneId ?? ""} style={inp}
                onChange={e => { const zoneId = e.target.value || undefined; upd(sel.id, { zoneId }); if (sel.saved) saveZoneChange(sel.id, zoneId); }}>
                <option value="">None</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Seat selection (in map view)</span>
              <select value={sel.tableMeta.selectMode ?? "seat"} style={inp}
                onChange={e => updateTableMeta(sel.id, { selectMode: e.target.value as "whole" | "seat" })}>
                <option value="seat">Seat by seat</option>
                <option value="whole">Whole table at once</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {!sel.saved && <button onClick={() => saveTable(sel)} disabled={saving} style={pbtn}>{saving ? "Saving…" : "Save"}</button>}
              <button onClick={() => deleteSection(sel.id, sel.saved)} style={dbtn}>Delete</button>
            </div>
          </div>
        )}

        {/* TEXT inspector — full controls in sidebar */}
        {sel && !focusedSection && sel.sectionType === "TEXT" && (() => {
          const saveTextPatch = (updates: Partial<DraftSection>) => {
            const updated = { ...sel, ...updates };
            upd(sel.id, updates);
            if (sel.saved) {
              const n: Record<string, unknown> = {};
              if (updated.textColor) n.textColor = updated.textColor;
              if (updated.textBold) n.textBold = updated.textBold;
              if (updated.textAngle !== undefined) n.textAngle = updated.textAngle;
              if (updated.labelSize) n.labelSize = updated.labelSize;
              if (updated.labelOffset) n.labelOffset = updated.labelOffset;
              saveSectionPatch(sel.id, { name: updated.name, label: updated.name, notes: JSON.stringify(n) });
            }
          };
          return (
            <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
              <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Text</div>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Content</span>
                <input value={sel.name} style={inp}
                  onChange={e => saveTextPatch({ name: e.target.value, label: e.target.value })}
                  placeholder="Text content" />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Size</span>
                  <input type="number" min={6} max={200} value={sel.labelSize ?? 18} style={inp}
                    onChange={e => saveTextPatch({ labelSize: Number(e.target.value) })} />
                </label>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Angle°</span>
                  <input type="number" min={-180} max={180} value={sel.textAngle ?? 0} style={inp}
                    onChange={e => saveTextPatch({ textAngle: Number(e.target.value) })} />
                </label>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
                  <span>Color</span>
                  <input type="color" value={sel.textColor ?? "#ffffff"}
                    style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer", padding: 0 }}
                    onChange={e => saveTextPatch({ textColor: e.target.value })} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
                  <input type="checkbox" checked={sel.textBold ?? false}
                    onChange={e => saveTextPatch({ textBold: e.target.checked })} />
                  <span>Bold</span>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => saveSection(sel)} disabled={saving} style={pbtn}>{saving ? "Saving…" : sel.saved ? "✓ Saved" : "Save"}</button>
                <button onClick={() => deleteSection(sel.id, sel.saved)} style={dbtn}>Delete</button>
              </div>
            </div>
          );
        })()}

        {/* Object inspector (venue objects: stage, bar, bathroom, etc.) */}
        {sel && !focusedSection && isVenueObject(sel.sectionType) && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Venue object</div>
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Name</span>
              <input value={sel.name} style={inp}
                onChange={e => upd(sel.id, { name: e.target.value, label: e.target.value })}
                onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { name: e.target.value, label: e.target.value }); }} />
            </label>
            {/* Icon picker — hidden for WALL (it's a line), DOOR (fixed SVG shape), STAIRS */}
            {sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 6 }}>Icon</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
                  {VENUE_OBJECT_TYPES.filter(t => t !== "WALL" && t !== "DOOR" && t !== "STAIRS").map(t => {
                    const cfg = VENUE_OBJECT_CFG[t];
                    const active = sel.sectionType === t;
                    return (
                      <button key={t} title={cfg.label} onClick={() => {
                        const sectionType = t as DraftSection["sectionType"];
                        upd(sel.id, { sectionType });
                        if (sel.saved) saveSectionPatch(sel.id, { sectionType });
                      }} style={{
                        padding: "6px 2px 4px", borderRadius: 6, border: "1px solid",
                        borderColor: active ? cfg.color : "#333",
                        background: active ? cfg.color + "25" : "transparent",
                        cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                      }}>
                        <svg width="26" height="26" viewBox="-13 -13 26 26" style={{ overflow: "visible" }}>
                          {renderVenueIcon(t, active ? cfg.color : "#666", 11)}
                        </svg>
                        <span style={{ fontSize: 9, color: active ? cfg.color : "#555", lineHeight: 1 }}>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Icon size + label size */}
            {<div style={{ display: "grid", gridTemplateColumns: sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 10 }}>
              {sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" && (() => {
                // Same formula as the map render — polyArea is rotation-invariant, bbox dimensions are not
                const autoSize = Math.round(Math.max(10, Math.sqrt(polyArea(sel.points)) * 0.32));
                const curSize = sel.iconSize ?? autoSize;
                return (
                  <label>
                    <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 3 }}>Icon size</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="range" min={10} max={200} step={5} value={curSize}
                        style={{ flex: 1, accentColor: VENUE_OBJECT_CFG[sel.sectionType as VenueObjectType]?.color ?? "#7F77DD" }}
                        onChange={e => {
                          const v = Number(e.target.value);
                          upd(sel.id, { iconSize: v });
                        }}
                        onMouseUp={e => {
                          const v = Number((e.target as HTMLInputElement).value);
                          if (sel.saved) {
                            const n: Record<string, unknown> = { iconSize: v };
                            if (sel.iconOffset) n.iconOffset = sel.iconOffset;
                            if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                            if (sel.labelSize) n.labelSize = sel.labelSize;
                            if (sel.showIcon === false) n.showIcon = false;
                            if (sel.showLabel === false) n.showLabel = false;
                            saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                          }
                        }} />
                      <span style={{ fontSize: 11, color: "#aaa", minWidth: 24, textAlign: "right" }}>{curSize}</span>
                    </div>
                  </label>
                );
              })()}
              <label>
                <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 3 }}>Label size</span>
                <input type="number" min={6} max={48} step={1}
                  value={sel.labelSize ?? ""}
                  placeholder="auto"
                  style={{ ...inp, width: "100%" }}
                  onChange={e => upd(sel.id, { labelSize: e.target.value ? Number(e.target.value) : undefined })}
                  onBlur={e => {
                    if (!sel.saved) return;
                    const v = e.target.value ? Number(e.target.value) : undefined;
                    const isObjType = sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS";
                    if (sel.sectionType === "DOOR" && sel.doorMeta) {
                      const n: Record<string, unknown> = { w: sel.doorMeta.w, h: sel.doorMeta.h, angle: sel.doorMeta.angle };
                      if (v) n.labelSize = v;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.showLabel === false) n.showLabel = false;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    } else if (sel.sectionType === "STAIRS" && sel.stairsMeta) {
                      const n: Record<string, unknown> = { w: sel.stairsMeta.w, h: sel.stairsMeta.h, angle: sel.stairsMeta.angle };
                      if (v) n.labelSize = v;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.showLabel === false) n.showLabel = false;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    } else if (isObjType) {
                      const n: Record<string, unknown> = {};
                      if (sel.iconOffset) n.iconOffset = sel.iconOffset;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.iconSize) n.iconSize = sel.iconSize;
                      if (v) n.labelSize = v;
                      if (sel.showIcon === false) n.showIcon = false;
                      if (sel.showLabel === false) n.showLabel = false;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    }
                  }} />
              </label>
            </div>}
            {/* Visibility toggles */}
            <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
              {sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" && (
                <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                  <input type="checkbox" checked={sel.showIcon !== false} onChange={e => {
                    upd(sel.id, { showIcon: e.target.checked });
                    if (sel.saved) {
                      const n: Record<string, unknown> = {};
                      if (sel.iconOffset) n.iconOffset = sel.iconOffset;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (!e.target.checked) n.showIcon = false;
                      if (sel.showLabel === false) n.showLabel = false;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    }
                  }} />
                  Show icon
                </label>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: "#aaa" }}>
                <input type="checkbox" checked={sel.showLabel !== false} onChange={e => {
                  upd(sel.id, { showLabel: e.target.checked });
                  if (sel.saved) {
                    if (sel.sectionType === "DOOR" && sel.doorMeta) {
                      const n: Record<string, unknown> = { w: sel.doorMeta.w, h: sel.doorMeta.h, angle: sel.doorMeta.angle };
                      if (!e.target.checked) n.showLabel = false;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.labelSize) n.labelSize = sel.labelSize;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    } else if (sel.sectionType === "STAIRS" && sel.stairsMeta) {
                      const n: Record<string, unknown> = { w: sel.stairsMeta.w, h: sel.stairsMeta.h, angle: sel.stairsMeta.angle };
                      if (!e.target.checked) n.showLabel = false;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.labelSize) n.labelSize = sel.labelSize;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    } else {
                      const n: Record<string, unknown> = {};
                      if (sel.iconOffset) n.iconOffset = sel.iconOffset;
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.showIcon === false) n.showIcon = false;
                      if (!e.target.checked) n.showLabel = false;
                      saveSectionPatch(sel.id, { notes: JSON.stringify(n) });
                    }
                  }
                }} />
                Show name
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => saveSection(sel)} disabled={saving} style={pbtn}>
                {saving ? "Saving…" : sel.saved ? "✓ Saved" : "Save"}
              </button>
              <button onClick={() => deleteSection(sel.id, sel.saved)} style={dbtn}>Delete</button>
            </div>
          </div>
        )}

        {/* Section inspector (hidden in focus mode) */}
        {sel && !focusedSection && sel.sectionType !== "TABLE" && sel.sectionType !== "TEXT" && !isVenueObject(sel.sectionType) && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13, color: "#aaa" }}>Section</div>
            {(["name", "label"] as const).map(k => (
              <label key={k} style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>{k === "name" ? "Name" : "Label"}</span>
                <input value={sel[k]} maxLength={k === "label" ? 6 : undefined}
                  onChange={e => upd(sel.id, { [k]: e.target.value })}
                  onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { [k]: e.target.value }); }}
                  style={inp} />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Label size</span>
              <input type="number" min={6} max={48} step={1}
                value={sel.labelSize ?? ""}
                placeholder="auto"
                style={{ ...inp, width: "100%" }}
                onChange={e => upd(sel.id, { labelSize: e.target.value ? Number(e.target.value) : undefined })}
                onBlur={e => {
                  if (!sel.saved) return;
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  const n: Record<string, unknown> = {};
                  if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                  if (v) n.labelSize = v;
                  saveSectionPatch(sel.id, { notes: Object.keys(n).length ? JSON.stringify(n) : null });
                }} />
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Type</span>
              <select value={sel.sectionType} onChange={e => {
                const sectionType = e.target.value as DraftSection["sectionType"];
                upd(sel.id, { sectionType });
                if (sel.saved) saveSectionPatch(sel.id, { sectionType });
              }} style={inp}>
                <option value="RESERVED">Reserved</option>
                <option value="GA">General admission</option>
                <option value="ACCESSIBLE">Accessible</option>
                <option value="RESTRICTED">Restricted view</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Zone</span>
              <select value={sel.zoneId ?? ""} onChange={e => {
                const zoneId = e.target.value || undefined;
                upd(sel.id, { zoneId });
                if (sel.saved) saveZoneChange(sel.id, zoneId);
              }} style={inp}>
                <option value="">None</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>

            {/* ── Edge curve slider — only for polygon sections without seats ── */}
            {!(sel.rows && sel.rows.length > 0) && <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                <span>Edge curve</span>
                <span style={{ color: sel.edgeCurve === 0 ? "#444" : "#a09ce8" }}>
                  {sel.edgeCurve === 0 ? "off" : sel.edgeCurve > 0 ? `+${sel.edgeCurve}` : sel.edgeCurve}
                </span>
              </div>
              <input type="range" min={-80} max={80} step={1} value={sel.edgeCurve}
                onChange={e => upd(sel.id, { edgeCurve: Number(e.target.value) })}
                onMouseUp={e => {
                  if (!sel.saved) return;
                  const v = Number((e.target as HTMLInputElement).value);
                  const n: Record<string, unknown> = {};
                  if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                  if (sel.labelSize) n.labelSize = sel.labelSize;
                  if (v) n.edgeCurve = v;
                  saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                }}
                style={{ width: "100%", accentColor: "#534AB7" }} />
              {sel.edgeCurve !== 0 && (
                <button onClick={() => {
                  upd(sel.id, { edgeCurve: 0 });
                  if (sel.saved) {
                    const n: Record<string, unknown> = {};
                    if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                    if (sel.labelSize) n.labelSize = sel.labelSize;
                    saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                  }
                }}
                  style={{ ...sbtn, marginTop: 4, padding: "2px 8px", fontSize: 11, width: "100%", textAlign: "center" }}>
                  Reset curve
                </button>
              )}
            </label>}

            {/* Capacity — for GA / no-seat sections only */}
            {!(sel.rows && sel.rows.length > 0) && !isVenueObject(sel.sectionType) && (sel.sectionType as string) !== "TABLE" && (
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Capacity</span>
                <input type="number" min={0} value={sel.capacity ?? ""} placeholder="e.g. 200"
                  onChange={e => upd(sel.id, { capacity: e.target.value === "" ? undefined : Number(e.target.value) })}
                  onBlur={() => { if (sel.saved) {
                    const n: Record<string, unknown> = {};
                    if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                    if (sel.labelSize) n.labelSize = sel.labelSize;
                    if (sel.edgeCurve) n.edgeCurve = sel.edgeCurve;
                    if (sel.capacity !== undefined) n.capacity = sel.capacity;
                    if (sel.maxPerOrder !== undefined) n.maxPerOrder = sel.maxPerOrder;
                    if (sel.hideSeats) n.hideSeats = sel.hideSeats;
                    saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                  }}}
                  style={inp} />
              </label>
            )}

            {/* Max per order — GA sections only */}
            {!(sel.rows && sel.rows.length > 0) && !isVenueObject(sel.sectionType) && (sel.sectionType as string) !== "TABLE" && (
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Max per order</span>
                <input type="number" min={1} value={sel.maxPerOrder ?? ""} placeholder="e.g. 8"
                  onChange={e => upd(sel.id, { maxPerOrder: e.target.value === "" ? undefined : Number(e.target.value) })}
                  onBlur={() => { if (sel.saved) {
                    const n: Record<string, unknown> = {};
                    if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                    if (sel.labelSize) n.labelSize = sel.labelSize;
                    if (sel.edgeCurve) n.edgeCurve = sel.edgeCurve;
                    if (sel.capacity !== undefined) n.capacity = sel.capacity;
                    if (sel.maxPerOrder !== undefined) n.maxPerOrder = sel.maxPerOrder;
                    if (sel.hideSeats) n.hideSeats = sel.hideSeats;
                    saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                  }}}
                  style={inp} />
              </label>
            )}

            {/* Hide seats — seated sections only */}
            {(sel.rows && sel.rows.length > 0) && !isVenueObject(sel.sectionType) && (sel.sectionType as string) !== "TABLE" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={sel.hideSeats ?? false}
                  onChange={e => {
                    const v = e.target.checked;
                    upd(sel.id, { hideSeats: v || undefined });
                    if (sel.saved) {
                      const n: Record<string, unknown> = {};
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.labelSize) n.labelSize = sel.labelSize;
                      if (sel.edgeCurve) n.edgeCurve = sel.edgeCurve;
                      if (sel.capacity !== undefined) n.capacity = sel.capacity;
                      if (sel.maxPerOrder !== undefined) n.maxPerOrder = sel.maxPerOrder;
                      if (v) n.hideSeats = true;
                      saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                    }
                  }} />
                <span style={{ fontSize: 12, color: "#aaa" }}>Hide seats (click section to reveal)</span>
              </label>
            )}

            {/* Seated sections: seat/row summary */}
            {(sel.seats?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 10, padding: "7px 10px", background: "#111", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#666" }}>{sel.seats!.length} seats · {sel.rows?.length ?? 0} rows</span>
                <button onClick={() => focusSection(sel.id)} style={{ ...pbtn, padding: "3px 10px", fontSize: 12 }}>Edit seats</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => saveSection(sel)} disabled={saving} style={pbtn}>
                {saving ? "Saving…" : sel.saved ? "✓ Saved" : "Save"}
              </button>
              <button onClick={() => deleteSection(sel.id, sel.saved)} style={dbtn}>Delete</button>
            </div>
          </div>
        )}

        {/* Row generator */}
        {showRows && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13, color: "#aaa" }}>Row generator</div>
            {([
              ["count","Row count"],["seatsPerRow","Seats per row"],
              ["startX","Start X"],["startY","Start Y"],
              ["spacingX","Spacing X"],["spacingY","Spacing Y"],
              ["rowStart","Row start offset"],["seatStart","Seat start number"],
            ] as [keyof typeof rowCfg, string][]).map(([k, label]) => (
              <label key={k} style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>{label}</span>
                <input type="number" value={rowCfg[k] as number}
                  onChange={e => setRowCfg(p => ({ ...p, [k]: Number(e.target.value) }))} style={inp} />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Row labels</span>
              <select value={rowCfg.rowLabelType}
                onChange={e => setRowCfg(p => ({ ...p, rowLabelType: e.target.value as "letters" | "numbers" }))} style={inp}>
                <option value="letters">A, B, C…</option>
                <option value="numbers">1, 2, 3…</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Seat order</span>
              <select value={rowCfg.seatOrder}
                onChange={e => setRowCfg(p => ({ ...p, seatOrder: e.target.value as "ltr" | "rtl" }))} style={inp}>
                <option value="ltr">Left → Right</option>
                <option value="rtl">Right → Left</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={generateRows} disabled={saving} style={pbtn}>{saving ? "Generating…" : "Generate"}</button>
              <button onClick={() => setShowRows(false)} style={sbtn}>Cancel</button>
            </div>
          </div>
        )}

        {/* Pricing zones */}
        {!focusedSection && (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13, color: "#aaa" }}>Pricing zones</div>
            {zones.map(z => (
              <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: z.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, flex: 1 }}>{z.name}</span>
                <button onClick={() => deleteZone(z.id)} title="Delete zone"
                  style={{ background: "transparent", border: "none", color: "#C04040", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input placeholder="Zone name" value={newZone.name}
                onChange={e => setNewZone(p => ({ ...p, name: e.target.value }))} style={{ ...inp, flex: 1 }} />
              <input type="color" value={newZone.color}
                onChange={e => setNewZone(p => ({ ...p, color: e.target.value }))}
                style={{ width: 34, height: 32, border: "1px solid #444", borderRadius: 6, padding: 2, cursor: "pointer", background: "transparent" }} />
              <button onClick={addZone} style={pbtn}>+</button>
            </div>
          </div>
        )}

        </> /* end sidebarTab === "editor" */}

        {/* ── Holds tab ─────────────────────────────────────────────── */}
        {sidebarTab === "holds" && (
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>Block seats permanently — appear unavailable in seat map. Click seats on canvas to select.</div>

            {/* Hold list — each hold has its own always-visible assign/clear buttons */}
            {holds.length === 0 && (
              <div style={{ fontSize: 12, color: "#444", textAlign: "center", padding: "16px 0" }}>No holds yet</div>
            )}
            {holds.map(h => {
              const isEditing = activeHoldId === h.id;
              const draft = holdEditDraft?.id === h.id ? holdEditDraft : null;
              const hcolor = draft?.color ?? h.color;
              const saveDraft = () => {
                if (!draft) return;
                fetch(`/api/holds/${h.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, color: draft.color }) });
                setHolds(p => p.map(hh => hh.id === h.id ? { ...hh, name: draft.name, color: draft.color } : hh));
                setActiveHoldId(null);
                setHoldEditDraft(null);
              };
              return (
                <div key={h.id} style={{ marginBottom: 12, borderRadius: 6, border: `1px solid ${isEditing ? hcolor : "#2e2e2e"}`, background: isEditing ? hcolor + "10" : "#161616" }}>

                  {/* Info row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: hcolor, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{draft?.name ?? h.name}</span>
                    <span style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>{h.seats.length} seats</span>
                    <button
                      onClick={() => {
                        if (isEditing) { saveDraft(); }
                        else { setActiveHoldId(h.id); setHoldEditDraft({ id: h.id, name: h.name, color: h.color }); }
                      }}
                      style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${hcolor}55`, background: "transparent", color: hcolor, cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
                      Edit
                    </button>
                    <button onClick={() => deleteHold(h.id)}
                      style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #333", background: "transparent", color: "#666", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>✕</button>
                  </div>

                  {/* Name + color edit — inside card, only when editing */}
                  {isEditing && draft && (
                    <div style={{ padding: "6px 10px 10px", borderTop: "1px solid #222", background: "#0d0d0d", display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        value={draft.name}
                        onChange={e => setHoldEditDraft(d => d ? { ...d, name: e.target.value } : d)}
                        onKeyDown={e => { if (e.key === "Enter") saveDraft(); }}
                        style={{ ...inp, flex: 1, fontSize: 12 }}
                      />
                      <input type="color" value={draft.color}
                        onChange={e => setHoldEditDraft(d => d ? { ...d, color: e.target.value } : d)}
                        style={{ width: 30, height: 28, border: "1px solid #444", borderRadius: 4, padding: 2, cursor: "pointer", background: "transparent", flexShrink: 0 }} />
                      <button onClick={saveDraft}
                        style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: hcolor, color: "#fff", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
                        Save
                      </button>
                      <button onClick={() => { setActiveHoldId(null); setHoldEditDraft(null); }}
                        style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #444", background: "transparent", color: "#888", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Assign / clear — always visible */}
                  <div style={{ padding: "0 10px 10px", display: "flex", gap: 5 }}>
                    <button
                      disabled={selectedSeats.size === 0}
                      onClick={() => {
                        const current = new Set(h.seats.map(s => s.seatId));
                        const merged = [...new Set([...current, ...selectedSeats])];
                        assignSeatsToHold(h.id, merged);
                      }}
                      style={{ flex: 1, padding: "5px 0", borderRadius: 5, border: "none", background: selectedSeats.size > 0 ? hcolor : "#2a2a2a", color: selectedSeats.size > 0 ? "#fff" : "#555", cursor: selectedSeats.size > 0 ? "pointer" : "default", fontSize: 12, fontWeight: 500 }}>
                      + Assign{selectedSeats.size > 0 ? ` ${selectedSeats.size}` : ""}
                    </button>
                    <button
                      disabled={selectedSeats.size === 0}
                      onClick={() => setSelectedSeats(new Set())}
                      style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #333", background: "transparent", color: selectedSeats.size > 0 ? "#bbb" : "#444", cursor: selectedSeats.size > 0 ? "pointer" : "default", fontSize: 11 }}>
                      Desel.
                    </button>
                    <button
                      onClick={() => assignSeatsToHold(h.id, [])}
                      style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #333", background: "transparent", color: "#777", cursor: "pointer", fontSize: 11 }}>
                      Clear
                    </button>
                  </div>

                </div>
              );
            })}

            {/* New hold form */}
            <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid #222" }}>
              <input placeholder="New hold name" value={newHold.name}
                onChange={e => setNewHold(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") addHold(); }}
                style={{ ...inp, flex: 1 }} />
              <input type="color" value={newHold.color}
                onChange={e => setNewHold(p => ({ ...p, color: e.target.value }))}
                style={{ width: 34, height: 32, border: "1px solid #444", borderRadius: 6, padding: 2, cursor: "pointer", background: "transparent" }} />
              <button onClick={addHold} style={pbtn}>+</button>
            </div>
          </div>
        )}

      </aside>

      {/* ── Canvas ──────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", cursor: canvasCursor, touchAction: "none", userSelect: "none" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
      >
        <svg
          width="100%" height="100%"
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#2a2a2a" strokeWidth="0.5" />
            </pattern>
          </defs>
          <g style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`, transformOrigin: "0 0" }}>
          {bgImageUrl && <image href={bgImageUrl} x="0" y="0" width={vw} height={vh} opacity={0.35} preserveAspectRatio="xMidYMid meet" />}
          <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid)" />

          {/* Sections — rendered back-to-front: large venue objects first, tables last */}
          {[...sections].sort((a, b) => {
            const order = (t: string) =>
              t === "TABLE" ? 3 :
              t === "RESERVED" || t === "GA" || t === "ACCESSIBLE" || t === "RESTRICTED" ? 2 :
              1; // venue objects (STAGE, BAR, DANCING, etc.) render first (behind everything)
            return order(a.sectionType) - order(b.sectionType);
          }).map(s => {
            const zone = zones.find(z => z.id === s.zoneId);

            // Unique zones present via per-seat assignments
            const _perSeatZoneIds: string[] = [];
            for (const seat of s.seats ?? []) {
              if (seat.zoneId && !_perSeatZoneIds.includes(seat.zoneId)) _perSeatZoneIds.push(seat.zoneId);
            }
            const perSeatZones = _perSeatZoneIds.map(zid => zones.find(z => z.id === zid)).filter((z): z is Zone => z !== undefined);

            // Dominant per-seat zone (most seats assigned to it) — used as polygon color fallback
            const dominantPerSeatZone: Zone | undefined = perSeatZones.length > 0 && !zone
              ? (() => {
                  const counts = new Map<string, number>();
                  for (const seat of s.seats ?? []) {
                    if (seat.zoneId) counts.set(seat.zoneId, (counts.get(seat.zoneId) ?? 0) + 1);
                  }
                  let topId = "", topCount = 0;
                  counts.forEach((cnt, id) => { if (cnt > topCount) { topCount = cnt; topId = id; } });
                  return perSeatZones.find(z => z.id === topId);
                })()
              : undefined;

            const color = isVenueObject(s.sectionType)
              ? VENUE_OBJECT_CFG[s.sectionType as VenueObjectType].color
              : (zone?.color ?? dominantPerSeatZone?.color ?? "#888780");
            const isSel      = s.id === selected && multiSelected.size <= 1;
            const isFocused  = s.id === focusedSection;
            const holdsMode  = sidebarTab === "holds";
            const isDimmed   = !holdsMode && focusedSection !== null && !isFocused;
            const seatCount  = s.seats?.length ?? 0;

            // Compute display seats (with curve/skew offsets applied) — always, not just in focus
            const displaySeats = (s.seats && s.rows)
              ? getDisplaySeats(s.seats, s.rows)
              : s.seats ?? [];

            // Icon/label anchor — must match the rotation pivot used in mouseDown:
            // • Seated sections: arithmetic mean of display seat positions
            // • Everything else (venue objects, GA): vertex centroid — stays fixed when
            //   the polygon is rotated around the centroid.
            const c = displaySeats.length > 0
              ? {
                  x: displaySeats.reduce((sum, seat) => sum + seat.x, 0) / displaySeats.length,
                  y: displaySeats.reduce((sum, seat) => sum + seat.y, 0) / displaySeats.length,
                }
              : centroid(s.points);
            // Sections with seats: boundary was auto-shaped via reshapeToFitSeats (many points).
            // Never apply edgeCurve to it — bezier on many small edges compounds into an arch.
            // Pure polygon sections (no rows): edgeCurve applies normally.
            const focusPath = (s.rows && s.rows.length > 0)
              ? pointsToPath(s.points)
              : curvedPath(s.points, s.edgeCurve);

            // First seat per row (leftmost in display coords) for row labels
            const rowFirstSeats = new Map<string, SeatDot>();
            for (const seat of displaySeats) {
              const cur = rowFirstSeats.get(seat.rowId);
              if (!cur || seat.x < cur.x) rowFirstSeats.set(seat.rowId, seat);
            }

            // WALL — render as a thick line (2 endpoints)
            if (s.sectionType === "WALL") {
              const [p1, p2] = s.points;
              if (!p1 || !p2) return null;
              const wallW = (isSel ? 7 : 5) / transform.scale;
              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={24 / transform.scale} />
                  {isSel && <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={14 / transform.scale} strokeLinecap="round" opacity={0.18} style={{ pointerEvents: "none" }} />}
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth={wallW} strokeLinecap="round"
                    strokeDasharray={s.saved ? "none" : `${6 / transform.scale} ${3 / transform.scale}`}
                    style={{ pointerEvents: "none" }} />
                  {isSel && s.points.map((pt, i) => (
                    <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                      <circle cx={pt.x} cy={pt.y} r={14 / transform.scale} fill="transparent" />
                      <circle cx={pt.x} cy={pt.y} r={5 / transform.scale} fill="#fff" stroke={color} strokeWidth={1.5 / transform.scale} style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                  {!s.saved && <text x={(p1.x+p2.x)/2} y={(p1.y+p2.y)/2 - 12/transform.scale} textAnchor="middle" fontSize={10/transform.scale} fill={color+"88"} style={{ pointerEvents:"none", userSelect:"none" }}>unsaved</text>}
                </g>
              );
            }

            // DOOR — render door SVG shape with 4 corner handles + rotation
            if (s.sectionType === "DOOR" && s.doorMeta) {
              const { w, h, angle } = s.doorMeta;
              const dcx = s.points.reduce((sum, p) => sum + p.x, 0) / 4;
              const dcy = s.points.reduce((sum, p) => sum + p.y, 0) / 4;
              const bbox = polyBBox(s.points);
              const hx = (bbox.minX + bbox.maxX) / 2;
              const hy = bbox.minY - 28 / transform.scale;
              const hr = 8 / transform.scale;
              const hsw = 1.5 / transform.scale;
              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  <path d={pointsToPath(s.points)} fill="transparent" stroke="none" />
                  <g transform={`translate(${dcx},${dcy}) rotate(${angle}) scale(${w/64},${h/64}) translate(-32,-32)`} style={{ pointerEvents: "none" }}>
                    <rect x="0" y="0" width="64" height="64" fill={color + "18"} stroke="none" />
                    <polyline points="16 20 16 8 48 8 48 56 16 56 16 44" stroke={color} strokeWidth={isSel ? 3.5 : 2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.saved ? "none" : "4 2"} />
                    <polyline points="28 40 36 32 28 24" stroke={color} strokeWidth={isSel ? 3 : 2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="8" y1="32" x2="36" y2="32" stroke={color} strokeWidth={isSel ? 3 : 2} strokeLinecap="round" />
                  </g>
                  {isSel && s.points.map((pt, i) => (
                    <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                      <circle cx={pt.x} cy={pt.y} r={14 / transform.scale} fill="transparent" />
                      <circle cx={pt.x} cy={pt.y} r={6 / transform.scale} fill="#fff" stroke={color} strokeWidth={1.5 / transform.scale} style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                  {isSel && (
                    <g>
                      <line x1={hx} y1={bbox.minY} x2={hx} y2={hy + hr} stroke={color + "66"} strokeWidth={hsw} style={{ pointerEvents: "none" }} />
                      <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                        <circle cx={hx} cy={hy} r={hr * 2} fill="transparent" />
                        <circle cx={hx} cy={hy} r={hr} fill="#1e1e2e" stroke={color} strokeWidth={hsw} style={{ pointerEvents: "none" }} />
                        <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fontSize={hr * 1.3} fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                      </g>
                    </g>
                  )}
                  {s.showLabel !== false && (() => {
                    const lx = dcx + (s.labelOffset?.x ?? 0);
                    const ly = dcy + h * 0.55 + (s.labelOffset?.y ?? 0);
                    return <text x={lx} y={ly} textAnchor="middle" dominantBaseline="hanging" fontSize={s.labelSize ?? Math.max(7, Math.min(11, w * 0.18))} fontWeight={500} fill={color + "cc"} style={{ pointerEvents: "none", userSelect: "none" }}>{s.name}</text>;
                  })()}
                  {!s.saved && <text x={dcx} y={dcy + h * 0.5 + 14} textAnchor="middle" fontSize={10} fill={color+"88"} style={{ pointerEvents:"none", userSelect:"none" }}>unsaved</text>}
                </g>
              );
            }

            // STAIRS — render stairs SVG shape with 4 corner handles + rotation
            if (s.sectionType === "STAIRS" && s.stairsMeta) {
              const { w, h, angle } = s.stairsMeta;
              const dcx = s.points.reduce((sum, p) => sum + p.x, 0) / 4;
              const dcy = s.points.reduce((sum, p) => sum + p.y, 0) / 4;
              const bbox = polyBBox(s.points);
              const hx = (bbox.minX + bbox.maxX) / 2;
              const hy = bbox.minY - 28 / transform.scale;
              const hr = 8 / transform.scale;
              const hsw = 1.5 / transform.scale;
              const sw = isSel ? 3 : 2;
              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  <path d={pointsToPath(s.points)} fill="transparent" stroke="none" />
                  <g transform={`translate(${dcx},${dcy}) rotate(${angle}) scale(${w/500},${h/500}) translate(-250,-250)`} style={{ pointerEvents: "none" }}>
                    {/* <rect x="0" y="0" width="500" height="500" fill={color + "18"} stroke="none" /> */}
                    <polygon points="160,98 361,98 413,403 87,403" fill="none" stroke={color} strokeWidth={isSel ? 5 : 3.5} strokeLinejoin="round" strokeDasharray={s.saved ? "none" : "20 10"} />
                    <line x1="154" y1="118" x2="366" y2="118" stroke={color} strokeWidth={sw} />
                    <line x1="148" y1="140" x2="370" y2="140" stroke={color} strokeWidth={sw} />
                    <line x1="141" y1="165" x2="375" y2="165" stroke={color} strokeWidth={sw} />
                    <line x1="133" y1="191" x2="381" y2="191" stroke={color} strokeWidth={sw} />
                    <line x1="123" y1="222" x2="388" y2="222" stroke={color} strokeWidth={sw} />
                    <line x1="113" y1="257" x2="395" y2="257" stroke={color} strokeWidth={sw} />
                    <line x1="101" y1="297" x2="403" y2="297" stroke={color} strokeWidth={sw} />
                    <line x1="87"  y1="342" x2="413" y2="342" stroke={color} strokeWidth={sw} />
                  </g>
                  {isSel && s.points.map((pt, i) => (
                    <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                      <circle cx={pt.x} cy={pt.y} r={14 / transform.scale} fill="transparent" />
                      <circle cx={pt.x} cy={pt.y} r={6 / transform.scale} fill="#fff" stroke={color} strokeWidth={1.5 / transform.scale} style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                  {isSel && (
                    <g>
                      <line x1={hx} y1={bbox.minY} x2={hx} y2={hy + hr} stroke={color + "66"} strokeWidth={hsw} style={{ pointerEvents: "none" }} />
                      <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                        <circle cx={hx} cy={hy} r={hr * 2} fill="transparent" />
                        <circle cx={hx} cy={hy} r={hr} fill="#1e1e2e" stroke={color} strokeWidth={hsw} style={{ pointerEvents: "none" }} />
                        <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fontSize={hr * 1.3} fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                      </g>
                    </g>
                  )}
                  {s.showLabel !== false && (() => {
                    const lx = dcx + (s.labelOffset?.x ?? 0);
                    const ly = dcy + h * 0.55 + (s.labelOffset?.y ?? 0);
                    return <text x={lx} y={ly} textAnchor="middle" dominantBaseline="hanging" fontSize={s.labelSize ?? Math.max(7, Math.min(11, w * 0.18))} fontWeight={500} fill={color + "cc"} style={{ pointerEvents: "none", userSelect: "none" }}>{s.name}</text>;
                  })()}
                  {!s.saved && <text x={dcx} y={dcy + h * 0.5 + 14} textAnchor="middle" fontSize={10} fill={color+"88"} style={{ pointerEvents:"none", userSelect:"none" }}>unsaved</text>}
                </g>
              );
            }

            // TEXT sections — transparent hit area + SVG text
            if (s.sectionType === "TEXT") {
              const tColor = s.textColor ?? "#ffffff";
              const tSize = s.labelSize ?? 18;
              const tAngle = s.textAngle ?? 0;
              const tBold = s.textBold ?? false;
              const tx = c.x + (s.labelOffset?.x ?? 0);
              const ty = c.y + (s.labelOffset?.y ?? 0);
              // Hit area sized to match the visible text (estimated bounds)
              const hitPad = 10 / transform.scale;
              const hitHalfW = s.name.length * tSize * 0.32 + hitPad;
              const hitHalfH = tSize * 0.65 + hitPad;
              const sw = 1.5 / transform.scale;
              // Rotation handle — orbits around (tx, ty) tracking the "top" of the rotated text.
              // SVG rotate(θ) is clockwise. The text's "up" direction in SVG coords is
              // (sin θ, -cos θ), so the handle sits at that offset from the text centre.
              const tAngleRad = tAngle * Math.PI / 180;
              const handleDist = hitHalfH + 36 / transform.scale;
              const hx = tx + handleDist * Math.sin(tAngleRad);
              const hy = ty - handleDist * Math.cos(tAngleRad);
              const lineStartX = tx + hitHalfH * Math.sin(tAngleRad);
              const lineStartY = ty - hitHalfH * Math.cos(tAngleRad);
              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  {/* Hit area — transparent rect covering the rendered text */}
                  <rect
                    x={tx - hitHalfW} y={ty - hitHalfH}
                    width={hitHalfW * 2} height={hitHalfH * 2}
                    fill="transparent"
                    stroke={isSel ? tColor + "66" : multiSelected.has(s.id) ? "#7F77DD" : "none"}
                    strokeWidth={isSel || multiSelected.has(s.id) ? sw : 0}
                    strokeDasharray={s.saved ? "none" : `${6/transform.scale} ${3/transform.scale}`}
                    transform={tAngle !== 0 ? `rotate(${tAngle}, ${tx}, ${ty})` : undefined}
                  />
                  {/* Rotation handle — shown when selected alone */}
                  {isSel && (
                    <g>
                      <line x1={lineStartX} y1={lineStartY} x2={hx} y2={hy}
                        stroke={tColor + "66"} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                      <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                        <circle cx={hx} cy={hy} r={16 / transform.scale} fill="transparent" />
                        <circle cx={hx} cy={hy} r={8 / transform.scale} fill="#1e1e2e" stroke={tColor} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                        <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central"
                          fontSize={10 / transform.scale} fill={tColor} style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                      </g>
                    </g>
                  )}
                  {/* The actual text */}
                  <text
                    x={tx} y={ty}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={tSize} fontWeight={tBold ? 700 : 400} fill={tColor}
                    transform={tAngle !== 0 ? `rotate(${tAngle}, ${tx}, ${ty})` : undefined}
                    style={{ pointerEvents: "none", userSelect: "none" }}>
                    {s.name}
                  </text>
                  {!s.saved && !isDimmed && (
                    <text x={tx} y={ty + hitHalfH + 8 / transform.scale} textAnchor="middle" dominantBaseline="central"
                      fontSize={10 / transform.scale} fill={tColor + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>unsaved</text>
                  )}
                </g>
              );
            }

            // VENUE OBJECT sections — decorative polygon with icon + label
            if (isVenueObject(s.sectionType)) {
              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  <path
                    d={curvedPath(s.points, s.edgeCurve)}
                    fill={color + "28"}
                    stroke={color}
                    strokeWidth={isSel ? 2 : 1.5}
                    strokeDasharray={s.saved ? "none" : "6 3"} />
                  {multiSelected.has(s.id) && !isSel && (
                    <path d={curvedPath(s.points, s.edgeCurve)} fill="none" stroke="#7F77DD" strokeWidth={1.5 / transform.scale} strokeDasharray={`${4/transform.scale} ${2/transform.scale}`} style={{ pointerEvents: "none" }} />
                  )}
                  {/* Selection vertex handles */}
                  {isSel && s.points.map((pt, i) => (
                    <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                      <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" stroke="none" />
                      <circle cx={pt.x} cy={pt.y} r={7} fill="#fff" stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                  {/* Rotation handle — anchored to visual polygon top (accounts for edgeCurve bulge) */}
                  {isSel && (() => {
                    const ctr = centroid(s.points);
                    const lineAnchorY = curvedBBox(s.points, s.edgeCurve).minY;
                    const hx = ctr.x;
                    const hy = ctr.y - Math.max(Math.abs(ctr.y - lineAnchorY) + 28 / transform.scale, 28 / transform.scale);
                    const r  = 8 / transform.scale;
                    const sw = 1.5 / transform.scale;
                    return (
                      <g>
                        <line x1={hx} y1={lineAnchorY} x2={hx} y2={hy + r} stroke={color + "66"} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                        <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                          <circle cx={hx} cy={hy} r={r * 2} fill="transparent" />
                          <circle cx={hx} cy={hy} r={r} fill="#1e1e2e" stroke={color} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                          <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.3} fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                        </g>
                      </g>
                    );
                  })()}
                  {/* Icon + name label */}
                  {(() => {
                    // Use sqrt(area) for size — area is rotation-invariant, bbox dimensions are not
                    const stableSize = Math.sqrt(polyArea(s.points));
                    const iconSize = s.iconSize ?? Math.max(10, stableSize * 0.32);
                    const nameFontSize = s.labelSize ?? Math.max(6, Math.min(11, stableSize * 0.13));
                    const ox = c.x + (s.iconOffset?.x ?? 0);
                    const oy = c.y + (s.iconOffset?.y ?? 0);
                    const lx = c.x + (s.labelOffset?.x ?? 0);
                    const ly = c.y + iconSize * 0.55 + (s.labelOffset?.y ?? 0);
                    return (
                      <g style={{ pointerEvents: "none", userSelect: "none" }}>
                        {s.showIcon !== false && (
                          <g transform={`translate(${ox},${oy})`}>
                            {renderVenueIcon(s.sectionType as VenueObjectType, color, iconSize)}
                          </g>
                        )}
                        {s.showLabel !== false && (
                          <text x={lx} y={ly}
                            textAnchor="middle" dominantBaseline="hanging"
                            fontSize={nameFontSize} fontWeight={500} fill={color + "cc"}>
                            {s.name}
                          </text>
                        )}
                      </g>
                    );
                  })()}
                  {!s.saved && !isDimmed && (
                    <text x={c.x} y={c.y + 28} textAnchor="middle" dominantBaseline="central"
                      fontSize={10} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>unsaved</text>
                  )}
                </g>
              );
            }

            // TABLE sections — render as graphic, not polygon
            if (s.sectionType === "TABLE" && s.tableMeta) {
              const tMeta = s.tableMeta;
              const tBbox = polyBBox(s.points);
              const tcx = (tBbox.minX + tBbox.maxX) / 2;
              const tcy = (tBbox.minY + tBbox.maxY) / 2;
              const chairR = Math.max(4, Math.min(7, tMeta.w / 16));
              // Use stored seats (saved) or computed positions (unsaved)
              type ChairItem = { key: string; x: number; y: number; stored: SeatDot | null };
              const chairs: ChairItem[] = (s.seats && s.seats.length > 0)
                ? s.seats.map(seat => ({ key: seat.id, x: seat.x, y: seat.y, stored: seat }))
                : computeChairPositions(tMeta, tcx, tcy).map((pt, i) => ({ key: `c${i}`, x: pt.x, y: pt.y, stored: null }));

              return (
                <g key={s.id} data-section-id={s.id}
                  style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>
                  {/* Interactive chairs — rendered before surface (chairs are outside table body) */}
                  {chairs.map(({ key, x, y, stored: chairSeat }) => {
                    const ang = Math.atan2(y - tcy, x - tcx);
                    const bx = tcx + (Math.hypot(x - tcx, y - tcy) + chairR * 0.5) * Math.cos(ang);
                    const by = tcy + (Math.hypot(x - tcx, y - tcy) + chairR * 0.5) * Math.sin(ang);
                    const isChairSel = chairSeat ? selectedSeats.has(chairSeat.id) : false;
                    const isChairHov = chairSeat ? hoveredSeat?.seat.id === chairSeat.id : false;
                    const chairHoldInfo = holdsMode && chairSeat ? seatHoldMap.get(chairSeat.id) : undefined;
                    const chairFill = chairHoldInfo ? chairHoldInfo.color + "55" : (isChairSel ? color : isChairHov ? color + "70" : color + "40");
                    const chairStroke = chairHoldInfo ? chairHoldInfo.color : (isChairSel ? "#fff" : color);
                    const chairSW = isChairSel ? 1.5 : 0.8;
                    return (
                      <g key={key}
                        data-seat-id={chairSeat?.id}
                        style={{ cursor: isSel && chairSeat ? "grab" : "pointer" }}
                        onMouseEnter={chairSeat ? ev => setHoveredSeat({ seat: chairSeat, sectionName: s.name, zoneName: zone?.name ?? "None", zoneColor: zone?.color ?? "#888", screenX: ev.clientX, screenY: ev.clientY }) : undefined}
                        onMouseLeave={chairSeat ? () => setHoveredSeat(null) : undefined}
                        onMouseDown={chairSeat ? e => {
                          e.stopPropagation();
                          // Holds mode: just toggle seat selection, skip table-select logic
                          if (sidebarTab === "holds") {
                            setSelectedSeats(prev => {
                              const next = new Set(prev);
                              if (next.has(chairSeat.id)) next.delete(chairSeat.id); else next.add(chairSeat.id);
                              return next;
                            });
                            return;
                          }
                          hasDragged.current = false;
                          if (!isSel) {
                            // Table not yet selected — select it and allow section drag
                            setSelected(s.id);
                            sectionDragState.current = {
                              sectionId: s.id,
                              startClientX: e.clientX, startClientY: e.clientY,
                              origPoints: s.points.map(p => ({ ...p })),
                              origSeats: (s.seats ?? []).map(seat => ({ ...seat })),
                              downTarget: e.target as Element,
                              extra: [],
                            };
                            return;
                          }
                          if (e.shiftKey) {
                            setSelectedSeats(prev => {
                              const next = new Set(prev);
                              if (next.has(chairSeat.id)) next.delete(chairSeat.id); else next.add(chairSeat.id);
                              return next;
                            });
                            return;
                          }
                          const selectedNow = selectedSeatsRef.current;
                          const dragSeats = selectedNow.has(chairSeat.id)
                            ? s.seats?.filter(seat => selectedNow.has(seat.id)) ?? []
                            : s.seats?.filter(seat => seat.id === chairSeat.id) ?? [];
                          if (!selectedNow.has(chairSeat.id)) setSelectedSeats(new Set([chairSeat.id]));
                          seatDragState.current = {
                            primarySeatId: chairSeat.id,
                            origSeats: dragSeats.map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
                            startClientX: e.clientX, startClientY: e.clientY,
                            sectionId: s.id,
                          };
                        } : undefined}
                      >
                        {/* Transparent hit area */}
                        <ellipse cx={x} cy={y} rx={chairR * 1.6} ry={chairR * 1.3} fill="transparent" stroke="none" />
                        {/* Shape-based rendering */}
                        {(() => {
                          const shape = chairSeat?.shape ?? "chair";
                          if (shape === "chair") return (
                            <g style={{ pointerEvents: "none" }}>
                              <ellipse cx={bx} cy={by}
                                rx={chairR * 0.9} ry={chairR * 0.35}
                                transform={`rotate(${ang * 180 / Math.PI + 90}, ${bx}, ${by})`}
                                fill={chairHoldInfo ? chairHoldInfo.color + "55" : color + "55"}
                                stroke={chairHoldInfo ? chairHoldInfo.color + "aa" : color + "aa"} strokeWidth={0.8} />
                              <ellipse cx={x} cy={y}
                                rx={chairR} ry={chairR * 0.7}
                                transform={`rotate(${ang * 180 / Math.PI + 90}, ${x}, ${y})`}
                                fill={chairFill} stroke={chairStroke} strokeWidth={chairSW} />
                            </g>
                          );
                          return renderSeat(x, y, shape, chairR, chairFill, chairStroke, chairSW);
                        })()}
                        {chairHoldInfo && <>
                          <line x1={x - chairR * 0.55} y1={y - chairR * 0.55} x2={x + chairR * 0.55} y2={y + chairR * 0.55} stroke={chairHoldInfo.color} strokeWidth={1} style={{ pointerEvents: "none" }} />
                          <line x1={x + chairR * 0.55} y1={y - chairR * 0.55} x2={x - chairR * 0.55} y2={y + chairR * 0.55} stroke={chairHoldInfo.color} strokeWidth={1} style={{ pointerEvents: "none" }} />
                        </>}
                      </g>
                    );
                  })}
                  {/* Table surface */}
                  {renderTableGraphic(s, color, isSel, transform.scale)}
                  {multiSelected.has(s.id) && !isSel && (
                    <path d={curvedPath(s.points, s.edgeCurve)} fill="none" stroke="#7F77DD" strokeWidth={1.5 / transform.scale} strokeDasharray={`${4/transform.scale} ${2/transform.scale}`} style={{ pointerEvents: "none" }} />
                  )}
                  {/* Resize handles — 4 bounding-box corners */}
                  {isSel && s.points.map((pt, i) => (
                    <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                      <circle cx={pt.x} cy={pt.y} r={14 / transform.scale} fill="transparent" stroke="none" />
                      <rect
                        x={pt.x - 5 / transform.scale} y={pt.y - 5 / transform.scale}
                        width={10 / transform.scale} height={10 / transform.scale}
                        rx={2 / transform.scale}
                        fill="#1e1e2e" stroke={color} strokeWidth={1.5 / transform.scale}
                        style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                  {/* Rotation handle */}
                  {isSel && !isFocused && (() => {
                    const bbox = polyBBox(s.points);
                    const hx = (bbox.minX + bbox.maxX) / 2;
                    const hy = bbox.minY - 28 / transform.scale;
                    const r  = 8 / transform.scale;
                    const sw = 1.5 / transform.scale;
                    return (
                      <g>
                        <line x1={hx} y1={bbox.minY} x2={hx} y2={hy + r}
                          stroke={color + "66"} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                        <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                          <circle cx={hx} cy={hy} r={r * 2} fill="transparent" />
                          <circle cx={hx} cy={hy} r={r} fill="#1e1e2e" stroke={color} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                          <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central"
                            fontSize={r * 1.3} fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                        </g>
                      </g>
                    );
                  })()}
                  {!s.saved && !isDimmed && (
                    <text x={c.x} y={c.y + 32} textAnchor="middle" dominantBaseline="central"
                      fontSize={10} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>unsaved</text>
                  )}
                </g>
              );
            }

            return (
              <g key={s.id} data-section-id={s.id}
                style={{ cursor: tool === "select" ? "pointer" : "default", opacity: isDimmed ? 0.12 : 1 }}>

                {/* Polygon — detailed reshape in focus+transform, normal path otherwise */}
                <path
                  d={focusPath}
                  fill={isFocused ? color + "18" : color + "30"}
                  stroke={color}
                  strokeWidth={isSel ? 2 : 1}
                  strokeDasharray={s.saved ? "none" : "6 3"} />
                {multiSelected.has(s.id) && !isSel && (
                  <path d={curvedPath(s.points, s.edgeCurve)} fill="none" stroke="#7F77DD" strokeWidth={1.5 / transform.scale} strokeDasharray={`${4/transform.scale} ${2/transform.scale}`} style={{ pointerEvents: "none" }} />
                )}

                {/* Ghost straight outline when curved (so vertices are visible) */}
                {Math.abs(s.edgeCurve) > 0.5 && (
                  <path d={pointsToPath(s.points)} fill="none"
                    stroke={color + "33"} strokeWidth={0.5} strokeDasharray="3 3"
                    style={{ pointerEvents: "none" }} />
                )}

                {/* Rotation handle (selected, not focused) */}
                {isSel && !isFocused && (() => {
                  // Handle x/y position based on display seat bbox center (matches rotation pivot)
                  const seatBbox = (displaySeats.length > 0)
                    ? (() => { const xs = displaySeats.map(s => s.x), ys = displaySeats.map(s => s.y); return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }; })()
                    : polyBBox(s.points);
                  const hx = (seatBbox.minX + seatBbox.maxX) / 2;
                  const hy = seatBbox.minY - 28 / transform.scale;
                  // Line bottom anchors at the visual boundary top — for GA sections with edgeCurve,
                  // the bezier bulge may extend beyond raw vertex minY, so use curvedBBox.
                  const lineAnchorY = displaySeats.length > 0
                    ? polyBBox(s.points).minY
                    : curvedBBox(s.points, s.edgeCurve).minY;
                  const r  = 8 / transform.scale;
                  const sw = 1.5 / transform.scale;
                  return (
                    <g>
                      <line x1={hx} y1={lineAnchorY} x2={hx} y2={hy + r}
                        stroke={color + "66"} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                      <g data-rotation-handle={s.id} style={{ cursor: "crosshair" }}>
                        {/* large invisible hit area */}
                        <circle cx={hx} cy={hy} r={r * 2} fill="transparent" />
                        {/* visual ring */}
                        <circle cx={hx} cy={hy} r={r} fill="#1e1e2e" stroke={color} strokeWidth={sw} style={{ pointerEvents: "none" }} />
                        {/* ↻ arrow */}
                        <text x={hx} y={hy} textAnchor="middle" dominantBaseline="central"
                          fontSize={r * 1.3} fill={color}
                          style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                      </g>
                    </g>
                  );
                })()}

                {/* Vertex handles — only for simple polygons (≤6 pts); reshape polygons aren't manually editable */}
                {s.points.length <= 6 && s.points.map((pt, i) => (isSel || isFocused) ? (
                  <g key={i} data-vertex-index={i} style={{ cursor: "crosshair" }}>
                    <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" stroke="none" />
                    <circle cx={pt.x} cy={pt.y} r={isFocused ? 4 : 7}
                      fill="#fff" stroke={color} strokeWidth={isFocused ? 1 : 2}
                      style={{ pointerEvents: "none" }} />
                  </g>
                ) : (
                  <circle key={i} cx={pt.x} cy={pt.y} r={3}
                    fill="transparent" stroke={color} strokeWidth={1} style={{ pointerEvents: "none" }} />
                ))}

                {/* Section label — sized to fit inside the polygon */}
                {(() => {
                  const hasSubBadge = !isFocused && (seatCount > 0 || (s.capacity !== undefined && seatCount === 0));
                  return (
                    <text
                      x={c.x + (s.labelOffset?.x ?? 0)} y={c.y + (hasSubBadge ? -8 : 0) + (s.labelOffset?.y ?? 0)}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={isFocused ? 9 : (s.labelSize ?? labelFontSize(s.label, polyBBox(s.points), 14, 7))} fontWeight={500}
                      fill={isFocused ? color + "55" : color}
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {s.label}
                    </text>
                  );
                })()}

                {/* Seated section: seat count badge */}
                {seatCount > 0 && !isFocused && !holdsMode && (() => {
                  const lfs = s.labelSize ?? labelFontSize(s.label, polyBBox(s.points), 14, 7);
                  return (
                    <text x={c.x + (s.labelOffset?.x ?? 0)}
                      y={c.y - 8 + (s.labelOffset?.y ?? 0) + lfs * 0.6 + 6}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={9} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>
                      {seatCount} seats · dbl-click to edit
                    </text>
                  );
                })()}

                {/* GA section: capacity badge */}
                {seatCount === 0 && s.capacity !== undefined && !isFocused && (
                  <text x={c.x} y={c.y + 10} textAnchor="middle" dominantBaseline="central"
                    fontSize={9} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>
                    {s.capacity} capacity
                  </text>
                )}

                {/* Zone palette — overview only, shows unique zones present in section (no individual seat dots) */}
                {!isFocused && !holdsMode && seatCount > 0 && perSeatZones.length > 0 && (
                  <g style={{ pointerEvents: "none" }}>
                    {perSeatZones.slice(0, 6).map((z, i) => {
                      const total = Math.min(perSeatZones.length, 6);
                      const spacing = 10;
                      const palX = c.x + (s.labelOffset?.x ?? 0) - (total - 1) * spacing / 2 + i * spacing;
                      const lfs = s.labelSize ?? labelFontSize(s.label, polyBBox(s.points), 14, 7);
                      const palY = c.y + (s.labelOffset?.y ?? 0) + lfs * 0.4 + 22;
                      return <circle key={z.id} cx={palX} cy={palY} r={4} fill={z.color} fillOpacity={0.85} />;
                    })}
                  </g>
                )}

                {/* Seat dots (focus mode or holds mode) */}
                {(isFocused || holdsMode) && displaySeats.map(seat => {
                  const isSel2 = selectedSeats.has(seat.id);
                  const holdInfo = seatHoldMap.get(seat.id);
                  // Per-seat zone color overrides section zone color
                  const seatZone = seat.zoneId ? zones.find(z => z.id === seat.zoneId) : undefined;
                  const seatColor = seatZone ? seatZone.color : color;
                  const fill = isSel2 ? seatColor : seatColor + "99";
                  const stroke = isSel2 ? "#fff" : seatColor;
                  const sw = isSel2 ? 1.5 : 0.8;
                  return (
                    <g key={seat.id} data-seat-id={seat.id} style={{ cursor: "pointer" }}
                      onMouseEnter={ev => setHoveredSeat({ seat, sectionName: s.name, zoneName: seatZone?.name ?? zone?.name ?? "None", zoneColor: seatZone?.color ?? zone?.color ?? "#888", screenX: ev.clientX, screenY: ev.clientY })}
                      onMouseLeave={() => setHoveredSeat(null)}
                    >
                      <circle cx={seat.x} cy={seat.y} r={Math.max(seatRadius + 4, 8)} fill="transparent" stroke="none" />
                      {renderSeat(seat.x, seat.y, seat.shape ?? seatShape, seatRadius, fill, stroke, sw)}
                      {holdInfo && holdsMode && <>
                        <circle cx={seat.x} cy={seat.y} r={seatRadius} fill={holdInfo.color + "55"} stroke={holdInfo.color} strokeWidth={0.8} style={{ pointerEvents: "none" }} />
                        <line x1={seat.x - seatRadius * 0.55} y1={seat.y - seatRadius * 0.55} x2={seat.x + seatRadius * 0.55} y2={seat.y + seatRadius * 0.55} stroke={holdInfo.color} strokeWidth={1} style={{ pointerEvents: "none" }} />
                        <line x1={seat.x + seatRadius * 0.55} y1={seat.y - seatRadius * 0.55} x2={seat.x - seatRadius * 0.55} y2={seat.y + seatRadius * 0.55} stroke={holdInfo.color} strokeWidth={1} style={{ pointerEvents: "none" }} />
                      </>}
                    </g>
                  );
                })}

                {/* Row labels (focus mode only) — clickable for rename */}
                {isFocused && !holdsMode && s.rows?.map(row => {
                  const first = rowFirstSeats.get(row.id);
                  if (!first) return null;
                  return (
                    <text
                      key={row.id}
                      data-row-id={row.id}
                      x={first.x - seatRadius - 6}
                      y={first.y}
                      textAnchor="end"
                      dominantBaseline="central"
                      fontSize={8}
                      fill={color + "cc"}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      {row.label}
                    </text>
                  );
                })}

                {!s.saved && !isDimmed && (
                  <text x={c.x} y={c.y + (seatCount > 0 ? 22 : 18)} textAnchor="middle" dominantBaseline="central"
                    fontSize={10} fill={color + "88"} style={{ pointerEvents: "none", userSelect: "none" }}>
                    unsaved
                  </text>
                )}
              </g>
            );
          })}

          {/* Group selection bounding box + global rotation handle */}
          {multiSelected.size > 1 && !focusedSection && (() => {
            const allPts = [...multiSelected].flatMap(id => {
              const s = sections.find(sec => sec.id === id);
              return s ? s.points : [];
            });
            if (allPts.length === 0) return null;
            const bbox = polyBBox(allPts);
            const PAD = 14 / transform.scale;
            const bx = bbox.minX - PAD, by = bbox.minY - PAD;
            const bw = bbox.maxX - bbox.minX + 2 * PAD;
            const bh = bbox.maxY - bbox.minY + 2 * PAD;
            const cx = (bbox.minX + bbox.maxX) / 2;
            const handleY = by - 36 / transform.scale;
            const hr = 8 / transform.scale;
            const sw = 1.5 / transform.scale;
            return (
              <g>
                <rect x={bx} y={by} width={bw} height={bh}
                  fill="rgba(127,119,221,0.04)" stroke="#7F77DD"
                  strokeWidth={sw} strokeDasharray={`${6/transform.scale} ${3/transform.scale}`}
                  style={{ pointerEvents: "none" }} />
                <line x1={cx} y1={by} x2={cx} y2={handleY + hr}
                  stroke="#7F77DD66" strokeWidth={sw} style={{ pointerEvents: "none" }} />
                <g data-group-rotation-handle="true" style={{ cursor: "crosshair" }}>
                  <circle cx={cx} cy={handleY} r={hr * 2.2} fill="transparent" />
                  <circle cx={cx} cy={handleY} r={hr} fill="#1e1e2e" stroke="#7F77DD" strokeWidth={sw} style={{ pointerEvents: "none" }} />
                  <text x={cx} y={handleY} textAnchor="middle" dominantBaseline="central"
                    fontSize={hr * 1.3} fill="#7F77DD" style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                </g>
              </g>
            );
          })()}

          {/* Marquee */}
          {marqueeRect && (
            <rect
              x={Math.min(marqueeRect.x1, marqueeRect.x2)} y={Math.min(marqueeRect.y1, marqueeRect.y2)}
              width={Math.abs(marqueeRect.x2 - marqueeRect.x1)} height={Math.abs(marqueeRect.y2 - marqueeRect.y1)}
              fill="rgba(127,119,221,0.1)" stroke="#7F77DD"
              strokeWidth={1 / transform.scale} strokeDasharray={`${4 / transform.scale} ${2 / transform.scale}`}
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* Table drag ghost */}
          {tool === "table" && tableDraft && (() => {
            const dx = Math.abs(tableDraft.endPt.x - tableDraft.startPt.x);
            const dy = Math.abs(tableDraft.endPt.y - tableDraft.startPt.y);
            const x = Math.min(tableDraft.startPt.x, tableDraft.endPt.x);
            const y = Math.min(tableDraft.startPt.y, tableDraft.endPt.y);
            if (dx < 4 && dy < 4) return null;
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={x} y={y} width={dx} height={dy}
                  fill="rgba(127,119,221,0.08)" stroke="#7F77DD"
                  strokeWidth={1 / transform.scale} strokeDasharray={`${5 / transform.scale} ${3 / transform.scale}`} />
                <text x={x + dx / 2} y={y + dy / 2} textAnchor="middle" dominantBaseline="central"
                  fontSize={11 / transform.scale} fill="#7F77DD88" style={{ userSelect: "none" }}>
                  {Math.round(dx)} × {Math.round(dy)}
                </text>
              </g>
            );
          })()}

          {/* Polygon in-progress */}
          {drawing.length > 0 && (
            <g style={{ pointerEvents: "none" }}>
              <polyline
                points={[...drawing, mouse ?? drawing[drawing.length - 1]].map(p => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke="#7F77DD" strokeWidth={1.5} strokeDasharray="6 3" />
              {drawing.map((pt, i) => (
                <circle key={i} cx={pt.x} cy={pt.y} r={i === 0 ? 6 : 4}
                  fill={i === 0 ? "#7F77DD" : "#2d2a5e"} stroke="#7F77DD" strokeWidth={1} />
              ))}
            </g>
          )}
          </g>
        </svg>

        {/* Zoom controls */}
        <div style={{ position: "absolute", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          {([["＋", () => zoom(1.25)], ["↺", resetZoom], ["－", () => zoom(0.8)]] as [string, () => void][]).map(([label, fn]) => (
            <button key={label} onClick={fn} style={zbtn}>{label}</button>
          ))}
        </div>

        {/* Hints */}
        {focusedSection && (
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(83,74,183,0.88)", color: "#fff", padding: "7px 18px", borderRadius: 20, fontSize: 12, pointerEvents: "none" }}>
            Focus mode · Esc or click empty canvas to exit
          </div>
        )}
        {sel && !focusedSection && isVenueObject(sel.sectionType) && (
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.72)", color: "#aaa", padding: "7px 18px", borderRadius: 20, fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap" }}>
            Arrow = move icon · Shift+Arrow = move label · Ctrl for ×5 step
          </div>
        )}
        {tool === "polygon" && drawing.length === 0 && !focusedSection && (
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", color: "#ccc", padding: "8px 18px", borderRadius: 20, fontSize: 12, pointerEvents: "none" }}>
            Click to place points · Double-click or click first point to close
          </div>
        )}
        {tool === "table" && !tableDraft && (
          <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(83,74,183,0.85)", color: "#fff", padding: "8px 18px", borderRadius: 20, fontSize: 12, pointerEvents: "none" }}>
            Click-drag to size table · Release to place
          </div>
        )}
        {tool === "polygon" && drawing.length > 0 && (
          <div style={{ position: "absolute", bottom: 20, right: 60, display: "flex", gap: 8 }}>
            <button onClick={finishPolygon} style={pbtn}>Close polygon</button>
            <button onClick={() => { setDrawing([]); setTool("select"); }} style={sbtn}>Cancel</button>
          </div>
        )}

        {/* Object creation dialog */}
        {objectCreateDraft && (() => {
          const cfg = VENUE_OBJECT_CFG[objectCreateDraft.iconType];
          const handleCreate = () => {
            upd(objectCreateDraft.sectionId, {
              name: objectCreateDraft.name,
              label: objectCreateDraft.name,
              sectionType: objectCreateDraft.iconType,
            });
            setObjectCreateDraft(null);
          };
          const handleCancel = () => {
            setSections(p => p.filter(s => s.id !== objectCreateDraft.sectionId));
            setSelected(null);
            setObjectCreateDraft(null);
          };
          return (
            <div onMouseDown={e => e.stopPropagation()} style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                background: "#1a1a2e", border: "1px solid #444", borderRadius: 12,
                padding: "20px 22px", width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#ccc", marginBottom: 16 }}>Add venue object</div>
                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Name</span>
                  <input autoFocus value={objectCreateDraft.name}
                    onChange={e => setObjectCreateDraft(p => p ? { ...p, name: e.target.value } : null)}
                    onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") handleCancel(); }}
                    style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
                </label>
                {objectCreateDraft.iconType !== "WALL" && objectCreateDraft.iconType !== "DOOR" && (
                  <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 6 }}>Icon</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                      {VENUE_OBJECT_TYPES.filter(t => t !== "WALL" && t !== "DOOR" && t !== "STAIRS").map(t => {
                        const c = VENUE_OBJECT_CFG[t];
                        const active = objectCreateDraft.iconType === t;
                        return (
                          <button key={t} onClick={() => setObjectCreateDraft(p => p ? { ...p, iconType: t } : null)} style={{
                            padding: "8px 4px 6px", borderRadius: 8, border: "1px solid",
                            borderColor: active ? c.color : "#333",
                            background: active ? c.color + "28" : "#111",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                          }}>
                            <svg width="30" height="30" viewBox="-15 -15 30 30" style={{ overflow: "visible" }}>
                              {renderVenueIcon(t, active ? c.color : "#666", 13)}
                            </svg>
                            <span style={{ fontSize: 10, color: active ? c.color : "#555", lineHeight: 1 }}>{c.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={handleCreate} style={{ ...pbtn, flex: 1, background: cfg.color + "22", borderColor: cfg.color, color: cfg.color }}>
                    Add {objectCreateDraft.name || "object"}
                  </button>
                  <button onClick={handleCancel} style={{ ...sbtn, flex: "0 0 auto" }}>Cancel</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Seat hover tooltip */}
        {hoveredSeat && !editingSeat && (
          <div style={{
            position: "fixed", left: hoveredSeat.screenX + 14, top: hoveredSeat.screenY - 10,
            background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
            padding: "8px 12px", fontSize: 12, pointerEvents: "none", zIndex: 20, minWidth: 140,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: hoveredSeat.zoneColor, flexShrink: 0 }} />
              <span style={{ color: "#fff", fontWeight: 500 }}>Seat {hoveredSeat.seat.seatNumber}</span>
            </div>
            <div style={{ color: "#888" }}>Row {hoveredSeat.seat.rowLabel}</div>
            <div style={{ color: "#888" }}>{hoveredSeat.sectionName}</div>
            <div style={{ color: hoveredSeat.zoneColor }}>{hoveredSeat.zoneName}</div>
            <div style={{ color: "#444", marginTop: 4, fontSize: 10 }}>Click to rename</div>
          </div>
        )}

        {/* Seat popup: rename + per-seat shape + delete */}
        {editingSeat && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: "fixed", left: editingSeat.screenX - 80, top: editingSeat.screenY - 60,
              background: "#1a1a1a", border: "1px solid #534AB7", borderRadius: 8,
              padding: "10px 12px", zIndex: 30, boxShadow: "0 4px 16px rgba(0,0,0,0.5)", minWidth: 180,
            }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Seat</div>
            <input autoFocus value={editingSeat.value}
              onChange={e => setEditingSeat(p => p ? { ...p, value: e.target.value } : null)}
              onKeyDown={e => { if (e.key === "Enter") saveSeatRename(); if (e.key === "Escape") setEditingSeat(null); }}
              style={{ ...inp, width: "100%", marginBottom: 8 }} />
            <div style={{ fontSize: 11, color: "#666", marginBottom: 5 }}>Shape</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
              {(["circle", "square", "triangle", "chair", "wheelchair"] as SeatShapeType[]).map(sh => (
                <button key={sh} onClick={() => setEditingSeat(p => p ? { ...p, shape: sh } : null)} style={{
                  padding: "3px 4px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                  border: `1px solid ${editingSeat.shape === sh ? "#534AB7" : "#444"}`,
                  background: editingSeat.shape === sh ? "#2d2a5e" : "transparent",
                  color: editingSeat.shape === sh ? "#a09ce8" : "#ccc",
                }}>{sh.charAt(0).toUpperCase() + sh.slice(1)}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={saveSeatRename} style={{ ...pbtn, padding: "4px 10px", fontSize: 12, flex: 1 }}>Save</button>
              <button onClick={() => setEditingSeat(null)} style={{ ...sbtn, padding: "4px 8px", fontSize: 12 }}>✕</button>
              <button onClick={() => deleteSeat(editingSeat.id, editingSeat.sectionId)} style={{ ...dbtn, padding: "4px 8px", fontSize: 12 }}>🗑</button>
            </div>
          </div>
        )}

        {/* Table inspector popup (double-click on table) */}
        {editingTable && (() => {
          const ts = sections.find(s => s.id === editingTable.sectionId);
          if (!ts?.tableMeta) return null;
          const meta = ts.tableMeta;
          return (
            <div onMouseDown={e => e.stopPropagation()} style={{
              position: "fixed",
              left: Math.min(editingTable.screenX, window.innerWidth - 290),
              top: Math.min(editingTable.screenY - 20, window.innerHeight - 420),
              background: "#1a1a1a", border: "1px solid #534AB7", borderRadius: 10,
              padding: "14px 16px", zIndex: 40, boxShadow: "0 6px 24px rgba(0,0,0,0.6)", width: 270,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "#a09ce8" }}>Table Settings</span>
                <button onClick={() => setEditingTable(null)} style={{ ...sbtn, padding: "1px 7px", fontSize: 12 }}>✕</button>
              </div>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Shape</span>
                <select value={meta.shape} style={inp}
                  onChange={e => updateTableMeta(ts.id, { shape: e.target.value as TableShape })}>
                  {(["rectangle","round","square","oval","booth"] as TableShape[]).map(sh => (
                    <option key={sh} value={sh}>{sh.charAt(0).toUpperCase() + sh.slice(1)}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Width</span>
                  <input type="number" value={meta.w} min={40} max={500} style={inp}
                    onChange={e => updateTableMeta(ts.id, { w: Number(e.target.value) })} />
                </label>
                <label>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Height</span>
                  <input type="number" value={meta.h} min={30} max={400} style={inp}
                    onChange={e => updateTableMeta(ts.id, { h: Number(e.target.value) })} />
                </label>
              </div>
              {(meta.shape === "round" || meta.shape === "oval") ? (
                <label style={{ display: "block", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Total chairs</span>
                  <input type="number" value={meta.cpl} min={0} max={24} style={inp}
                    onChange={e => updateTableMeta(ts.id, { cpl: Number(e.target.value) })} />
                </label>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <label>
                    <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/long</span>
                    <input type="number" value={meta.cpl} min={0} max={12} style={inp}
                      onChange={e => updateTableMeta(ts.id, { cpl: Number(e.target.value) })} />
                  </label>
                  {meta.shape !== "booth" && (
                    <label>
                      <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Chairs/short</span>
                      <input type="number" value={meta.cps} min={0} max={6} style={inp}
                        onChange={e => updateTableMeta(ts.id, { cps: Number(e.target.value) })} />
                    </label>
                  )}
                </div>
              )}
              <label style={{ display: "block", marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Zone</span>
                <select value={ts.zoneId ?? ""} style={inp}
                  onChange={e => { const zoneId = e.target.value || undefined; upd(ts.id, { zoneId }); if (ts.saved) saveZoneChange(ts.id, zoneId); }}>
                  <option value="">None</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {!ts.saved && <button onClick={() => { saveTable(ts); setEditingTable(null); }} disabled={saving} style={pbtn}>{saving ? "Saving…" : "Save table"}</button>}
                <button onClick={() => { deleteSection(ts.id, ts.saved); setEditingTable(null); }} style={dbtn}>Delete</button>
              </div>
            </div>
          );
        })()}

        {/* Text edit widget */}
        {textEditId && (() => {
          const ts = sections.find(s => s.id === textEditId);
          if (!ts || ts.sectionType !== "TEXT") { setTextEditId(null); return null; }
          const saveTextPatch = (updates: Partial<DraftSection>) => {
            const updated = { ...ts, ...updates };
            upd(ts.id, updates);
            if (ts.saved) {
              const n: Record<string, unknown> = {};
              if (updated.textColor) n.textColor = updated.textColor;
              if (updated.textBold) n.textBold = updated.textBold;
              if (updated.textAngle) n.textAngle = updated.textAngle;
              if (updated.labelSize) n.labelSize = updated.labelSize;
              if (updated.labelOffset) n.labelOffset = updated.labelOffset;
              saveSectionPatch(ts.id, { name: updated.name, label: updated.name, notes: JSON.stringify(n) });
            }
          };
          return (
            <div onMouseDown={e => e.stopPropagation()} style={{
              position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
              background: "#1a1a2e", border: "1px solid #444", borderRadius: 12,
              padding: "14px 18px", zIndex: 60, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <input autoFocus value={ts.name}
                style={{ background: "#111", border: "1px solid #444", borderRadius: 6, color: "#fff", fontSize: 14, padding: "4px 8px", width: 140 }}
                onChange={e => saveTextPatch({ name: e.target.value, label: e.target.value })}
                placeholder="Text content" />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
                <span>Color</span>
                <input type="color" value={ts.textColor ?? "#ffffff"} style={{ width: 28, height: 28, borderRadius: 4, border: "none", cursor: "pointer" }}
                  onChange={e => saveTextPatch({ textColor: e.target.value })} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
                <span>Size</span>
                <input type="number" min={6} max={200} value={ts.labelSize ?? 18}
                  style={{ background: "#111", border: "1px solid #444", borderRadius: 6, color: "#fff", fontSize: 12, padding: "4px 6px", width: 54 }}
                  onChange={e => saveTextPatch({ labelSize: Number(e.target.value) })} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#aaa", cursor: "pointer" }}>
                <input type="checkbox" checked={ts.textBold ?? false}
                  onChange={e => saveTextPatch({ textBold: e.target.checked })} />
                <span>Bold</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
                <span>Angle°</span>
                <input type="number" min={-180} max={180} value={ts.textAngle ?? 0}
                  style={{ background: "#111", border: "1px solid #444", borderRadius: 6, color: "#fff", fontSize: 12, padding: "4px 6px", width: 54 }}
                  onChange={e => saveTextPatch({ textAngle: Number(e.target.value) })} />
              </label>
              <button onClick={() => setTextEditId(null)}
                style={{ background: "none", border: "1px solid #555", borderRadius: 6, color: "#aaa", cursor: "pointer", padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>
          );
        })()}

        {/* Row edit popup (triggered by clicking row label on canvas) */}
        {editingRow && (() => {
          const row = focSec?.rows?.find(r => r.id === editingRow.id);
          if (!row) return null;
          return (
            <div onMouseDown={e => e.stopPropagation()} style={{
              position: "fixed", left: editingRow.screenX - 90, top: editingRow.screenY - 60,
              background: "#1a1a1a", border: "1px solid #534AB7", borderRadius: 8,
              padding: "12px 14px", zIndex: 30, boxShadow: "0 4px 16px rgba(0,0,0,0.5)", minWidth: 210,
            }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Row · {focSec?.seats?.filter(s => s.rowId === row.id).length ?? 0} seats</div>
              <input autoFocus value={editingRow.value}
                onChange={e => setEditingRow(p => p ? { ...p, value: e.target.value } : null)}
                onKeyDown={e => { if (e.key === "Enter") saveRowRename(); if (e.key === "Escape") setEditingRow(null); }}
                style={{ ...inp, marginBottom: 8 }} placeholder="Row name" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: "#666" }}>
                  Curve
                  <input type="number" value={row.curve}
                    onChange={e => updRowTransform(editingRow.id, { curve: Number(e.target.value) })}
                    style={{ ...inp, padding: "3px 6px", fontSize: 11, marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 11, color: "#666" }}>
                  Skew
                  <input type="number" value={row.skew}
                    onChange={e => updRowTransform(editingRow.id, { skew: Number(e.target.value) })}
                    style={{ ...inp, padding: "3px 6px", fontSize: 11, marginTop: 3 }} />
                </label>
              </div>
              <button onClick={() => {
                const cur = focSec?.rows?.find(r => r.id === editingRow.id);
                const curve = cur?.curve ?? 0, skew = cur?.skew ?? 0;
                setGlobalCurve(curve); setGlobalSkew(skew);
                applyGlobalTransform();
              }} style={{ ...sbtn, width: "100%", fontSize: 11, padding: "3px 0", marginBottom: 8, textAlign: "center" }}>
                Apply curve / skew to all rows
              </button>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveRowRename} style={{ ...pbtn, flex: 1, padding: "4px 10px", fontSize: 12 }}>Rename</button>
                <button onClick={() => setEditingRow(null)} style={{ ...sbtn, padding: "4px 10px", fontSize: 12 }}>✕</button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── File import modal ────────────────────────────────────────────── */}
      {importModal && (() => {
        const [,, svgW, svgH] = svgViewBox.split(" ").map(Number);
        const hasPreview = !!importModal.previewUrl;
        const closeModal = () => {
          if (importModal.previewUrl) URL.revokeObjectURL(importModal.previewUrl);
          setImportModal(null);
        };
        const SECTION_TYPES: DraftSection["sectionType"][] = [
          "RESERVED","GA","ACCESSIBLE","RESTRICTED","TABLE","STAGE",
          "BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN",
        ];
        const TYPE_COLORS: Record<string, string> = {
          RESERVED:"#534AB7",GA:"#1D9E75",ACCESSIBLE:"#4A90D9",RESTRICTED:"#c0392b",
          TABLE:"#8B6914",STAGE:"#C49A3C",BAR:"#A0522D",BATHROOM:"#2980b9",
          DANCING:"#9B59B6",PARKING:"#27AE60",STAIRS:"#7F8C8D",WALL:"#555566",
          DOOR:"#E67E22",CHECKIN:"#E74C3C",
        };
        return (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)",
            zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              background: "#1a1a1a", border: "1px solid #444", borderRadius: 12,
              width: hasPreview && importModal.stage === "preview" ? 960 : 680,
              maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column",
              boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
            }}>
              {/* Header */}
              <div style={{ padding: "14px 18px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {importModal.stage === "uploading" ? `Analyzing ${importModal.fileLabel}…` : importModal.stage === "saving" ? "Importing sections…" : `Import from ${importModal.fileLabel}`}
                </span>
                {importModal.stage === "preview" && (
                  <button onClick={closeModal} style={{ ...sbtn, padding: "2px 10px", fontSize: 12 }}>✕</button>
                )}
              </div>

              {/* Loading / saving */}
              {(importModal.stage === "uploading" || importModal.stage === "saving") && (
                <div style={{ padding: 36, textAlign: "center", color: "#888", fontSize: 13 }}>
                  {importModal.stage === "uploading" ? "Analyzing file…" : "Saving sections to map…"}
                  {importModal.stage === "uploading" && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>
                      {importElapsed}s elapsed
                      {importElapsed > 15 && <span style={{ color: "#c9a227" }}> — large file, still working…</span>}
                      {importElapsed > 60 && <span style={{ color: "#f09595" }}> — may time out at 110s</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Error banner */}
              {importModal.stage === "preview" && importModal.error && (
                <div style={{ padding: "10px 18px", background: "#2a1010", color: "#f09595", fontSize: 12, borderBottom: "1px solid #333" }}>
                  {importModal.error}
                </div>
              )}

              {/* Preview body */}
              {importModal.stage === "preview" && (
                <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

                  {/* Left: image with bbox overlays */}
                  {hasPreview && (
                    <div style={{ width: 380, flexShrink: 0, borderRight: "1px solid #333", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
                      <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "calc(85vh - 120px)" }}>
                        <img src={importModal.previewUrl} alt="venue"
                          style={{ display: "block", maxWidth: 356, maxHeight: "calc(85vh - 140px)", objectFit: "contain", borderRadius: 4 }} />
                        {importModal.sections.filter(s => s.include && s.bbox).map((sec, i) => {
                          const b = sec.bbox!;
                          return (
                            <div key={i} style={{
                              position: "absolute",
                              left: `${(b.left / svgW) * 100}%`,
                              top: `${(b.top / svgH) * 100}%`,
                              width: `${((b.right - b.left) / svgW) * 100}%`,
                              height: `${((b.bottom - b.top) / svgH) * 100}%`,
                              border: `2px solid ${TYPE_COLORS[sec.sectionType] ?? "#534AB7"}`,
                              borderRadius: 2,
                              background: `${TYPE_COLORS[sec.sectionType] ?? "#534AB7"}22`,
                              pointerEvents: "none",
                            }}>
                              <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "0 2px", borderRadius: 2, lineHeight: "12px", whiteSpace: "nowrap" }}>
                                {sec.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Right: section list */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
                    {importModal.warnings.length > 0 && (
                      <div style={{ color: "#c9a227", fontSize: 11, marginBottom: 10 }}>
                        {importModal.warnings.join(" · ")}
                      </div>
                    )}
                    {importModal.sections.length === 0 ? (
                      <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                        No sections detected. Try a clearer floor plan image.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
                          {importModal.sections.filter(s => s.include).length} of {importModal.sections.length} sections selected
                        </div>
                        {importModal.sections.map((sec, i) => (
                          <div key={i} style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 8px", borderRadius: 6, marginBottom: 4,
                            background: sec.include ? "#1e1e2e" : "#161616",
                            border: "1px solid", borderColor: sec.include ? "#534AB7" : "#2a2a2a",
                          }}>
                            <input type="checkbox" checked={sec.include}
                              onChange={e => setImportModal(m => m ? {
                                ...m, sections: m.sections.map((s, j) => j === i ? { ...s, include: e.target.checked } : s)
                              } : null)} />
                            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.name}</span>
                            <select
                              value={sec.sectionType}
                              onChange={e => setImportModal(m => m ? {
                                ...m, sections: m.sections.map((s, j) => j === i ? { ...s, sectionType: e.target.value as DraftSection["sectionType"] } : s)
                              } : null)}
                              style={{ fontSize: 11, background: "#222", color: "#ccc", border: "1px solid #444", borderRadius: 4, padding: "2px 4px", cursor: "pointer" }}>
                              {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <span style={{ fontSize: 11, color: "#666", minWidth: 60, textAlign: "right" }}>
                              {sec.estimatedSeats > 0 ? `~${sec.estimatedSeats}` : "—"}
                            </span>
                            {sec.confidence < 0.7 && (
                              <span title={`Low confidence (${Math.round(sec.confidence * 100)}%)`}
                                style={{ fontSize: 12, color: "#c9a227" }}>⚠</span>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Footer */}
              {importModal.stage === "preview" && (
                <div style={{ padding: "12px 18px", borderTop: "1px solid #333", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={closeModal} style={sbtn}>Cancel</button>
                  <button
                    onClick={handleImportConfirm}
                    disabled={importModal.sections.filter(s => s.include).length === 0}
                    style={{ ...pbtn, opacity: importModal.sections.filter(s => s.include).length === 0 ? 0.4 : 1 }}>
                    Import {importModal.sections.filter(s => s.include).length} sections
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
