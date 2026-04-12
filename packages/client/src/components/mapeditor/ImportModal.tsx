import { DraftSection } from "./types.tsx";
import { useMapEditorContext } from "./MapEditorContext.tsx";
import { sbtn, pbtn } from "./styles.ts";

export interface ImportPreviewSection {
  name: string; label: string;
  sectionType: DraftSection["sectionType"];
  polygonPath: string;
  rows: { label: string; startX: number; startY: number; angle: number; seats: { seatNumber: string; x: number; y: number }[] }[];
  sourceLayerName: string;
  estimatedSeats: number;
  confidence: number;
  bbox?: { top: number; left: number; bottom: number; right: number };
  include: boolean;
}

export interface ImportModalState {
  stage: "uploading" | "preview" | "saving";
  sections: ImportPreviewSection[];
  warnings: string[];
  error: string | null;
  fileLabel: string;
  previewUrl?: string;
}

const SECTION_TYPES: DraftSection["sectionType"][] = [
  "RESERVED","GA","ACCESSIBLE","RESTRICTED","TABLE","STAGE",
  "BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN",
];
const TYPE_COLORS: Record<string, string> = {
  RESERVED:"#534AB7",GA:"#1D9E75",ACCESSIBLE:"#4A90D9",RESTRICTED:"#c0392b",
  TABLE:"#8B6914",STAGE:"#C49A3C",BAR:"#A0522D",BATHROOM:"#2980b9",
  DANCING:"#9B59B6",PARKING:"#27AE60",STAIRS:"#7F8C8D",WALL:"#555566",
  DOOR:"#E67E22",CHECKIN:"#E74C3C",
};

export default function ImportModal() {
  const { importModal, setImportModal, importElapsed, handleImportConfirm, svgViewBox } = useMapEditorContext();

  if (!importModal) return null;

  const [,, svgW, svgH] = svgViewBox.split(" ").map(Number);
  const hasPreview = !!importModal.previewUrl;
  const closeModal = () => {
    if (importModal.previewUrl) URL.revokeObjectURL(importModal.previewUrl);
    setImportModal(null);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)",
      zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#1a1a1a", border: "1px solid #444", borderRadius: 12,
        width: hasPreview && importModal.stage === "preview" ? 960 : 680,
        maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {importModal.stage === "uploading" ? `Analyzing ${importModal.fileLabel}…` : importModal.stage === "saving" ? "Importing sections…" : `Import from ${importModal.fileLabel}`}
          </span>
          {importModal.stage === "preview" && (
            <button onClick={closeModal} style={{ ...sbtn, padding: "2px 10px", fontSize: 12 }}>✕</button>
          )}
        </div>

        {/* Loading / saving */}
        {(importModal.stage === "uploading" || importModal.stage === "saving") && (
          <div style={{ padding: 36, textAlign: "center", color: "#888", fontSize: 13 }}>
            {importModal.stage === "uploading" ? "Analyzing file…" : "Saving sections to map…"}
            {importModal.stage === "uploading" && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>
                {importElapsed}s elapsed
                {importElapsed > 15 && <span style={{ color: "#c9a227" }}> — large file, still working…</span>}
                {importElapsed > 60 && <span style={{ color: "#f09595" }}> — may time out at 110s</span>}
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {importModal.stage === "preview" && importModal.error && (
          <div style={{ padding: "10px 18px", background: "#2a1010", color: "#f09595", fontSize: 12, borderBottom: "1px solid #333" }}>
            {importModal.error}
          </div>
        )}

        {/* Preview body */}
        {importModal.stage === "preview" && (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* Left: image with bbox overlays */}
            {hasPreview && (
              <div style={{ width: 380, flexShrink: 0, borderRight: "1px solid #333", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
                <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "calc(85vh - 120px)" }}>
                  <img src={importModal.previewUrl} alt="venue"
                    style={{ display: "block", maxWidth: 356, maxHeight: "calc(85vh - 140px)", objectFit: "contain", borderRadius: 4 }} />
                  {importModal.sections.filter(s => s.include && s.bbox).map((sec, i) => {
                    const b = sec.bbox!;
                    return (
                      <div key={i} style={{
                        position: "absolute",
                        left: `${(b.left / svgW) * 100}%`,
                        top: `${(b.top / svgH) * 100}%`,
                        width: `${((b.right - b.left) / svgW) * 100}%`,
                        height: `${((b.bottom - b.top) / svgH) * 100}%`,
                        border: `2px solid ${TYPE_COLORS[sec.sectionType] ?? "#534AB7"}`,
                        borderRadius: 2,
                        background: `${TYPE_COLORS[sec.sectionType] ?? "#534AB7"}22`,
                        pointerEvents: "none",
                      }}>
                        <span style={{ position: "absolute", top: 1, left: 2, fontSize: 8, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "0 2px", borderRadius: 2, lineHeight: "12px", whiteSpace: "nowrap" }}>
                          {sec.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Right: section list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
              {importModal.warnings.length > 0 && (
                <div style={{ color: "#c9a227", fontSize: 11, marginBottom: 10 }}>
                  {importModal.warnings.join(" · ")}
                </div>
              )}
              {importModal.sections.length === 0 ? (
                <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                  No sections detected. Try a clearer floor plan image.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
                    {importModal.sections.filter(s => s.include).length} of {importModal.sections.length} sections selected
                  </div>
                  {importModal.sections.map((sec, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 8px", borderRadius: 6, marginBottom: 4,
                      background: sec.include ? "#1e1e2e" : "#161616",
                      border: "1px solid", borderColor: sec.include ? "#534AB7" : "#2a2a2a",
                    }}>
                      <input type="checkbox" checked={sec.include}
                        onChange={e => setImportModal(m => m ? {
                          ...m, sections: m.sections.map((s, j) => j === i ? { ...s, include: e.target.checked } : s)
                        } : null)} />
                      <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.name}</span>
                      <select
                        value={sec.sectionType}
                        onChange={e => setImportModal(m => m ? {
                          ...m, sections: m.sections.map((s, j) => j === i ? { ...s, sectionType: e.target.value as DraftSection["sectionType"] } : s)
                        } : null)}
                        style={{ fontSize: 11, background: "#222", color: "#ccc", border: "1px solid #444", borderRadius: 4, padding: "2px 4px", cursor: "pointer" }}>
                        {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <span style={{ fontSize: 11, color: "#666", minWidth: 60, textAlign: "right" }}>
                        {sec.estimatedSeats > 0 ? `~${sec.estimatedSeats}` : "—"}
                      </span>
                      {sec.confidence < 0.7 && (
                        <span title={`Low confidence (${Math.round(sec.confidence * 100)}%)`}
                          style={{ fontSize: 12, color: "#c9a227" }}>⚠</span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {importModal.stage === "preview" && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid #333", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={closeModal} style={sbtn}>Cancel</button>
            <button
              onClick={handleImportConfirm}
              disabled={importModal.sections.filter(s => s.include).length === 0}
              style={{ ...pbtn, opacity: importModal.sections.filter(s => s.include).length === 0 ? 0.4 : 1 }}>
              Import {importModal.sections.filter(s => s.include).length} sections
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
