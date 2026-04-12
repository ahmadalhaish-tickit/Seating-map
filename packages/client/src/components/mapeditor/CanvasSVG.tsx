import { useMapEditorContext } from "./MapEditorContext.tsx";
import { CanvasOverlays } from "./CanvasOverlays.tsx";
import { zbtn, pbtn, sbtn } from "./styles.ts";
import {
  Zone, SeatDot, MapHold,
  isVenueObject, VenueObjectType, VENUE_OBJECT_CFG,
  getDisplaySeats, renderSeat, renderTableGraphic, renderVenueIcon,
  computeChairPositions, labelFontSize, polyBBox, curvedBBox, polyArea,
  centroid, pointsToPath, curvedPath,
} from "./types.tsx";

export default function CanvasSVG() {
  const {
    transform, tool, sections, selected, multiSelected, focusedSection,
    drawing, mouse, zones, holds, sidebarTab, seatRadius, seatShape,
    selectedSeats, setSelectedSeats, marqueeRect, tableDraft,
    bgImageUrl, vw, vh,
    sel, focSec,
    containerRef,
    sectionDragState, seatDragState, hasDragged, selectedSeatsRef,
    setSelected, hoveredSeat, setHoveredSeat,
    handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick, handleMouseLeave,
    finishPolygon, zoom, resetZoom, canvasCursor,
    setDrawing, setTool,
  } = useMapEditorContext();

  // Derived: seatId → hold lookup
  const seatHoldMap = new Map<string, MapHold>();
  for (const hold of holds) for (const { seatId } of hold.seats) seatHoldMap.set(seatId, hold);

  return (
    /* ── Canvas ──────────────────────────────────────────────────── */
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
            : (s.customColor ?? zone?.color ?? dominantPerSeatZone?.color ?? "#888780");
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

              {/* Custom SVG overlay — preset icon or uploaded SVG centered in polygon */}
              {s.customSvg && s.customSvg !== "none" && (() => {
                const bbox = polyBBox(s.points);
                const w = bbox.maxX - bbox.minX;
                const h = bbox.maxY - bbox.minY;
                const pad = Math.min(w, h) * 0.08;
                const iw = Math.max(1, w - pad * 2);
                const ih = Math.max(1, h - pad * 2);
                if (s.customSvg.startsWith("preset:")) {
                  const presetType = s.customSvg.slice(7) as VenueObjectType;
                  const iconSize = s.iconSize ?? Math.min(iw, ih) * 0.42;
                  return (
                    <g transform={`translate(${bbox.minX + pad + iw / 2 + (s.iconOffset?.x ?? 0)}, ${bbox.minY + pad + ih / 2 + (s.iconOffset?.y ?? 0)})`}
                      style={{ pointerEvents: "none" }}>
                      {renderVenueIcon(presetType, color, iconSize)}
                    </g>
                  );
                }
                return (
                  <image
                    href={s.customSvg}
                    x={bbox.minX + pad + (s.iconOffset?.x ?? 0)}
                    y={bbox.minY + pad + (s.iconOffset?.y ?? 0)}
                    width={iw} height={ih}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ pointerEvents: "none" }}
                  />
                );
              })()}

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

      <CanvasOverlays />
    </div>
  );
}
