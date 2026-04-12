import React from "react";

// ── Types ──────────────────────────────────────────────────────────────────
export type SeatShapeType = "circle" | "square" | "triangle" | "chair" | "wheelchair";
export type TableShape = "rectangle" | "round" | "square" | "oval" | "booth";
export interface TableMeta { shape: TableShape; w: number; h: number; cpl: number; cps: number; angle: number; selectMode?: "whole" | "seat" }
export interface DoorMeta { w: number; h: number; angle: number }

export interface Point { x: number; y: number }
export interface SeatDot {
  id: string; x: number; y: number;
  seatNumber: string; rowLabel: string; rowId: string;
  shape?: SeatShapeType;
  zoneId?: string;  // per-seat pricing zone (overrides section-level zone)
}
export interface RowInfo { id: string; label: string; curve: number; skew: number; }
export interface DraftSection {
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
  customSvg?: string;    // data URL or "preset:TYPE" or "none" — marks this as a custom object
  customColor?: string;  // hex color override for the polygon fill/stroke/icon (custom objects)
  noOrphanSeats?: boolean; // SeatMap: prevent leaving a single isolated available seat in a row
}
export interface Zone { id: string; name: string; color: string }
export interface MapHold { id: string; name: string; color: string; seats: { seatId: string }[] }
export interface MapEditorProps {
  mapId: string; svgViewBox: string;
  bgImageUrl?: string; initialZones?: Zone[];
}
export type Tool = "select" | "polygon" | "seated" | "table" | "object" | "text";

// ── Venue object types ─────────────────────────────────────────────────────
export const VENUE_OBJECT_TYPES = ["STAGE","BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN"] as const;
export type VenueObjectType = typeof VENUE_OBJECT_TYPES[number];
export const VENUE_OBJECT_CFG: Record<VenueObjectType, { label: string; color: string }> = {
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
export function isVenueObject(type: string): type is VenueObjectType {
  if (type === "TEXT") return false;
  return (VENUE_OBJECT_TYPES as readonly string[]).includes(type);
}

// ── Constants ──────────────────────────────────────────────────────────────
export const MIN_ZOOM = 0.15, MAX_ZOOM = 8;

// ── Helpers ────────────────────────────────────────────────────────────────
export function pointsToPath(pts: Point[]) {
  if (pts.length < 2) return "";
  return "M " + pts.map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
}
export function pathToPoints(path: string): Point[] {
  const nums = path.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}
export function centroid(pts: Point[]): Point {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}
export function polyBBox(pts: Point[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
// Bounding box that accounts for bezier curve bulge on each edge
export function curvedBBox(pts: Point[], curve: number) {
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
export function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
// Compute a font size that makes text fit inside a bounding box with padding
export function labelFontSize(text: string, bbox: { minX: number; maxX: number; minY: number; maxY: number }, max = 14, min = 7): number {
  const availW = (bbox.maxX - bbox.minX) * 0.78;
  const availH = (bbox.maxY - bbox.minY) * 0.52;
  const byWidth = availW / Math.max(1, text.length * 0.58);
  return Math.max(min, Math.min(max, byWidth, availH));
}
export function rectContains(r: { x1: number; y1: number; x2: number; y2: number }, pt: Point) {
  return pt.x >= Math.min(r.x1, r.x2) && pt.x <= Math.max(r.x1, r.x2)
      && pt.y >= Math.min(r.y1, r.y2) && pt.y <= Math.max(r.y1, r.y2);
}

// ── Curved polygon path (quadratic bezier edges) ──────────────────────────
export function curvedPath(pts: Point[], curve: number): string {
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
export function getDisplaySeats(seats: SeatDot[], rows: RowInfo[]): SeatDot[] {
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
export function reshapeToFitSeats(displaySeats: SeatDot[], PAD = 16): Point[] {
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
export function renderSeat(
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

export function rotateAround(pts: Point[], cx: number, cy: number, angleDeg: number): Point[] {
  if (angleDeg === 0) return pts;
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return pts.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

export function computeChairPositions(meta: TableMeta, cx: number, cy: number): Point[] {
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

export function tableBoundingPoints(meta: TableMeta, cx: number, cy: number): Point[] {
  const PAD = 30; // chair clearance
  const hw = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.w) / 2 + PAD;
  const hh = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.h) / 2 + PAD;
  const corners = [
    { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
  ];
  return rotateAround(corners, cx, cy, meta.angle);
}

export function tableBodyPath(meta: TableMeta, cx: number, cy: number): string {
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
export function doorRectPoints(cx: number, cy: number, w: number, h: number, angle: number): Point[] {
  const hw = w / 2, hh = h / 2;
  const corners: Point[] = [
    { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
  ];
  return rotateAround(corners, cx, cy, angle);
}

export function doorMetaFromPoints(points: Point[], prevAngle: number): DoorMeta {
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
export function renderTableGraphic(
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
export function renderVenueIcon(type: VenueObjectType, color: string, size: number): React.ReactNode {
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
