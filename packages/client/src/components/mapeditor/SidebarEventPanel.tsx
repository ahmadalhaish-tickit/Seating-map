import { useState, useEffect } from "react";
import { useMapEditorContext } from "./MapEditorContext.tsx";
import { inp, pbtn } from "./styles.ts";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  // Convert ISO string to datetime-local input value (no seconds, no Z)
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function fromLocalInput(val: string): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

function isActiveNow(startAt: string | null, endAt: string | null): boolean {
  const now = Date.now();
  const started = !startAt || new Date(startAt).getTime() <= now;
  const notEnded = !endAt || new Date(endAt).getTime() > now;
  return started && notEnded;
}

export function SidebarEventPanel() {
  const { mapMeta, saveSchedule } = useMapEditorContext();

  const [startVal,  setStartVal]  = useState(() => toLocalInput(mapMeta.scheduledStartAt));
  const [endVal,    setEndVal]    = useState(() => toLocalInput(mapMeta.scheduledEndAt));
  const [published, setPublished] = useState(mapMeta.isPublished);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  // Sync when mapMeta changes (e.g. on initial load)
  useEffect(() => {
    setStartVal(toLocalInput(mapMeta.scheduledStartAt));
    setEndVal(toLocalInput(mapMeta.scheduledEndAt));
    setPublished(mapMeta.isPublished);
  }, [mapMeta.scheduledStartAt, mapMeta.scheduledEndAt, mapMeta.isPublished]);

  const active = mapMeta.isPublished && isActiveNow(mapMeta.scheduledStartAt, mapMeta.scheduledEndAt);

  async function handleSave() {
    setSaving(true);
    await saveSchedule({
      scheduledStartAt: fromLocalInput(startVal),
      scheduledEndAt:   fromLocalInput(endVal),
      isPublished:      published,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Event info */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>Event</div>
        <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>
          {mapMeta.eventName || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 6, marginBottom: 2 }}>Map slot</div>
        <div style={{ fontSize: 13, color: "#aaa" }}>Map {mapMeta.mapSlot}</div>
      </div>

      {/* Active indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 10px", borderRadius: 6, marginBottom: 14,
        background: active ? "#0d2d20" : "#222",
        border: `1px solid ${active ? "#1D9E75" : "#333"}`,
      }}>
        <span style={{ color: active ? "#1D9E75" : "#555", fontSize: 13 }}>●</span>
        <span style={{ fontSize: 12, color: active ? "#5dbb80" : "#666" }}>
          {active ? "Active now" : "Not currently active"}
        </span>
      </div>

      {/* Published toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}>
        <input
          type="checkbox" checked={published}
          onChange={e => setPublished(e.target.checked)}
          style={{ accentColor: "#534AB7", width: 14, height: 14 }}
        />
        <span style={{ fontSize: 13, color: "#ccc" }}>Published (eligible to go live)</span>
      </label>

      {/* Schedule */}
      <div style={{ borderTop: "1px solid #222", paddingTop: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
          Schedule
        </div>

        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 3 }}>
            Starts at
          </span>
          <input
            type="datetime-local"
            value={startVal}
            onChange={e => setStartVal(e.target.value)}
            style={{ ...inp, colorScheme: "dark" }}
          />
          <span style={{ fontSize: 10, color: "#444", display: "block", marginTop: 3 }}>
            Leave empty = active immediately when published
          </span>
        </label>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 3 }}>
            Ends at
          </span>
          <input
            type="datetime-local"
            value={endVal}
            onChange={e => setEndVal(e.target.value)}
            style={{ ...inp, colorScheme: "dark" }}
          />
          <span style={{ fontSize: 10, color: "#444", display: "block", marginTop: 3 }}>
            Leave empty = no expiry
          </span>
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ ...pbtn, width: "100%" }}
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save Schedule"}
      </button>

      {/* Token generation hint */}
      {mapMeta.eventId && (
        <div style={{ marginTop: 16, padding: 10, borderRadius: 6, background: "#161616", border: "1px solid #2a2a2a" }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Generate customer link</div>
          <code style={{ fontSize: 11, color: "#666", wordBreak: "break-all" }}>
            POST /api/auth/token
            <br />
            {"{ "}"eventId": "{mapMeta.eventId}"{" }"}
          </code>
        </div>
      )}
    </div>
  );
}
