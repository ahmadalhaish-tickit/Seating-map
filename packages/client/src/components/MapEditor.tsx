import { MapEditorContext } from "./mapeditor/MapEditorContext.tsx";
import { useMapEditorState } from "./mapeditor/useMapEditorState.ts";
import Sidebar from "./mapeditor/Sidebar.tsx";
import CanvasSVG from "./mapeditor/CanvasSVG.tsx";
import ImportModal from "./mapeditor/ImportModal.tsx";
import type { MapEditorProps } from "./mapeditor/types.tsx";

export default function MapEditor(props: MapEditorProps) {
  const state = useMapEditorState(props);

  return (
    <MapEditorContext.Provider value={state}>
      <div style={{ display: "flex", height: "100%", fontFamily: "system-ui", background: "#111", color: "#fff" }}>
        <Sidebar />
        <CanvasSVG />
        <ImportModal />
      </div>
    </MapEditorContext.Provider>
  );
}
