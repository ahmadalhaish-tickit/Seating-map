import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useGesture } from "@use-gesture/react";
import { io, Socket } from "socket.io-client";

// ── Types ──────────────────────────────────────────────────────────────────
type SeatStatus = "AVAILABLE" | "HELD" | "RESERVED" | "SOLD" | "BLOCKED";
type SeatInventory = Record<string, SeatStatus>;
type SeatShapeType = "circle" | "square" | "triangle" | "chair" | "wheelchair";
type TableShape = "rectangle" | "round" | "square" | "oval" | "booth";
interface TableMeta { shape: TableShape; w: number; h: number; cpl: number; cps: number; angle: number; selectMode?: "whole" | "seat" }

interface Seat {
  id: string; rowId: string; seatNumber: string;
  x: number; y: number;
  isAccessible: boolean; isObstructed: boolean; notes?: string | null;
}
interface Row { id: string; label: string; curve: number; skew: number; seats: Seat[]; }
interface PricingZone { id: string; name: string; color: string; sortOrder: number; }
type VenueObjectType = "STAGE"|"BAR"|"BATHROOM"|"DANCING"|"PARKING"|"STAIRS"|"WALL"|"DOOR"|"CHECKIN"|"TEXT";
const VENUE_OBJECT_COLORS: Record<VenueObjectType, string> = {
  STAGE:"#C49A3C", BAR:"#A0522D", BATHROOM:"#4A90D9", DANCING:"#9B59B6",
  PARKING:"#27AE60", STAIRS:"#7F8C8D", WALL:"#555566", DOOR:"#E67E22", CHECKIN:"#E74C3C", TEXT:"#ffffff",
};
const VENUE_OBJECT_TYPES = new Set<string>(["STAGE","BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN","TEXT"]);

