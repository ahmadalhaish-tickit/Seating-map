import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, pbtn, sbtn } from "./styles.ts";

export function ZonesPanel() {
  const { zones, newZone, setNewZone, addZone, deleteZone } = useMapEditorContext();

  return (
    <>
      <div style={{ padding: 16, borderBottom: "1px solid #333" }}>
        <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13, color: "#aaa" }}>Pricing zones</div>
        {zones.map(z => (
          <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: z.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, flex: 1 }}>{z.name}</span>
            <button onClick={() => deleteZone(z.id)} title="Delete zone"
              style={{ background: "transparent", border: "none", color: "#C04040", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input placeholder="Zone name" value={newZone.name}
            onChange={e => setNewZone(p => ({ ...p, name: e.target.value }))} style={{ ...inp, flex: 1 }} />
          <input type="color" value={newZone.color}
            onChange={e => setNewZone(p => ({ ...p, color: e.target.value }))}
            style={{ width: 34, height: 32, border: "1px solid #444", borderRadius: 6, padding: 2, cursor: "pointer", background: "transparent" }} />
          <button onClick={addZone} style={pbtn}>+</button>
        </div>
      </div>
    </>
  );
}
