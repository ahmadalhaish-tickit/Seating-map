import { useMapEditorContext } from "./MapEditorContext.tsx";
import { sbtn, inp } from "./styles.ts";
import { VENUE_OBJECT_CFG, VENUE_OBJECT_TYPES, VenueObjectType, renderVenueIcon } from "./types.tsx";

const PRESET_ICONS = VENUE_OBJECT_TYPES
  .filter(t => t !== "WALL" && t !== "DOOR" && t !== "STAIRS")
  .map(t => ({ id: `preset:${t}` as string, label: VENUE_OBJECT_CFG[t].label, type: t as VenueObjectType }));

export default function SidebarEditorTools() {
  const {
    focusedSection, tool, setTool, setDrawing, setTableDraft, setSeatedPlacement,
    drawing, seatedPlacement,
    fileInputRef, dxfFileInputRef, imageFileInputRef, handleFileImport,
    objectDraftName, setObjectDraftName,
    objectDraftSvg,  setObjectDraftSvg,
  } = useMapEditorContext();

  return (
    <>
      {/* Tools panel */}
      {!focusedSection && (
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Tools</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(([["select","Select"],["table","Table"],["object","Object"],["text","Text"]] as [typeof tool, string][]).map(([t, label]) => (
              <button key={t} onClick={() => { setTool(t); setDrawing([]); setTableDraft(null); setSeatedPlacement(null); }} style={{
                flex: 1, minWidth: 55, padding: "6px 4px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid",
                borderColor: tool === t ? "#534AB7" : "#444",
                background: tool === t ? "#2d2a5e" : "transparent",
                color: tool === t ? "#a09ce8" : "#ccc",
                fontWeight: tool === t ? 500 : 400,
              }}>{label}</button>
            )))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            {(([["polygon","GA Section"],["seated","Seated"]] as [typeof tool, string][]).map(([t, label]) => (
              <button key={t} onClick={() => { setTool(t); setDrawing([]); setTableDraft(null); setSeatedPlacement(null); }} style={{
                flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid",
                borderColor: tool === t ? "#27AE60" : "#444",
                background: tool === t ? "#1a3d28" : "transparent",
                color: tool === t ? "#5dbb80" : "#ccc",
                fontWeight: tool === t ? 500 : 400,
              }}>{label}</button>
            )))}
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
            <button onClick={() => fileInputRef.current?.click()}
              style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
              Import PSD
            </button>
            <button onClick={() => dxfFileInputRef.current?.click()}
              style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
              Import DXF/DWG
            </button>
            <button onClick={() => imageFileInputRef.current?.click()}
              style={{ ...sbtn, flex: 1, fontSize: 12, padding: "5px 0", textAlign: "center" }}>
              Import Image
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".psd" style={{ display: "none" }}
            onChange={e => handleFileImport(e, "analyze-psd")} />
          <input ref={dxfFileInputRef} type="file" accept=".dxf,.dwg" style={{ display: "none" }}
            onChange={e => handleFileImport(e, "analyze-dxf")} />
          <input ref={imageFileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" style={{ display: "none" }}
            onChange={e => handleFileImport(e, "analyze-image")} />
        </div>
      )}

      {/* Object tool config — name + icon picker shown before drawing */}
      {!focusedSection && tool === "object" && (
        <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
          <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Object</div>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 4 }}>Name</span>
            <input
              value={objectDraftName}
              onChange={e => setObjectDraftName(e.target.value)}
              placeholder="e.g. Stage, Bar, Entrance…"
              style={{ ...inp, width: "100%", boxSizing: "border-box" as const }}
            />
          </label>
          <span style={{ fontSize: 12, color: "#666", display: "block", marginBottom: 6 }}>Icon (optional)</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginBottom: 8 }}>
            {/* None */}
            <button onClick={() => setObjectDraftSvg(undefined)} style={{
              padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
              borderColor: !objectDraftSvg ? "#534AB7" : "#333",
              background: !objectDraftSvg ? "#2d2a5e" : "transparent",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              <span style={{ fontSize: 15, lineHeight: 1.2, color: !objectDraftSvg ? "#a09ce8" : "#555" }}>—</span>
              <span style={{ fontSize: 9, color: !objectDraftSvg ? "#a09ce8" : "#555" }}>None</span>
            </button>
            {/* Preset icons */}
            {PRESET_ICONS.map(({ id, label, type }) => {
              const cfg = VENUE_OBJECT_CFG[type];
              const active = objectDraftSvg === id;
              return (
                <button key={id} onClick={() => setObjectDraftSvg(active ? undefined : id)} style={{
                  padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
                  borderColor: active ? cfg.color : "#333",
                  background: active ? cfg.color + "25" : "transparent",
                  cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                }}>
                  <svg width="26" height="26" viewBox="-13 -13 26 26" style={{ overflow: "visible" }}>
                    {renderVenueIcon(type, active ? cfg.color : "#666", 11)}
                  </svg>
                  <span style={{ fontSize: 9, color: active ? cfg.color : "#555", lineHeight: 1 }}>{label}</span>
                </button>
              );
            })}
            {/* Upload custom SVG */}
            <label style={{
              padding: "6px 2px 5px", borderRadius: 6, border: "1px solid",
              borderColor: objectDraftSvg?.startsWith("data:") ? "#27AE60" : "#333",
              background: objectDraftSvg?.startsWith("data:") ? "#1a3d28" : "transparent",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              {objectDraftSvg?.startsWith("data:") ? (
                <>
                  <img src={objectDraftSvg} style={{ width: 26, height: 26, objectFit: "contain" }} />
                  <span style={{ fontSize: 9, color: "#5dbb80" }}>Custom</span>
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
                  reader.onload = () => setObjectDraftSvg(reader.result as string);
                  reader.readAsDataURL(file);
                }} />
            </label>
          </div>
          <p style={{ fontSize: 11, color: "#555", margin: 0 }}>Draw polygon on canvas →</p>
        </div>
      )}
    </>
  );
}
