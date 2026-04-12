import { createContext, useContext } from "react";
import type { useMapEditorState } from "./useMapEditorState.ts";

export type MapEditorContextType = ReturnType<typeof useMapEditorState>;

export const MapEditorContext = createContext<MapEditorContextType | null>(null);

export function useMapEditorContext(): MapEditorContextType {
  const ctx = useContext(MapEditorContext);
  if (!ctx) throw new Error("useMapEditorContext must be used within MapEditorContext.Provider");
  return ctx;
}