interface Section {
  id: string; name: string; label: string;
  sectionType: "RESERVED"|"GA"|"ACCESSIBLE"|"RESTRICTED"|"TABLE"|VenueObjectType;
  polygonPath: string;
  notes?: string | null;
  rows: Row[];
  zoneMappings: { zoneId: string }[];
}
interface MapHold { id: string; name: string; color: string; seats: { seatId: string }[] }
interface FullMap {
  id: string; svgViewBox: string; bgImageUrl?: string;
  sections: Section[];
  pricingZones: PricingZone[];
  mapHolds: MapHold[];
}
interface SeatMapProps {
  mapId: string; eventId: string; sessionId: string;
  onSelectionChange?: (ids: string[]) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_ZOOM = 0.4, MAX_ZOOM = 4;
const STATUS_COLORS: Record<SeatStatus, string> = {
  AVAILABLE: "#1D9E75", HELD: "#BA7517",
  RESERVED: "#D85A30", SOLD: "#888780", BLOCKED: "#888780",
};
// ── Geometry helpers ───────────────────────────────────────────────────────
interface Point { x: number; y: number }

function pathPoints(polygonPath: string): Point[] {
  const nums = polygonPath.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}
function centroid(polygonPath: string): Point {
  const pts = pathPoints(polygonPath);
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}
function pathBBox(polygonPath: string) {
  const pts = pathPoints(polygonPath);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
function curvedPath(pts: Point[], curve: number): string {
  if (Math.abs(curve) < 0.5 || pts.length < 2) {
    return "M " + pts.map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
  }
  const n = pts.length;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    d += ` Q ${mx + curve * (-dy / len)} ${my + curve * (dx / len)} ${p2.x} ${p2.y}`;
  }
  return d;
}

function labelFontSize(text: string, bbox: ReturnType<typeof pathBBox>, max = 14, min = 7): number {
  const availW = (bbox.maxX - bbox.minX) * 0.78;
  const availH = (bbox.maxY - bbox.minY) * 0.52;
  return Math.max(min, Math.min(max, availW / Math.max(1, text.length * 0.58), availH));
}

// Returns true if the proposed add/remove action would leave an isolated available seat in the row.
// Only MIDDLE seats (those with a real neighbour on both sides) can be orphaned.
// End-of-row seats are never orphans: a single available seat at the start or end of a row
// is still accessible and won't block future buyers.
function wouldCreateOrphan(
  seatId: string,
  action: "add" | "remove",
  row: Row,
  currentSelected: Set<string>,
  inventory: SeatInventory,
  holdMap: Map<string, { id: string }>
): boolean {
  if (row.seats.length < 3) return false; // need ≥3 seats for a middle orphan to exist
  // Sort by seat number (numeric) so adjacency reflects physical order
  const sorted = [...row.seats].sort((a, b) => {
    const na = parseInt(a.seatNumber), nb = parseInt(b.seatNumber);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.x - b.x;
  });
  const simSelected = new Set(currentSelected);
  if (action === "add") simSelected.add(seatId);
  else simSelected.delete(seatId);
  const isTaken = (s: Seat): boolean => {
    // The seat being released must be treated as available regardless of inventory:
    // inventory[seatId] is still "HELD" until the server processes the release,
    // so without this carve-out the seat would appear taken and the orphan check would skip it.
    if (action === "remove" && s.id === seatId) return false;
    return (
      simSelected.has(s.id) ||
      holdMap.has(s.id) ||
      (inventory[s.id] !== undefined && inventory[s.id] !== "AVAILABLE")
    );
  };
  // Only iterate over seats that have a real left AND right neighbour (skip first and last)
  for (let i = 1; i < sorted.length - 1; i++) {
    if (isTaken(sorted[i])) continue; // seat is already taken — not an orphan candidate
    if (isTaken(sorted[i - 1]) && isTaken(sorted[i + 1])) return true;
  }
  return false;
}

// ── Table geometry ─────────────────────────────────────────────────────────


function tableBodyPath(meta: TableMeta, cx: number, cy: number): string {
  const { shape, w, h } = meta;
  const hw = (shape === "square" ? Math.min(w, h) : w) / 2;
  const hh = (shape === "square" ? Math.min(w, h) : h) / 2;
  if (shape === "round") {
    const r = Math.min(hw, hh);
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} Z`;
  }
  if (shape === "oval") {
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

// ── Seat shape renderer ────────────────────────────────────────────────────
function renderSeat(
  x: number, y: number, shape: SeatShapeType, r: number,
  fill: string, stroke: string, sw: number
): React.ReactNode {
  switch (shape) {
    case "circle":
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "triangle":
      return <polygon points={`${x},${y - r} ${x - r * 0.87},${y + r * 0.5} ${x + r * 0.87},${y + r * 0.5}`}
        fill={fill} stroke={stroke} strokeWidth={sw} style={{ pointerEvents: "none" }} />;
    case "chair":
      return <g style={{ pointerEvents: "none" }}>
        <rect x={x - r * 0.75} y={y - r * 1.1} width={r * 1.5} height={r * 0.65} rx={1.5} fill={fill} stroke={stroke} strokeWidth={sw} />
        <rect x={x - r * 0.75} y={y - r * 0.35} width={r * 1.5} height={r * 1.1} rx={1.5} fill={fill} stroke={stroke} strokeWidth={sw} />
      </g>;
    case "wheelchair": {
      // Use fill as the icon color — stroke may be "none" for non-selected seats
      const wc = fill;
      const wsw = Math.max(sw, 1.2);
      return <g style={{ pointerEvents: "none" }}>
        <circle cx={x} cy={y - r * 0.7} r={r * 0.3} fill={wc} stroke="none" />
        <path d={`M${x} ${y - r * 0.4} L${x} ${y + r * 0.35} L${x + r * 0.65} ${y + r * 0.35}`}
          fill="none" stroke={wc} strokeWidth={wsw * 1.3} strokeLinecap="round" />
        <path d={`M${x - r * 0.15} ${y - r * 0.05} L${x - r * 0.55} ${y + r * 0.35}`}
          fill="none" stroke={wc} strokeWidth={wsw * 1.3} strokeLinecap="round" />
        <circle cx={x - r * 0.15} cy={y + r * 0.75} r={r * 0.38} fill="none" stroke={wc} strokeWidth={wsw} />
        <circle cx={x + r * 0.65} cy={y + r * 0.75} r={r * 0.38} fill="none" stroke={wc} strokeWidth={wsw} />
      </g>;
    }
  }
}

// ── Venue object icons (same as MapEditor) ─────────────────────────────────
function renderVenueIcon(type: VenueObjectType, color: string, size: number): React.ReactNode {
  const s = size;
  const sw = Math.max(0.8, s * 0.06);
  const base = { stroke: color, strokeWidth: sw, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "STAGE": {
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
      const f = s / 256 * 0.25;
      return <g {...base} strokeWidth={sw * 0.4}>
        <path d={`M ${155.9*f} ${193*f} H ${34.1*f} V ${17.5*f} L ${255.6*f} ${-256*f} H ${-255.6*f} l ${225.8*f} ${272.6*f} v ${177.2*f} h ${-121*f} c ${-40.9*f} 0 ${-40.9*f} ${62.2*f} 0 ${62.2*f} h ${306.7*f} C ${197.6*f} ${255.1*f} ${197.6*f} ${193*f} ${155.9*f} ${193*f} Z`} fill={color+"25"} />
        <circle cx={40.1*f} cy={-102.7*f} r={39.2*f} fill={color+"55"} stroke="none" />
      </g>;
    }
    case "BATHROOM": {
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
      const f = s / 256 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-256, -256)`} fill={color} fillOpacity={0.85} stroke="none">
          <path d="M305.169,89.716V50.772c0-4.428-3.589-8.017-8.017-8.017h-26.188V8.017c0-4.428-3.589-8.017-8.017-8.017s-8.017,3.588-8.017,8.017v34.739h-26.188c-4.427,0-8.017,3.588-8.017,8.017v38.944C123.298,109.364,49.704,195.624,49.704,298.756C49.704,416.339,145.364,512,262.948,512c30.267,0,59.951-6.441,87.156-18.619l0.509,2.035c0.891,3.569,4.098,6.072,7.777,6.072c3.679,0,6.885-2.503,7.777-6.072l2.93-11.718c11.606-6.659,22.63-14.425,32.889-23.255c3.356-2.888,3.735-7.95,0.847-11.306c-2.888-3.355-7.95-3.736-11.306-0.847c-5.387,4.637-11.004,8.954-16.816,12.952l3.51-14.041l42.618-14.552c3.245-1.108,5.426-4.158,5.426-7.587c0-3.429-2.182-6.479-5.426-7.587l-42.618-14.552l-12.054-48.215c-0.891-3.569-4.098-6.072-7.777-6.072c-3.679,0-6.885,2.503-7.777,6.072l-12.054,48.215l-42.618,14.552c-3.245,1.108-5.426,4.158-5.426,7.587c0,3.429,2.182,6.479,5.426,7.587l42.618,14.552l7.588,30.351c-19.241,8.95-39.873,14.777-61.103,17.171c5.623-10.129,10.552-24.753,14.858-43.997c0.966-4.322-1.752-8.608-6.073-9.574c-4.319-0.96-8.607,1.754-9.573,6.073c-8.901,39.786-18.608,48.741-21.307,48.741c-2.903,0-13.248-9.87-22.385-53.728c-0.546-2.623-1.074-5.31-1.586-8.05c7.906,0.559,15.903,0.851,23.971,0.851c4.427,0,8.017-3.588,8.017-8.017c0-4.428-3.589-8.017-8.017-8.017c-9.016,0-17.934-0.378-26.716-1.104c-3.151-20.793-5.426-44.123-6.731-68.935c10.96,0.37,22.135,0.561,33.447,0.561c11.306,0,22.473-0.191,33.427-0.56c-0.93,17.595-2.344,34.561-4.221,50.359c-0.523,4.396,2.619,8.384,7.015,8.906c4.389,0.528,8.383-2.619,8.907-7.015c1.972-16.595,3.442-34.437,4.389-52.929c27.632-1.408,53.55-3.996,76.364-7.642c-2.282,16.076-5.891,31.656-10.828,46.598c-1.389,4.204,0.894,8.738,5.098,10.127c4.2,1.391,8.737-0.893,10.127-5.098c5.767-17.456,9.823-35.711,12.166-54.568c1.452-0.286,2.89-0.575,4.309-0.87c20.226-4.214,35.736-9.071,46.68-14.631c-7.522,23.029-26.099,44.285-54.132,61.42c-3.779,2.309-4.968,7.243-2.659,11.021c2.309,3.779,7.243,4.968,11.021,2.659c14.915-9.117,27.455-19.375,37.455-30.485c-4.532,12.338-10.291,24.24-17.26,35.51c-2.329,3.765-1.164,8.706,2.602,11.034c3.765,2.327,8.706,1.163,11.035-2.603c20.771-33.588,31.75-72.319,31.75-112.006C476.192,195.624,402.598,109.364,305.169,89.716z"/>
        </g>
      );
    }
    case "PARKING": {
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
      const f = s / 12 * 0.72;
      return (
        <g transform={`scale(${f}) translate(-12, -12)`} fill={color} fillOpacity={0.85} stroke="none">
          <path fillRule="evenodd" clipRule="evenodd" d="M5 8a1 1 0 0 1-2 0V5.923c0-.76.082-1.185.319-1.627.223-.419.558-.754.977-.977C4.738 3.082 5.162 3 5.923 3H8a1 1 0 0 1 0 2H5.923c-.459 0-.57.022-.684.082a.364.364 0 0 0-.157.157c-.06.113-.082.225-.082.684V8zm3 11a1 1 0 1 1 0 2H5.923c-.76 0-1.185-.082-1.627-.319a2.363 2.363 0 0 1-.977-.977C3.082 19.262 3 18.077V16a1 1 0 1 1 2 0v2.077c0 .459.022.57.082.684.038.07.087.12.157.157.113.06.225.082.684.082H8zm7-15a1 1 0 0 0 1 1h2.077c.459 0 .57.022.684.082.07.038.12.087.157.157.06.113.082.225.082.684V8a1 1 0 1 0 2 0V5.923c0-.76-.082-1.185-.319-1.627a2.363 2.363 0 0 0-.977-.977C19.262 3.082 18.838 3 18.077 3H16a1 1 0 0 0-1 1zm4 12a1 1 0 1 1 2 0v2.077c0 .76-.082 1.185-.319 1.627a2.364 2.364 0 0 1-.977.977c-.442.237-.866.319-1.627.319H16a1 1 0 1 1 0-2h2.077c.459 0 .57-.022.684-.082a.363.363 0 0 0 .157-.157c.06-.113.082-.225.082-.684V16zM3 11a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3z"/>
        </g>
      );
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SeatMap({ mapId, eventId, sessionId, onSelectionChange }: SeatMapProps) {
  const [mapData, setMapData]     = useState<FullMap | null>(null);
  const [inventory, setInventory] = useState<SeatInventory>({});
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [hovered, setHovered]     = useState<{ seat: Seat; rowLabel?: string; sectionName?: string; zoneName?: string; zoneColor?: string; holdName?: string; x: number; y: number } | null>(null);
  const [hoveredGA, setHoveredGA] = useState<{ name: string; zoneName?: string; zoneColor?: string; x: number; y: number } | null>(null);
  const [gaSelections, setGaSelections] = useState<Record<string, number>>({});
  const [gaPopup, setGaPopup] = useState<{ sectionId: string; sectionName: string; capacity?: number; maxPerOrder?: number; zoneName?: string; zoneColor?: string; qty: number; x: number; y: number } | null>(null);
  const gaSelectionsRef = useRef<Record<string, number>>({});
  useEffect(() => { gaSelectionsRef.current = gaSelections; }, [gaSelections]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [toast, setToast] = useState<{ msg: string; type: "warn" | "error" } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef    = useRef<Socket | null>(null);

  const showToast = useCallback((msg: string, type: "warn" | "error" = "warn") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const zoneForSection = useCallback((s: Section) =>
    mapData?.pricingZones.find(z => z.id === s.zoneMappings[0]?.zoneId),
  [mapData]);

  // seatId → zoneId lookup — per-seat zone (from notes JSON) takes priority over section zone
  const seatZoneMap = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const s of mapData?.sections ?? []) {
      const sectionZid = s.zoneMappings[0]?.zoneId;
      for (const row of s.rows) for (const seat of row.seats) {
        let perSeatZid: string | undefined;
        if (seat.notes) {
          try { const p = JSON.parse(seat.notes); if (p.z) perSeatZid = p.z; } catch {}
        }
        m.set(seat.id, perSeatZid ?? sectionZid);
      }
    }
    return m;
  }, [mapData]);

  // sectionId → noOrphanSeats flag
  const noOrphanMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of mapData?.sections ?? []) {
      if (!s.notes) continue;
      try { const p = JSON.parse(s.notes); if (p.noOrphanSeats) m.set(s.id, true); } catch {}
    }
    return m;
  }, [mapData]);

  // seatId → hold info (for rendering held seats as blocked)
  const seatHoldMap = useMemo(() => {
    const m = new Map<string, MapHold>();
    for (const hold of mapData?.mapHolds ?? []) {
      for (const { seatId } of hold.seats) m.set(seatId, hold);
    }
    return m;
  }, [mapData]);

  // Track which zone is currently "locked in" by the selection
  const lockedZoneIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selected.size > 0) {
      lockedZoneIdRef.current = seatZoneMap.get([...selected][0]);
    } else if (Object.keys(gaSelections).length > 0) {
      const sid = Object.keys(gaSelections)[0];
      lockedZoneIdRef.current = mapData?.sections.find(s => s.id === sid)?.zoneMappings[0]?.zoneId;
    } else {
      lockedZoneIdRef.current = undefined;
    }
  }, [selected, gaSelections, seatZoneMap, mapData]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/maps/${mapId}`).then(r => r.json()),
      fetch(`/api/events/${eventId}/inventory`).then(r => r.json()),
    ]).then(([map, inv]) => { setMapData(map); setInventory(inv); });
  }, [mapId, eventId]);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL || "http://localhost:3001", { auth: { sessionId } });
    socketRef.current = socket;
    socket.emit("event:join", eventId);
    socket.on("seat:update", ({ seatId, status }: { seatId: string; status: SeatStatus }) =>
      setInventory(p => ({ ...p, [seatId]: status })));
    socket.on("seat:stale", () =>
      fetch(`/api/events/${eventId}/inventory`).then(r => r.json()).then(setInventory));
    socket.on("holds:expired", () =>
      fetch(`/api/events/${eventId}/inventory`).then(r => r.json()).then(setInventory));
    return () => { socket.emit("event:leave", eventId); socket.disconnect(); };
  }, [eventId, sessionId]);

  useGesture({
    onDrag: ({ delta: [dx, dy] }) =>
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy })),
    onPinch: ({ origin, da: [d], memo }) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const ox = origin[0] - rect.left, oy = origin[1] - rect.top;
      const prevScale = memo?.scale ?? transform.scale;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevScale * (d / (memo?.d ?? d))));
      const sf = newScale / prevScale;
      setTransform(t => ({ scale: newScale, x: ox - sf*(ox-t.x), y: oy - sf*(oy-t.y) }));
      return { scale: newScale, d };
    },
    onWheel: ({ delta: [,dy], event }) => {
      event.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const ox = (event as WheelEvent).clientX - rect.left;
      const oy = (event as WheelEvent).clientY - rect.top;
      setTransform(t => {
        const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * (1 - dy*0.001)));
        const sf = ns / t.scale;
        return { scale: ns, x: ox - sf*(ox-t.x), y: oy - sf*(oy-t.y) };
      });
    },
  }, { target: containerRef, drag: { filterTaps: true },
    pinch: { scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM } },
    wheel: { eventOptions: { passive: false } } });

  const fitToContent = useCallback(() => {
    if (!mapData || !containerRef.current) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const section of mapData.sections) {
      for (const p of pathPoints(section.polygonPath)) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      for (const row of section.rows) {
        const n = row.seats.length;
        row.seats.forEach((seat, si) => {
          const t = n > 1 ? si / (n - 1) : 0.5;
          const sy = seat.y + (row.curve ?? 0) * (1 - (2 * t - 1) ** 2) + (row.skew ?? 0) * (t - 0.5);
          if (seat.x < minX) minX = seat.x; if (seat.x > maxX) maxX = seat.x;
          if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
        });
      }
    }
    if (!isFinite(minX)) {
      const [,,vw,vh] = mapData.svgViewBox.split(" ").map(Number);
      const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
      const scale = Math.min(cw/vw, ch/vh) * 0.9;
      setTransform({ scale, x: (cw-vw*scale)/2, y: (ch-vh*scale)/2 });
      return;
    }
    const pad = 60;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
      Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxY - minY))
    ));
    setTransform({ scale, x: (cw - (maxX - minX) * scale) / 2 - minX * scale, y: (ch - (maxY - minY) * scale) / 2 - minY * scale });
  }, [mapData]);

  useEffect(() => { if (mapData) fitToContent(); }, [mapData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeatClick = useCallback(async (seat: Seat, e: React.MouseEvent) => {
    e.stopPropagation();
    if (seatZoneMap.get(seat.id) === undefined) return;  // no zone assigned → not purchasable
    const status = inventory[seat.id] ?? "AVAILABLE";
    if (status === "SOLD" || status === "BLOCKED") return;
    // Find the section + row for orphan check
    const seatSection = mapData?.sections.find(s => s.rows.some(r => r.seats.some(st => st.id === seat.id)));
    const seatRow = seatSection?.rows.find(r => r.seats.some(st => st.id === seat.id));
    if (selected.has(seat.id)) {
      // Deselect: check if removing this seat would orphan another
      if (seatSection && seatRow && noOrphanMap.get(seatSection.id)) {
        if (wouldCreateOrphan(seat.id, "remove", seatRow, selected, inventory, seatHoldMap)) {
          showToast("Deselecting this seat would leave an isolated seat with no available neighbours.");
          return;
        }
      }
      setSelected(p => { const s = new Set(p); s.delete(seat.id); onSelectionChange?.([...s]); return s; });
      socketRef.current?.emit("seat:release", { eventId, seatId: seat.id });
      return;
    }
    if (status !== "AVAILABLE") return;
    // Zone restriction: block if seat is from a different zone than current selection
    if (lockedZoneIdRef.current !== undefined) {
      const seatZone = seatZoneMap.get(seat.id);
      if (seatZone !== lockedZoneIdRef.current) {
        const lockedZone = mapData?.pricingZones.find(z => z.id === lockedZoneIdRef.current);
        showToast(`You can only select seats from the same zone. Your current selection is in "${lockedZone?.name ?? "a different zone"}".`);
        return;
      }
    }
    // No-orphan check: block selection if it would isolate a neighbour
    if (seatSection && seatRow && noOrphanMap.get(seatSection.id)) {
      if (wouldCreateOrphan(seat.id, "add", seatRow, selected, inventory, seatHoldMap)) {
        showToast("Selecting this seat would leave an isolated seat with no available neighbours.");
        return;
      }
    }
    socketRef.current?.emit("seat:hold", { eventId, seatId: seat.id },
      (res: { ok: boolean }) => {
        if (res.ok) setSelected(p => {
          const s = new Set(p); s.add(seat.id);
          onSelectionChange?.([...s]); return s;
        });
      });
  }, [inventory, selected, eventId, onSelectionChange, seatZoneMap, noOrphanMap, seatHoldMap, mapData, showToast]);

  const handleTableClick = useCallback(async (section: Section, seat: Seat, allSeats: Seat[], meta: TableMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    if (meta.selectMode !== "whole") {
      handleSeatClick(seat, e);
      return;
    }
    // No zone assigned → table not purchasable
    if (!section.zoneMappings[0]?.zoneId) return;
    // Zone restriction for whole-table mode
    if (lockedZoneIdRef.current !== undefined) {
      const tableZone = section.zoneMappings[0]?.zoneId;
      if (tableZone !== lockedZoneIdRef.current) return;
    }
    // Whole table: toggle all available chairs
    const anySelected = allSeats.some(s => selected.has(s.id));
    if (anySelected) {
      // Release all
      const toRelease = allSeats.filter(s => selected.has(s.id));
      setSelected(p => { const n = new Set(p); toRelease.forEach(s => n.delete(s.id)); onSelectionChange?.([...n]); return n; });
      toRelease.forEach(s => socketRef.current?.emit("seat:release", { eventId, seatId: s.id }));
    } else {
      // Hold all available
      const toHold = allSeats.filter(s => (inventory[s.id] ?? "AVAILABLE") === "AVAILABLE");
      for (const s of toHold) {
        await new Promise<void>(resolve => {
          socketRef.current?.emit("seat:hold", { eventId, seatId: s.id }, (res: { ok: boolean }) => {
            if (res.ok) setSelected(p => { const n = new Set(p); n.add(s.id); onSelectionChange?.([...n]); return n; });
            resolve();
          });
        });
      }
    }
  }, [inventory, selected, eventId, onSelectionChange, handleSeatClick]);

  if (!mapData) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", background:"#fff", flexDirection:"column", gap:16 }}>
      <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:36, height:36, borderRadius:"50%", border:"3px solid #eee", borderTopColor:"#534AB7", animation:"_spin 0.8s linear infinite" }} />
      <span style={{ fontSize:13, color:"#999" }}>Loading map…</span>
    </div>
  );

  const [,,vw,vh] = mapData.svgViewBox.split(" ").map(Number);

  return (
    <div ref={containerRef} style={{ width:"100%", height:"100%", overflow:"hidden", position:"relative", cursor:"grab", touchAction:"none" }}>
      <style>{`@keyframes fadeInDown{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
      <svg viewBox={mapData.svgViewBox} width={vw} height={vh} overflow="visible" style={{
        position:"absolute",
        transform:`translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
        transformOrigin:"0 0", willChange:"transform",
      }}>
        {mapData.bgImageUrl && <image href={mapData.bgImageUrl} x="0" y="0" width={vw} height={vh} />}

        {/* ── Venue objects (behind everything) ── */}
        {mapData.sections.filter(s => VENUE_OBJECT_TYPES.has(s.sectionType)).map(section => {
          const color = VENUE_OBJECT_COLORS[section.sectionType as VenueObjectType];
          let notes: Record<string, unknown> = {};
          try { notes = JSON.parse(section.notes ?? "{}"); } catch {}

          // WALL — line
          if (section.sectionType === "WALL") {
            const nums = section.polygonPath.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
            if (nums.length < 4) return null;
            const [x1, y1, x2, y2] = nums;
            const mx = (x1+x2)/2, my = (y1+y2)/2;
            return (
              <g key={section.id} style={{ pointerEvents: "none" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={5} strokeLinecap="round" />
                {notes.showLabel !== false && <text x={mx} y={my - 8} textAnchor="middle" fontSize={10} fontWeight={500} fill={color+"cc"} style={{ userSelect:"none" }}>{section.name}</text>}
              </g>
            );
          }

          // DOOR
          if (section.sectionType === "DOOR") {
            const w = (notes.w as number) ?? 60;
            const h = (notes.h as number) ?? 90;
            const angle = (notes.angle as number) ?? 0;
            const labelOffset = (notes.labelOffset as {x:number;y:number}) ?? { x: 0, y: 0 };
            const c = centroid(section.polygonPath);
            return (
              <g key={section.id} style={{ pointerEvents: "none" }}>
                <g transform={`translate(${c.x},${c.y}) rotate(${angle}) scale(${w/64},${h/64}) translate(-32,-32)`}>
                  <rect x="0" y="0" width="64" height="64" fill={color+"18"} stroke="none" />
                  <polyline points="16 20 16 8 48 8 48 56 16 56 16 44" stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="28 40 36 32 28 24" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="8" y1="32" x2="36" y2="32" stroke={color} strokeWidth={2} strokeLinecap="round" />
                </g>
                {notes.showLabel !== false && <text x={c.x + labelOffset.x} y={c.y + h * 0.55 + labelOffset.y} textAnchor="middle" dominantBaseline="hanging" fontSize={(notes.labelSize as number) ?? Math.max(7, Math.min(11, w*0.18))} fontWeight={500} fill={color+"cc"} style={{ userSelect:"none" }}>{section.name}</text>}
              </g>
            );
          }

          // STAIRS
          if (section.sectionType === "STAIRS") {
            const w = (notes.w as number) ?? 100;
            const h = (notes.h as number) ?? 80;
            const angle = (notes.angle as number) ?? 0;
            const labelOffset = (notes.labelOffset as {x:number;y:number}) ?? { x: 0, y: 0 };
            const c = centroid(section.polygonPath);
            return (
              <g key={section.id} style={{ pointerEvents: "none" }}>
                <g transform={`translate(${c.x},${c.y}) rotate(${angle}) scale(${w/500},${h/500}) translate(-250,-250)`}>
                  <polygon points="160,98 361,98 413,403 87,403" fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" />
                  <line x1="154" y1="118" x2="366" y2="118" stroke={color} strokeWidth={2} />
                  <line x1="148" y1="140" x2="370" y2="140" stroke={color} strokeWidth={2} />
                  <line x1="141" y1="165" x2="375" y2="165" stroke={color} strokeWidth={2} />
                  <line x1="133" y1="191" x2="381" y2="191" stroke={color} strokeWidth={2} />
                  <line x1="123" y1="222" x2="388" y2="222" stroke={color} strokeWidth={2} />
                  <line x1="113" y1="257" x2="395" y2="257" stroke={color} strokeWidth={2} />
                  <line x1="101" y1="297" x2="403" y2="297" stroke={color} strokeWidth={2} />
                  <line x1="87"  y1="342" x2="413" y2="342" stroke={color} strokeWidth={2} />
                </g>
                {notes.showLabel !== false && <text x={c.x + labelOffset.x} y={c.y + h * 0.55 + labelOffset.y} textAnchor="middle" dominantBaseline="hanging" fontSize={(notes.labelSize as number) ?? Math.max(7, Math.min(11, w*0.18))} fontWeight={500} fill={color+"cc"} style={{ userSelect:"none" }}>{section.name}</text>}
              </g>
            );
          }

          // TEXT object — SVG text element at centroid
          if (section.sectionType === "TEXT") {
            const tColor = (notes.textColor as string) ?? "#ffffff";
            const tSize = (notes.labelSize as number) ?? 18;
            const tAngle = (notes.textAngle as number) ?? 0;
            const tBold = (notes.textBold as boolean) ?? false;
            const labelOffset = (notes.labelOffset as {x:number;y:number}) ?? { x: 0, y: 0 };
            const c = centroid(section.polygonPath);
            return (
              <g key={section.id} style={{ pointerEvents: "none" }}>
                <text
                  x={c.x + labelOffset.x} y={c.y + labelOffset.y}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={tSize} fontWeight={tBold ? 700 : 400} fill={tColor}
                  transform={tAngle !== 0 ? `rotate(${tAngle}, ${c.x + labelOffset.x}, ${c.y + labelOffset.y})` : undefined}
                  style={{ userSelect: "none" }}>
                  {section.name}
                </text>
              </g>
            );
          }

          // Other venue objects — polygon + icon + label
          const pts = pathPoints(section.polygonPath);
          const edgeCurve = (notes.edgeCurve as number) ?? 0;
          const d = Math.abs(edgeCurve) > 0.5 ? curvedPath(pts, edgeCurve) : section.polygonPath;
          const c = centroid(section.polygonPath);
          const iconOffset = (notes.iconOffset as {x:number;y:number}) ?? { x: 0, y: 0 };
          const labelOffset = (notes.labelOffset as {x:number;y:number}) ?? { x: 0, y: 0 };
          const stableSize = Math.sqrt(polyArea(pts));
          const iconSize = (notes.iconSize as number) ?? Math.max(10, stableSize * 0.32);
          const nameFontSize = (notes.labelSize as number) ?? Math.max(6, Math.min(11, stableSize * 0.13));
          return (
            <g key={section.id} style={{ pointerEvents: "none" }}>
              <path d={d} fill={color+"28"} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
              {notes.showIcon !== false && (
                <g transform={`translate(${c.x + iconOffset.x},${c.y + iconOffset.y})`}>
                  {renderVenueIcon(section.sectionType as VenueObjectType, color, iconSize)}
                </g>
              )}
              {notes.showLabel !== false && (
                <text x={c.x + labelOffset.x} y={c.y + iconSize * 0.55 + labelOffset.y}
                  textAnchor="middle" dominantBaseline="hanging"
                  fontSize={nameFontSize} fontWeight={500} fill={color+"cc"} style={{ userSelect:"none" }}>
                  {section.name}
                </text>
              )}
            </g>
          );
        })}

        {/* ── TABLE sections ── */}
        {mapData.sections.filter(s => s.sectionType === "TABLE").map(section => {
          const zone = zoneForSection(section);
          const color = zone?.color ?? "#888780";
          let meta: TableMeta = { shape: "rectangle", w: 120, h: 60, cpl: 4, cps: 2, angle: 0 };
          try { const p = JSON.parse(section.notes ?? "{}"); if (p.shape) meta = p as TableMeta; } catch {}
          const c = centroid(section.polygonPath);
          const hw = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.w) / 2;
          const hh = (meta.shape === "square" ? Math.min(meta.w, meta.h) : meta.h) / 2;
          const chairR = Math.max(4, Math.min(7, meta.w / 16));
          const chairs = section.rows[0]?.seats ?? [];

          return (
            <g key={section.id}>
              {/* Chairs (rendered behind table surface) */}
              {chairs.map(seat => {
                const holdInfo = seatHoldMap.get(seat.id);
                const st = holdInfo ? "BLOCKED" : (inventory[seat.id] ?? "AVAILABLE");
                const mine = selected.has(seat.id);
                const seatFill = holdInfo ? STATUS_COLORS.SOLD + "88" : (mine ? color : (st === "AVAILABLE" ? color + "99" : STATUS_COLORS[st]));
                const seatStroke = holdInfo ? STATUS_COLORS.SOLD : (mine ? "#fff" : (st === "AVAILABLE" ? color : STATUS_COLORS[st] + "aa"));
                const seatSW = mine ? 2.5 : 0.8;
                const _SHAPES_T = ["circle","square","triangle","chair","wheelchair"];
                const shape: SeatShapeType = !seat.notes ? "chair" : _SHAPES_T.includes(seat.notes) ? seat.notes as SeatShapeType : (() => { try { const p = JSON.parse(seat.notes!); return _SHAPES_T.includes(p.s ?? "") ? p.s : "chair"; } catch { return "chair"; } })();
                const ang = Math.atan2(seat.y - c.y, seat.x - c.x);
                const isClickable = !holdInfo && (st === "AVAILABLE" || mine) && !!zone;
                const hoverInfo = { seat, sectionName: section.name, zoneName: zone?.name, zoneColor: zone?.color, holdName: holdInfo?.name };
                if (shape === "chair") {
                  const dist = Math.hypot(seat.x - c.x, seat.y - c.y);
                  const bx = c.x + (dist + chairR * 0.5) * Math.cos(ang);
                  const by = c.y + (dist + chairR * 0.5) * Math.sin(ang);
                  return (
                    <g key={seat.id} style={{ cursor: isClickable ? "pointer" : "default" }}
                      onClick={e => handleTableClick(section, seat, chairs, meta, e)}
                      onMouseEnter={e => setHovered({ ...hoverInfo, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHovered(null)}>
                      <ellipse cx={seat.x} cy={seat.y} rx={chairR * 1.6} ry={chairR * 1.3} fill="transparent" stroke="none" style={{ pointerEvents:"all" }} />
                      <ellipse cx={bx} cy={by} rx={chairR * 0.9} ry={chairR * 0.35}
                        transform={`rotate(${ang * 180 / Math.PI + 90}, ${bx}, ${by})`}
                        fill={color+"55"} stroke={color+"aa"} strokeWidth={0.8} style={{ pointerEvents:"none" }} />
                      <ellipse cx={seat.x} cy={seat.y} rx={chairR} ry={chairR * 0.7}
                        transform={`rotate(${ang * 180 / Math.PI + 90}, ${seat.x}, ${seat.y})`}
                        fill={seatFill} stroke={seatStroke} strokeWidth={seatSW}
                        style={{ pointerEvents:"none" }} />
                    </g>
                  );
                }
                return (
                  <g key={seat.id} style={{ cursor: isClickable ? "pointer" : "default" }}
                    onClick={e => handleTableClick(section, seat, chairs, meta, e)}
                    onMouseEnter={e => setHovered({ ...hoverInfo, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHovered(null)}>
                    <circle cx={seat.x} cy={seat.y} r={chairR * 1.5} fill="transparent" stroke="none" style={{ pointerEvents:"all" }} />
                    {renderSeat(seat.x, seat.y, shape, chairR, seatFill, seatStroke, seatSW)}
                  </g>
                );
              })}
              {/* Table surface — clickable in whole-table mode */}
              <path d={tableBodyPath(meta, c.x, c.y)}
                transform={`rotate(${meta.angle}, ${c.x}, ${c.y})`}
                fill={color+"35"} stroke={color} strokeWidth={1.5}
                style={{ pointerEvents: meta.selectMode === "whole" ? "all" : "none", cursor: meta.selectMode === "whole" ? "pointer" : "default" }}
                onClick={meta.selectMode === "whole" && chairs.length > 0 ? e => handleTableClick(section, chairs[0], chairs, meta, e) : undefined} />
              {/* Wood grain */}
              {meta.shape !== "round" && meta.shape !== "oval" && (
                <g transform={`rotate(${meta.angle}, ${c.x}, ${c.y})`} style={{ pointerEvents:"none" }}>
                  {[-0.3, 0, 0.3].map(f => (
                    <line key={f} x1={c.x - hw * 0.85} y1={c.y + f * hh * 0.6}
                      x2={c.x + hw * 0.85} y2={c.y + f * hh * 0.6}
                      stroke={color+"22"} strokeWidth={0.8} />
                  ))}
                </g>
              )}
              {/* Table label */}
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central"
                transform={`rotate(${meta.angle}, ${c.x}, ${c.y})`}
                fontSize={Math.max(10, Math.min(14, meta.w / 8))} fontWeight={600}
                fill={color} style={{ pointerEvents: meta.selectMode === "whole" ? "all" : "none", cursor: meta.selectMode === "whole" ? "pointer" : "default", userSelect:"none" }}
                onClick={meta.selectMode === "whole" && chairs.length > 0 ? e => handleTableClick(section, chairs[0], chairs, meta, e) : undefined}>
                {section.label}
              </text>
            </g>
          );
        })}

        {/* ── Seating + GA sections ── */}
        {mapData.sections
          .filter(s => !VENUE_OBJECT_TYPES.has(s.sectionType) && s.sectionType !== "TABLE")
          .map(section => {
            const zone = zoneForSection(section);
            const color = zone?.color ?? "#888780";
            const bbox = pathBBox(section.polygonPath);
            let notes: Record<string, unknown> = {};
            try { notes = JSON.parse(section.notes ?? "{}"); } catch {}
            const edgeCurve = (notes.edgeCurve as number) ?? 0;
            const sectionSeatRadius = (notes.seatRadius as number) ?? 5;
            const labelOffset = (notes.labelOffset as { x: number; y: number }) ?? { x: 0, y: 0 };
            const labelSize = notes.labelSize as number | undefined;
            const pts = pathPoints(section.polygonPath);
            const polyPath = Math.abs(edgeCurve) > 0.5 ? curvedPath(pts, edgeCurve) : section.polygonPath;
            const isGA = section.sectionType === "GA" || section.rows.length === 0;
            // Match MapEditor: seated sections use mean of seat positions as anchor; GA uses polygon centroid
            const allSeatsFlat = !isGA ? section.rows.flatMap(r => r.seats) : [];
            const c = allSeatsFlat.length > 0
              ? { x: allSeatsFlat.reduce((s, seat) => s + seat.x, 0) / allSeatsFlat.length,
                  y: allSeatsFlat.reduce((s, seat) => s + seat.y, 0) / allSeatsFlat.length }
              : centroid(section.polygonPath);
            const capacity = notes.capacity as number | undefined;
            const maxPerOrder = notes.maxPerOrder as number | undefined;
            const hideSeats = (notes.hideSeats as boolean) === true;
            const isExpanded = expandedSections.has(section.id);

            // Has any seat a per-seat zone override?
            const hasMixedZones = !isGA && allSeatsFlat.some(seat => {
              if (!seat.notes) return false;
              try { const p = JSON.parse(seat.notes); return !!p.z; } catch { return false; }
            });
            // For mixed-zone sections: use the dominant per-seat zone color for the polygon
            const polyColor = hasMixedZones ? (() => {
              const counts = new Map<string, number>();
              for (const seat of allSeatsFlat) {
                if (!seat.notes) continue;
                try { const p = JSON.parse(seat.notes); if (p.z) counts.set(p.z, (counts.get(p.z) ?? 0) + 1); } catch {}
              }
              let topId = "", topCount = 0;
              counts.forEach((cnt, id) => { if (cnt > topCount) { topCount = cnt; topId = id; } });
              return mapData?.pricingZones.find(z => z.id === topId)?.color ?? color;
            })() : color;
            // Unique zones present in this section's seats (for collapsed palette)
            const sectionPerSeatZones = hasMixedZones ? (() => {
              const seen: string[] = [];
              for (const seat of allSeatsFlat) {
                if (!seat.notes) continue;
                try { const p = JSON.parse(seat.notes); if (p.z && !seen.includes(p.z)) seen.push(p.z); } catch {}
              }
              return seen.map(zid => mapData?.pricingZones.find(z => z.id === zid)).filter((z): z is { id: string; name: string; color: string; sortOrder: number; mapId: string } => z !== undefined);
            })() : [];

            return (
              <g key={section.id}>
                {/* GA polygon — hoverable for legend */}
                {isGA
                  ? <path d={polyPath} fill={gaSelections[section.id] ? color+"44" : color+"22"} stroke={color} strokeWidth={gaSelections[section.id] ? 2 : 1.5} strokeLinejoin="round"
                      style={{ cursor: "pointer" }}
                      onMouseEnter={e => setHoveredGA({ name: section.name, zoneName: zone?.name, zoneColor: zone?.color, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => setHoveredGA(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                      onMouseLeave={() => setHoveredGA(null)}
                      onClick={e => {
                        e.stopPropagation();
                        // Zone restriction: block GA from different zone
                        if (lockedZoneIdRef.current !== undefined && zone?.id !== lockedZoneIdRef.current) {
                          const lockedZone = mapData.pricingZones.find(z2 => z2.id === lockedZoneIdRef.current);
                          showToast(`You can only select seats from the same zone. Your current selection is in "${lockedZone?.name ?? "a different zone"}".`);
                          return;
                        }
                        setHoveredGA(null);
                        setGaPopup({ sectionId: section.id, sectionName: section.name, capacity, maxPerOrder, zoneName: zone?.name, zoneColor: zone?.color, qty: gaSelections[section.id] ?? 1, x: e.clientX, y: e.clientY });
                      }} />
                  : <path d={polyPath} fill={polyColor+(hideSeats && !isExpanded ? "33" : "22")} stroke={polyColor} strokeWidth={hideSeats ? 2 : 1.5} strokeLinejoin="round"
                      style={{ cursor: hideSeats ? "pointer" : "default", pointerEvents: hideSeats ? "all" : "none" }}
                      onClick={e => {
                        if (!hideSeats) return;
                        e.stopPropagation();
                        setExpandedSections(p => {
                          const n = new Set(p);
                          if (n.has(section.id)) n.delete(section.id); else n.add(section.id);
                          return n;
                        });
                      }} />
                }

                {/* Section label — hidden when seats are visible */}
                {(isGA || (hideSeats && !isExpanded) || allSeatsFlat.length === 0) && (
                  <text x={c.x + labelOffset.x} y={c.y + labelOffset.y + (capacity !== undefined && isGA ? -8 : 0)}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={labelSize ?? labelFontSize(section.label, bbox, 14, 7)} fontWeight={500}
                    fill={color} style={{ pointerEvents:"none", userSelect:"none" }}>
                    {section.label}
                  </text>
                )}

                {/* GA capacity badge */}
                {isGA && capacity !== undefined && (
                  <text x={c.x} y={c.y + 10} textAnchor="middle" dominantBaseline="central"
                    fontSize={9} fill={color+"88"} style={{ pointerEvents:"none", userSelect:"none" }}>
                    {capacity} spots
                  </text>
                )}

                {/* Zone palette — collapsed multi-zone sections */}
                {!isGA && hideSeats && !isExpanded && sectionPerSeatZones.length > 0 && (
                  <g style={{ pointerEvents: "none" }}>
                    {sectionPerSeatZones.slice(0, 6).map((z, i) => {
                      const total = Math.min(sectionPerSeatZones.length, 6);
                      const spacing = 10;
                      const lfs = labelSize ?? labelFontSize(section.label, bbox, 14, 7);
                      return <circle key={z.id}
                        cx={c.x + labelOffset.x - (total - 1) * spacing / 2 + i * spacing}
                        cy={c.y + labelOffset.y + lfs * 0.4 + 20}
                        r={4} fill={z.color} fillOpacity={0.85} />;
                    })}
                  </g>
                )}

                {/* Seats (RESERVED / ACCESSIBLE / RESTRICTED with rows) */}
                {!isGA && hideSeats && !isExpanded && (
                  <text x={c.x + labelOffset.x} y={c.y + labelOffset.y + (labelSize ?? labelFontSize(section.label, bbox, 14, 7)) * 0.6 + 10}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={9} fill={color+"99"} style={{ pointerEvents:"none", userSelect:"none" }}>
                    tap to expand
                  </text>
                )}
                {!isGA && (!hideSeats || isExpanded) && section.rows.flatMap(row =>
                  row.seats.map((seat, si) => {
                    // Apply row curve/skew offset (same formula as getDisplaySeats in editor)
                    const n = row.seats.length;
                    const t = n > 1 ? si / (n - 1) : 0.5;
                    const dy = (row.curve ?? 0) * (1 - (2 * t - 1) ** 2) + (row.skew ?? 0) * (t - 0.5);
                    const sx = seat.x, sy = seat.y + dy;
                    const holdInfo = seatHoldMap.get(seat.id);
                    const st = holdInfo ? "BLOCKED" : (inventory[seat.id] ?? "AVAILABLE");
                    const mine = selected.has(seat.id);
                    // Per-seat zone color: parse zone id from notes JSON, fall back to section color
                    let seatColor = color;
                    if (seat.notes) {
                      try {
                        const p = JSON.parse(seat.notes);
                        if (p.z) {
                          const sz = mapData?.pricingZones.find(z => z.id === p.z);
                          if (sz) seatColor = sz.color;
                        }
                      } catch {}
                    }
                    const seatFill = holdInfo ? STATUS_COLORS.SOLD + "88" : (mine ? seatColor : (st === "AVAILABLE" ? seatColor + "99" : STATUS_COLORS[st]));
                    const seatStroke = holdInfo ? STATUS_COLORS.SOLD : (mine ? "#fff" : (st === "AVAILABLE" ? seatColor : STATUS_COLORS[st] + "aa"));
                    const seatSW2 = mine ? 2.5 : 0.8;
                    const _SHAPES_S = ["circle","square","triangle","chair","wheelchair"];
                    const shape: SeatShapeType = !seat.notes ? "circle" : _SHAPES_S.includes(seat.notes) ? seat.notes as SeatShapeType : (() => { try { const p = JSON.parse(seat.notes!); return _SHAPES_S.includes(p.s ?? "") ? p.s : "circle"; } catch { return "circle"; } })();
                    const isClickable = !holdInfo && (st === "AVAILABLE" || mine) && seatZoneMap.get(seat.id) !== undefined;
                    return (
                      <g key={seat.id} style={{ cursor: isClickable ? "pointer" : "default" }}
                        onClick={e => handleSeatClick(seat, e)}
                        onMouseEnter={e => { let sn = zone?.name, sc = zone?.color; if (seat.notes) { try { const p = JSON.parse(seat.notes); if (p.z) { const sz = mapData?.pricingZones.find(z2 => z2.id === p.z); if (sz) { sn = sz.name; sc = sz.color; } } } catch {} } setHovered({ seat, rowLabel: row.label, sectionName: section.name, zoneName: sn, zoneColor: sc, holdName: holdInfo?.name, x: e.clientX, y: e.clientY }); }}
                        onMouseLeave={() => setHovered(null)}>
                        <circle cx={sx} cy={sy} r={sectionSeatRadius * 1.4} fill="transparent" stroke="none" style={{ pointerEvents:"all" }} />
                        {renderSeat(sx, sy, shape, sectionSeatRadius, seatFill, seatStroke, seatSW2)}
                      </g>
                    );
                  })
                )}
              </g>
            );
          })}
      </svg>

      {/* Seat hover tooltip */}
      {hovered && (
        <div style={{
          position:"fixed", left: hovered.x+14, top: hovered.y-10,
          background:"#1a1a2e", border:"1px solid #333", borderRadius:8, padding:"9px 13px",
          fontSize:12, pointerEvents:"none", zIndex:20, minWidth:150,
          boxShadow:"0 4px 14px rgba(0,0,0,0.35)", color:"#eee",
        }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:5 }}>
            Seat {hovered.seat.seatNumber}
          </div>
          {hovered.rowLabel && <div style={{ color:"#aaa", marginBottom:2 }}>Row {hovered.rowLabel}</div>}
          {hovered.sectionName && <div style={{ color:"#aaa", marginBottom:2 }}>{hovered.sectionName}</div>}
          {hovered.zoneName && (
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
              {hovered.zoneColor && <span style={{ width:8, height:8, borderRadius:"50%", background:hovered.zoneColor, display:"inline-block", flexShrink:0 }} />}
              <span style={{ color:"#aaa" }}>{hovered.zoneName}</span>
            </div>
          )}
          <div style={{
            fontSize:11, fontWeight:500, marginTop:2,
            color: hovered.holdName ? "#888780"
              : selected.has(hovered.seat.id) ? "#7F77DD"
              : inventory[hovered.seat.id] === "AVAILABLE" || !inventory[hovered.seat.id] ? "#1D9E75"
              : "#BA7517",
          }}>
            {hovered.holdName ? "Unavailable" : selected.has(hovered.seat.id) ? "Selected" : inventory[hovered.seat.id] ?? "AVAILABLE"}
          </div>
        </div>
      )}

      {/* GA popup — quantity picker */}
      {gaPopup && (
        <div style={{
          position:"fixed", left: Math.min(gaPopup.x, window.innerWidth - 260), top: Math.min(gaPopup.y, window.innerHeight - 200),
          background:"#1a1a2e", border:"1px solid #444", borderRadius:10, padding:"14px 16px",
          fontSize:13, zIndex:30, minWidth:240, boxShadow:"0 6px 24px rgba(0,0,0,0.45)", color:"#eee",
        }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{gaPopup.sectionName}</div>
          <div style={{ color:"#aaa", fontSize:12, marginBottom:2 }}>General Admission</div>
          {gaPopup.zoneName && (
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:10 }}>
              {gaPopup.zoneColor && <span style={{ width:8, height:8, borderRadius:"50%", background:gaPopup.zoneColor, display:"inline-block" }} />}
              <span style={{ color:"#aaa", fontSize:12 }}>{gaPopup.zoneName}</span>
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
            <span style={{ color:"#aaa", fontSize:12 }}>Quantity</span>
            <button onClick={() => setGaPopup(p => p ? { ...p, qty: Math.max(1, p.qty - 1) } : null)}
              style={{ width:28, height:28, borderRadius:6, border:"1px solid #444", background:"#333", color:"#fff", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
            <span style={{ fontSize:18, fontWeight:700, minWidth:28, textAlign:"center" }}>{gaPopup.qty}</span>
            <button onClick={() => setGaPopup(p => p ? { ...p, qty: Math.min(Math.min(p.maxPerOrder ?? 999, p.capacity ?? 999), p.qty + 1) } : null)}
              style={{ width:28, height:28, borderRadius:6, border:"1px solid #444", background:"#333", color:"#fff", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            {(gaPopup.maxPerOrder || gaPopup.capacity) && (
              <span style={{ color:"#555", fontSize:11 }}>
                max {gaPopup.maxPerOrder ? `${gaPopup.maxPerOrder} per order` : `${gaPopup.capacity} capacity`}
              </span>
            )}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { setGaSelections(p => { const n = {...p}; delete n[gaPopup.sectionId]; return n; }); setGaPopup(null); }}
              style={{ flex:1, padding:"6px 0", borderRadius:6, border:"1px solid #444", background:"transparent", color:"#aaa", cursor:"pointer", fontSize:12 }}>
              Cancel
            </button>
            <button onClick={() => { setGaSelections(p => ({ ...p, [gaPopup.sectionId]: gaPopup.qty })); setGaPopup(null); }}
              style={{ flex:1, padding:"6px 0", borderRadius:6, border:"none", background:"#534AB7", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:500 }}>
              Select {gaPopup.qty}
            </button>
          </div>
        </div>
      )}

      {/* GA section hover legend */}
      {hoveredGA && !gaPopup && (
        <div style={{
          position:"fixed", left: hoveredGA.x+14, top: hoveredGA.y-10,
          background:"#1a1a2e", border:"1px solid #333", borderRadius:8, padding:"9px 13px",
          fontSize:12, pointerEvents:"none", zIndex:20, minWidth:140,
          boxShadow:"0 4px 14px rgba(0,0,0,0.35)", color:"#eee",
        }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:5 }}>
            {hoveredGA.name}
          </div>
          <div style={{ color:"#aaa", marginBottom:2 }}>General Admission</div>
          {hoveredGA.zoneName && (
            <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:3 }}>
              {hoveredGA.zoneColor && <span style={{ width:8, height:8, borderRadius:"50%", background:hoveredGA.zoneColor, display:"inline-block", flexShrink:0 }} />}
              <span style={{ color:"#aaa" }}>{hoveredGA.zoneName}</span>
            </div>
          )}
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1a1a2e", border: `1px solid ${toast.type === "error" ? "#D85A30" : "#BA7517"}`,
          borderRadius: 10, padding: "10px 18px",
          fontSize: 13, color: "#eee", zIndex: 50, maxWidth: "70vw",
          boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", gap: 10, pointerEvents: "none",
          animation: "fadeInDown 0.18s ease",
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{toast.type === "error" ? "✕" : "⚠"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Selection bar */}
      {(selected.size > 0 || Object.keys(gaSelections).length > 0) && (
        <div style={{
          position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
          background:"#1a1a2e", border:"1px solid #444", borderRadius:10,
          padding:"10px 16px", display:"flex", alignItems:"center", gap:12,
          fontSize:13, color:"#eee", boxShadow:"0 4px 16px rgba(0,0,0,0.35)",
          zIndex:10, maxWidth:"80vw", flexWrap:"wrap", justifyContent:"center",
        }}>
          {selected.size > 0 && <span style={{ color:"#aaa" }}>{selected.size} seat{selected.size !== 1 ? "s" : ""}</span>}
          {Object.entries(gaSelections).map(([sid, qty]) => {
            const s = mapData.sections.find(x => x.id === sid);
            return s ? <span key={sid} style={{ color:"#aaa" }}>{qty}× {s.name}</span> : null;
          })}
          <button onClick={() => {
            selected.forEach(seatId => socketRef.current?.emit("seat:release", { eventId, seatId }));
            setSelected(new Set());
            setGaSelections({});
            onSelectionChange?.([]);
          }} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #555", background:"transparent", color:"#aaa", cursor:"pointer", fontSize:12 }}>
            Release all
          </button>
          {selected.size > 0 && (
            <button onClick={async () => {
              const ids = [...selected];
              const res = await fetch(`/api/dev/events/${eventId}/mark-sold`, {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ seatIds: ids }),
              });
              if (res.ok) { setSelected(new Set()); onSelectionChange?.([]); }
            }} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:"#8B0000", color:"#fff", cursor:"pointer", fontSize:12, fontWeight:500 }}>
              Sold out (test)
            </button>
          )}
        </div>
      )}

      {/* Zoom controls */}
      <div style={{ position:"absolute", bottom:16, right:16, display:"flex", flexDirection:"column", gap:6 }}>
        {["+","⊡","−"].map((label, i) => (
          <button key={label} onClick={() => {
            if (i===0) setTransform(t => ({ ...t, scale: Math.min(MAX_ZOOM, t.scale*1.25) }));
            if (i===2) setTransform(t => ({ ...t, scale: Math.max(MIN_ZOOM, t.scale*0.8) }));
            if (i===1) fitToContent();
          }} style={{
            width:36, height:36, borderRadius:6,
            border:"1px solid #ddd", background:"#fff",
            cursor:"pointer", fontSize:16, display:"flex",
            alignItems:"center", justifyContent:"center",
          }}>{label}</button>
        ))}
      </div>
    </div>
  );
}
