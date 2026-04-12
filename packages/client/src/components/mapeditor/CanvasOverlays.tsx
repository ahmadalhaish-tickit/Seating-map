import {
  DraftSection, TableShape, SeatShapeType,
  RowInfo,
} from "./types.tsx";
import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, pbtn, sbtn, dbtn } from "./styles.ts";

export function CanvasOverlays() {
  const {
    upd,
    hoveredSeat, editingSeat, setEditingSeat,
    saveSeatRename, deleteSeat,
    editingTable, setEditingTable,
    sections, zones,
    updateTableMeta, saveZoneChange,
    deleteSection, saveTable, saving,
    textEditId, setTextEditId, saveSectionPatch,
    editingRow, setEditingRow,
    focSec, saveRowRename, updRowTransform,
    setGlobalCurve, setGlobalSkew, applyGlobalTransform,
    seatRadius,
  } = useMapEditorContext();

  return (
    <>
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

      {/* Row edit popup */}
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
                  onChange={e => updRowTransform(editingRow.id, { curve: Number(e.target.value) } as Partial<RowInfo>)}
                  style={{ ...inp, padding: "3px 6px", fontSize: 11, marginTop: 3 }} />
              </label>
              <label style={{ fontSize: 11, color: "#666" }}>
                Skew
                <input type="number" value={row.skew}
                  onChange={e => updRowTransform(editingRow.id, { skew: Number(e.target.value) } as Partial<RowInfo>)}
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

      {/* Seat hover radius visual (focus mode) */}
      {hoveredSeat && (
        <div style={{
          position: "fixed", left: hoveredSeat.screenX + 14, top: hoveredSeat.screenY - 10,
          pointerEvents: "none", zIndex: 19,
        }}>
          <div style={{ width: seatRadius * 2, height: seatRadius * 2, borderRadius: "50%", border: "1px dashed #534AB7", opacity: 0.3 }} />
        </div>
      )}
    </>
  );
}
