import { useEffect, useRef, useState, useCallback } from "react";
import { useGesture } from "@use-gesture/react";
import { io, Socket } from "socket.io-client";

type SeatStatus = "AVAILABLE" | "HELD" | "RESERVED" | "SOLD" | "BLOCKED";
type SeatInventory = Record<string, SeatStatus>;

interface Seat {
  id: string; rowId: string; seatNumber: string;
  x: number; y: number;
  isAccessible: boolean; isObstructed: boolean; notes?: string;
}
interface Row { id: string; label: string; seats: Seat[]; }
interface PricingZone { id: string; name: string; color: string; sortOrder: number; }
interface Section {
  id: string; name: string; label: string;
  sectionType: "RESERVED"|"GA"|"ACCESSIBLE"|"RESTRICTED";
  polygonPath: string;
  rows: Row[];
  zoneMappings: { zoneId: string }[];
}
interface FullMap {
  id: string; svgViewBox: string; bgImageUrl?: string;
  sections: Section[];
  pricingZones: PricingZone[];
}

interface SeatMapProps {
  mapId: string; eventId: string; sessionId: string;
  onSelectionChange?: (ids: string[]) => void;
}

const SEAT_R = 9;
const MIN_ZOOM = 0.4, MAX_ZOOM = 4;
const STATUS_COLORS: Record<SeatStatus, string> = {
  AVAILABLE: "#1D9E75", HELD: "#BA7517",
  RESERVED: "#D85A30", SOLD: "#888780", BLOCKED: "#888780",
};
const MY_COLOR = "#7F77DD";

export default function SeatMap({ mapId, eventId, sessionId, onSelectionChange }: SeatMapProps) {
  const [mapData, setMapData]     = useState<FullMap | null>(null);
  const [inventory, setInventory] = useState<SeatInventory>({});
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [hovered, setHovered]     = useState<{ seat: Seat; x: number; y: number } | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef    = useRef<Socket | null>(null);

  const zoneForSection = useCallback((s: Section) =>
    mapData?.pricingZones.find(z => z.id === s.zoneMappings[0]?.zoneId),
  [mapData]);

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

  useEffect(() => {
    if (!mapData || !containerRef.current) return;
    const [,,vw,vh] = mapData.svgViewBox.split(" ").map(Number);
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw/vw, ch/vh) * 0.9;
    setTransform({ scale, x: (cw-vw*scale)/2, y: (ch-vh*scale)/2 });
  }, [mapData]);

  const handleSeatClick = useCallback(async (seat: Seat, e: React.MouseEvent) => {
    e.stopPropagation();
    const status = inventory[seat.id] ?? "AVAILABLE";
    if (status === "SOLD" || status === "BLOCKED") return;
    if (selected.has(seat.id)) {
      setSelected(p => { const s = new Set(p); s.delete(seat.id); onSelectionChange?.([...s]); return s; });
      socketRef.current?.emit("seat:release", { eventId, seatId: seat.id });
      return;
    }
    if (status !== "AVAILABLE") return;
    socketRef.current?.emit("seat:hold", { eventId, seatId: seat.id },
      (res: { ok: boolean }) => {
        if (res.ok) setSelected(p => {
          const s = new Set(p); s.add(seat.id);
          onSelectionChange?.([...s]); return s;
        });
      });
  }, [inventory, selected, eventId, onSelectionChange]);

  if (!mapData) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"#666", fontSize:14 }}>
      Loading map…
    </div>
  );

  const [,,vw,vh] = mapData.svgViewBox.split(" ").map(Number);

  return (
    <div ref={containerRef} style={{ width:"100%", height:"100%", overflow:"hidden", position:"relative", cursor:"grab", touchAction:"none" }}>
      <svg viewBox={mapData.svgViewBox} width={vw} height={vh} style={{
        position:"absolute",
        transform:`translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
        transformOrigin:"0 0", willChange:"transform",
      }}>
        {mapData.bgImageUrl && <image href={mapData.bgImageUrl} x="0" y="0" width={vw} height={vh} />}

        {mapData.sections.map(section => {
          const zone = zoneForSection(section);
          const color = zone?.color ?? "#888780";
          const c = centroid(section.polygonPath);
          return (
            <g key={section.id}>
              <path d={section.polygonPath} fill={color+"22"} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central"
                fontSize={14} fontWeight={500} fill={color} style={{ pointerEvents:"none", userSelect:"none" }}>
                {section.label}
              </text>
              {section.sectionType === "RESERVED" && section.rows.flatMap(row =>
                row.seats.map(seat => {
                  const st = inventory[seat.id] ?? "AVAILABLE";
                  const mine = selected.has(seat.id);
                  return (
                    <circle key={seat.id} cx={seat.x} cy={seat.y} r={SEAT_R}
                      fill={mine ? MY_COLOR : STATUS_COLORS[st]}
                      stroke={mine ? "#3C3489" : "none"} strokeWidth={1.5}
                      opacity={hovered?.seat.id === seat.id ? 0.75 : 1}
                      style={{ cursor: st==="AVAILABLE"||mine ? "pointer" : "default" }}
                      onClick={e => handleSeatClick(seat, e)}
                      onMouseEnter={e => setHovered({ seat, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })
              )}
            </g>
          );
        })}

        <rect x={(vw-300)/2} y={20} width={300} height={44} rx={8} fill="#2C2C2A" opacity={0.85} />
        <text x={vw/2} y={42} textAnchor="middle" dominantBaseline="central"
          fontSize={14} fill="#D3D1C7" fontWeight={500} style={{ userSelect:"none" }}>
          STAGE
        </text>
      </svg>

      {hovered && (
        <div style={{
          position:"fixed", left: hovered.x+12, top: hovered.y-8,
          background:"var(--color-background-primary,#fff)",
          border:"1px solid #ddd", borderRadius:8, padding:"8px 12px",
          fontSize:13, pointerEvents:"none", zIndex:10, minWidth:140,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>
          <div style={{ fontWeight:500, marginBottom:2 }}>Seat {hovered.seat.seatNumber}</div>
          <div style={{ color:"#888", fontSize:12 }}>{inventory[hovered.seat.id] ?? "AVAILABLE"}</div>
          {hovered.seat.notes && <div style={{ color:"#aaa", fontSize:11, marginTop:2 }}>{hovered.seat.notes}</div>}
        </div>
      )}

      <div style={{ position:"absolute", bottom:16, right:16, display:"flex", flexDirection:"column", gap:6 }}>
        {["+","↺","−"].map((label, i) => (
          <button key={label} onClick={() => {
            if (i===0) setTransform(t => ({ ...t, scale: Math.min(MAX_ZOOM, t.scale*1.25) }));
            if (i===2) setTransform(t => ({ ...t, scale: Math.max(MIN_ZOOM, t.scale*0.8) }));
            if (i===1 && containerRef.current) {
              const [,,vw2,vh2] = mapData.svgViewBox.split(" ").map(Number);
              const { width:cw, height:ch } = containerRef.current.getBoundingClientRect();
              const sc = Math.min(cw/vw2, ch/vh2) * 0.9;
              setTransform({ scale:sc, x:(cw-vw2*sc)/2, y:(ch-vh2*sc)/2 });
            }
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

function centroid(polygonPath: string) {
  const nums = polygonPath.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  const xs = nums.filter((_,i) => i%2===0);
  const ys = nums.filter((_,i) => i%2===1);
  return {
    x: xs.reduce((a,b) => a+b,0)/xs.length,
    y: ys.reduce((a,b) => a+b,0)/ys.length,
  };
}
