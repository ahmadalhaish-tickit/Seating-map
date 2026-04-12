import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, sbtn, pbtn, dbtn } from "./styles.ts";

export default function SidebarFocusTools() {
  const {
    focusedSection, focSec,
    seatRadius, setSeatRadius,
    seatShape, setSeatShape,
    selectedSeats, setSelectedSeats,
    deleteSelectedSeats, fillGaps,
    zones, applyZoneToSelectedSeats,
    globalCurve, setGlobalCurve,
    globalSkew, setGlobalSkew,
    applyGlobalTransform,
    hasAnyTransform, bakeRowTransforms, bakingTransforms,
  } = useMapEditorContext();

  return (
    <>
      {/* Seat style panel */}
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
            {(["circle", "square", "triangle", "chair", "wheelchair"] as typeof seatShape[]).map(sh => (
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
    </>
  );
}
