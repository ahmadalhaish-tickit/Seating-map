import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, pbtn } from "./styles.ts";

export function SidebarHoldsTab() {
  const {
    holds, setHolds,
    activeHoldId, setActiveHoldId,
    holdEditDraft, setHoldEditDraft,
    selectedSeats, setSelectedSeats,
    assignSeatsToHold, deleteHold,
    newHold, setNewHold, addHold,
  } = useMapEditorContext();

  return (
    <>
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>Block seats permanently — appear unavailable in seat map. Click seats on canvas to select.</div>

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
    </>
  );
}

// keep named export for backward compat
export { SidebarHoldsTab as default };
