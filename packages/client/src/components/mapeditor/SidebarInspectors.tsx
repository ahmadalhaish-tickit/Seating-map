import {
  DraftSection, TableShape,
  VenueObjectType, VENUE_OBJECT_TYPES, VENUE_OBJECT_CFG,
  isVenueObject, polyArea, renderVenueIcon,
} from "./types.tsx";
import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, pbtn, sbtn, dbtn } from "./styles.ts";

export function SidebarInspectors() {
  const {
    focusedSection, tool, sel, zones, saving,
    saveSection, saveSectionPatch, deleteSection, saveZoneChange,
    updateTableMeta, focusSection, upd, saveTable,
    tableCfg, setTableCfg,
    rowCfg, setRowCfg, seatedPlacement, setSeatedPlacement, createSeatedSection,
    showRows, setShowRows, generateRows,
    multiSelected, selectedSeats, splitSection, mergeSections,
  } = useMapEditorContext();

  return (
    <>
      {/* Seated section config */}
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

      {/* Table config */}
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

      {/* Table inspector */}
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

      {/* TEXT inspector */}
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
            {/* <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Text</div>
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
            </div> */}
            <span style={{ fontSize: "11px", color: "#666", lineHeight: 1.2, display: "block" }}>double click text on canvas to edit its content and style (font size, color, bold, angle)</span>
          </div>
        );
      })()}

      {/* Venue object inspector */}
      {sel && !focusedSection && isVenueObject(sel.sectionType) && (
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Venue object</div>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Name</span>
            <input value={sel.name} style={inp}
              onChange={e => upd(sel.id, { name: e.target.value, label: e.target.value })}
              onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { name: e.target.value, label: e.target.value }); }} />
          </label>
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
          <div style={{ display: "grid", gridTemplateColumns: sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 10 }}>
            {sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS" && (() => {
              const autoSize = Math.round(Math.max(10, Math.sqrt(polyArea(sel.points)) * 0.32));
              const curSize = sel.iconSize ?? autoSize;
              return (
                <label>
                  <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 3 }}>Icon size</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="range" min={10} max={200} step={5} value={curSize}
                      style={{ flex: 1, accentColor: VENUE_OBJECT_CFG[sel.sectionType as VenueObjectType]?.color ?? "#7F77DD" }}
                      onChange={e => upd(sel.id, { iconSize: Number(e.target.value) })}
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
          </div>
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

      {/* Custom object inspector */}
      {sel && !focusedSection && sel.customSvg !== undefined && sel.sectionType === "GA" && (() => {
        const objColor = sel.customColor ?? "#888780";
        const buildNotes = (overrides: Partial<{ svg: string; color: string; iconSize: number; labelSize: number }> = {}) => {
          const n: Record<string, unknown> = {};
          if (sel.edgeCurve)   n.edgeCurve  = sel.edgeCurve;
          if (sel.labelOffset) n.labelOffset = sel.labelOffset;
          n.customSvg   = overrides.svg       ?? sel.customSvg ?? "none";
          n.customColor = overrides.color     ?? sel.customColor ?? "#888780";
          if ((overrides.iconSize  ?? sel.iconSize)  !== undefined) n.iconSize  = overrides.iconSize  ?? sel.iconSize;
          if ((overrides.labelSize ?? sel.labelSize) !== undefined) n.labelSize = overrides.labelSize ?? sel.labelSize;
          return JSON.stringify(n);
        };
        const patchSvg = (svg: string | undefined) => {
          upd(sel.id, { customSvg: svg ?? "none" });
          if (sel.saved) saveSectionPatch(sel.id, { notes: buildNotes({ svg: svg ?? "none" }) });
        };
        const autoIconSize = 40;
        const curIconSize  = sel.iconSize ?? autoIconSize;
        const hasIcon = sel.customSvg && sel.customSvg !== "none";
        return (
          <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Object</div>

            {/* Name */}
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Name</span>
              <input value={sel.name} style={inp}
                onChange={e => upd(sel.id, { name: e.target.value, label: e.target.value })}
                onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { name: e.target.value, label: e.target.value }); }} />
            </label>

            {/* Color + text size row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <label>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Color</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={objColor}
                    style={{ width: 32, height: 28, border: "none", borderRadius: 4, cursor: "pointer", padding: 0, background: "none" }}
                    onChange={e => upd(sel.id, { customColor: e.target.value })}
                    onBlur={e => { if (sel.saved) saveSectionPatch(sel.id, { notes: buildNotes({ color: e.target.value }) }); }} />
                  <span style={{ fontSize: 11, color: "#aaa" }}>{objColor.toUpperCase()}</span>
                </div>
              </label>
              <label>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Text size</span>
                <input type="number" min={6} max={120} step={1}
                  value={sel.labelSize ?? ""}
                  placeholder="auto"
                  style={{ ...inp, width: "100%" }}
                  onChange={e => upd(sel.id, { labelSize: e.target.value ? Number(e.target.value) : undefined })}
                  onBlur={e => {
                    if (!sel.saved) return;
                    const v = e.target.value ? Number(e.target.value) : undefined;
                    saveSectionPatch(sel.id, { notes: buildNotes({ labelSize: v }) });
                  }} />
              </label>
            </div>

            {/* Icon size slider (only when icon is set) */}
            {hasIcon && (
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 3 }}>Icon size</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="range" min={8} max={300} step={4} value={curIconSize}
                    style={{ flex: 1, accentColor: objColor }}
                    onChange={e => upd(sel.id, { iconSize: Number(e.target.value) })}
                    onMouseUp={e => {
                      if (!sel.saved) return;
                      const v = Number((e.target as HTMLInputElement).value);
                      saveSectionPatch(sel.id, { notes: buildNotes({ iconSize: v }) });
                    }} />
                  <span style={{ fontSize: 11, color: "#aaa", minWidth: 28, textAlign: "right" }}>{curIconSize}</span>
                </div>
              </label>
            )}

            {/* Icon picker */}
            <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 6 }}>Icon</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginBottom: 10 }}>
              {/* None */}
              <button onClick={() => patchSvg(undefined)} style={{
                padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
                borderColor: sel.customSvg === "none" ? objColor : "#333",
                background: sel.customSvg === "none" ? objColor + "25" : "transparent",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              }}>
                <span style={{ fontSize: 15, lineHeight: 1.2, color: sel.customSvg === "none" ? objColor : "#555" }}>—</span>
                <span style={{ fontSize: 9, color: sel.customSvg === "none" ? objColor : "#555" }}>None</span>
              </button>
              {/* Preset icons */}
              {VENUE_OBJECT_TYPES.filter(t => t !== "WALL" && t !== "DOOR" && t !== "STAIRS").map(t => {
                const id = `preset:${t}`;
                const active = sel.customSvg === id;
                const cfg = VENUE_OBJECT_CFG[t];
                return (
                  <button key={t} onClick={() => patchSvg(active ? "none" : id)} style={{
                    padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
                    borderColor: active ? objColor : "#333",
                    background: active ? objColor + "25" : "transparent",
                    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  }}>
                    <svg width="26" height="26" viewBox="-13 -13 26 26" style={{ overflow: "visible" }}>
                      {renderVenueIcon(t, active ? objColor : "#666", 11)}
                    </svg>
                    <span style={{ fontSize: 9, color: active ? objColor : "#555", lineHeight: 1 }}>{cfg.label}</span>
                  </button>
                );
              })}
              {/* Upload custom SVG */}
              <label style={{
                padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
                borderColor: sel.customSvg?.startsWith("data:") ? objColor : "#333",
                background: sel.customSvg?.startsWith("data:") ? objColor + "25" : "transparent",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              }}>
                {sel.customSvg?.startsWith("data:") ? (
                  <>
                    <img src={sel.customSvg} style={{ width: 26, height: 26, objectFit: "contain" }} />
                    <span style={{ fontSize: 9, color: objColor }}>Custom</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 15, lineHeight: 1.2, color: "#555" }}>↑</span>
                    <span style={{ fontSize: 9, color: "#555" }}>Upload</span>
                  </>
                )}
                <input type="file" accept=".svg,image/svg+xml" style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => patchSvg(reader.result as string);
                    reader.readAsDataURL(file);
                  }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => saveSection(sel)} disabled={saving} style={pbtn}>
                {saving ? "Saving…" : sel.saved ? "✓ Saved" : "Save"}
              </button>
              <button onClick={() => deleteSection(sel.id, sel.saved)} style={dbtn}>Delete</button>
            </div>
          </div>
        );
      })()}

      {/* Section inspector */}
      {sel && !focusedSection && sel.sectionType !== "TABLE" && sel.sectionType !== "TEXT" && !isVenueObject(sel.sectionType) && sel.customSvg === undefined && (
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

          {!(sel.rows && sel.rows.length > 0) && (
            <label style={{ display: "block", marginBottom: 12 }}>
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
            </label>
          )}

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

          {(sel.rows && sel.rows.length > 0) && !isVenueObject(sel.sectionType) && (sel.sectionType as string) !== "TABLE" && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
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
                      if (sel.noOrphanSeats) n.noOrphanSeats = true;
                      saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                    }
                  }} />
                <span style={{ fontSize: 12, color: "#aaa" }}>Hide seats (click section to reveal)</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={sel.noOrphanSeats ?? false}
                  onChange={e => {
                    const v = e.target.checked;
                    upd(sel.id, { noOrphanSeats: v || undefined });
                    if (sel.saved) {
                      const n: Record<string, unknown> = {};
                      if (sel.labelOffset) n.labelOffset = sel.labelOffset;
                      if (sel.labelSize) n.labelSize = sel.labelSize;
                      if (sel.edgeCurve) n.edgeCurve = sel.edgeCurve;
                      if (sel.capacity !== undefined) n.capacity = sel.capacity;
                      if (sel.maxPerOrder !== undefined) n.maxPerOrder = sel.maxPerOrder;
                      if (sel.hideSeats) n.hideSeats = true;
                      if (v) n.noOrphanSeats = true;
                      saveSectionPatch(sel.id, { notes: Object.keys(n).length > 0 ? JSON.stringify(n) : null });
                    }
                  }} />
                <span style={{ fontSize: 12, color: "#aaa" }}>No isolated seats (SeatMap)</span>
              </label>
            </>
          )}

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

      {/* Split section — shown in focus mode when seats are selected */}
      {focusedSection && selectedSeats.size > 0 && (
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13, color: "#aaa" }}>Split section</div>
          <p style={{ fontSize: 11, color: "#666", marginTop: 0, marginBottom: 10 }}>
            {selectedSeats.size} seat{selectedSeats.size !== 1 ? "s" : ""} selected — move them into a new section.
          </p>
          <button onClick={splitSection} disabled={saving} style={{ ...pbtn, width: "100%", fontSize: 12 }}>
            {saving ? "Splitting…" : "Split into new section"}
          </button>
        </div>
      )}

      {/* Merge sections — shown when 2+ sections are multi-selected */}
      {!focusedSection && multiSelected.size >= 2 && (
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13, color: "#aaa" }}>Merge sections</div>
          <p style={{ fontSize: 11, color: "#666", marginTop: 0, marginBottom: 10 }}>
            {multiSelected.size} sections selected — combine their seats into one section.
          </p>
          <button onClick={mergeSections} disabled={saving} style={{ ...pbtn, width: "100%", fontSize: 12 }}>
            {saving ? "Merging…" : `Merge ${multiSelected.size} sections`}
          </button>
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
    </>
  );
}
