import { useState } from "react";
import { useMapEditorContext } from "./MapEditorContext.tsx";
import { sbtn, dbtn, inp } from "./styles.ts";
import SidebarFocusTools from "./SidebarFocusTools.tsx";
import SidebarEditorTools from "./SidebarEditorTools.tsx";
import { SidebarInspectors } from "./SidebarInspectors.tsx";
import { ZonesPanel } from "./ZonesPanel.tsx";
import { SidebarHoldsTab } from "./SidebarHoldsTab.tsx";
import { SidebarEventPanel } from "./SidebarEventPanel.tsx";

function FloorsPanel() {
  const { floorNames, activeFloor, switchFloor, addFloor, renameFloor, deleteFloor, sections } = useMapEditorContext();
  const [editingFloor, setEditingFloor] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const floorEntries = Object.entries(floorNames).sort(([a], [b]) => +a - +b);
  return (
    <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
      <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13, color: "#aaa" }}>Floors</div>
      {floorEntries.map(([num, name]) => {
        const count = sections.filter(s => (s.floor ?? 1) === +num).length;
        return (
          <div key={num} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <button onClick={() => switchFloor(+num)} style={{
              flex: 1, padding: "5px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              border: "1px solid", textAlign: "left" as const,
              borderColor: activeFloor === +num ? "#534AB7" : "#333",
              background: activeFloor === +num ? "#2d2a5e" : "transparent",
              color: activeFloor === +num ? "#a09ce8" : "#ccc",
            }}>
              {editingFloor === +num ? (
                <input autoFocus value={draft} style={{ ...inp, padding: "1px 4px", width: "100%", boxSizing: "border-box" as const }}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => { if (draft.trim()) renameFloor(+num, draft.trim()); setEditingFloor(null); }}
                  onKeyDown={e => { if (e.key === "Enter") { if (draft.trim()) renameFloor(+num, draft.trim()); setEditingFloor(null); } if (e.key === "Escape") setEditingFloor(null); }}
                  onClick={e => e.stopPropagation()} />
              ) : (
                <span onDoubleClick={e => { e.stopPropagation(); setDraft(name); setEditingFloor(+num); }}>{name}</span>
              )}
              <span style={{ fontSize: 10, color: "#555", marginLeft: 6 }}>{count} section{count !== 1 ? "s" : ""}</span>
            </button>
            {floorEntries.length > 1 && (
              <button onClick={() => deleteFloor(+num)} title={count > 0 ? "Remove all sections first" : "Delete floor"}
                style={{ ...dbtn, padding: "3px 7px", fontSize: 11, opacity: count > 0 ? 0.35 : 1, cursor: count > 0 ? "not-allowed" : "pointer" }}>
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button onClick={addFloor} style={{ ...sbtn, width: "100%", marginTop: 4, fontSize: 12, padding: "5px 0", textAlign: "center" as const }}>
        + Add floor
      </button>
    </div>
  );
}

export default function Sidebar() {
  const {
    sidebarTab, setSidebarTab,
    focusedSection, focSec, exitFocus,
    holds,
    multiSelected, setMultiSelected, setSelected,
    deleteMultiSelected,
  } = useMapEditorContext();

  return (
    <aside style={{ width: 272, flexShrink: 0, borderRight: "1px solid #333", background: "#1a1a1a", overflowY: "auto", display: "flex", flexDirection: "column" }}>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #333", flexShrink: 0 }}>
        {(["editor", "holds", "event"] as const).map(tab => (
          <button key={tab} onClick={() => setSidebarTab(tab)}
            style={{ flex: 1, padding: "10px 0", border: "none", borderBottom: sidebarTab === tab ? "2px solid #534AB7" : "2px solid transparent", background: "transparent", color: sidebarTab === tab ? "#a09ce8" : "#666", fontSize: 12, fontWeight: sidebarTab === tab ? 600 : 400, cursor: "pointer", textTransform: "capitalize" }}>
            {tab === "holds" ? `Holds${holds.length ? ` (${holds.length})` : ""}` : tab === "event" ? "Schedule" : "Editor"}
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

        <SidebarFocusTools />

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

        <SidebarEditorTools />
        <SidebarInspectors />
        {!focusedSection && <ZonesPanel />}
        {!focusedSection && <FloorsPanel />}

      </>}

      {sidebarTab === "holds" && <SidebarHoldsTab />}

      {sidebarTab === "event" && <SidebarEventPanel />}

    </aside>
  );
}
