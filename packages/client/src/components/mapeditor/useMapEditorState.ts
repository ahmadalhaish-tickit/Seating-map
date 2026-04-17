import { useState, useRef, useEffect } from "react";
import {
  SeatShapeType, TableMeta, DoorMeta, Point, SeatDot, RowInfo,
  DraftSection, Zone, MapHold, MapEditorProps, Tool,
  isVenueObject, pathToPoints, reshapeToFitSeats, getDisplaySeats,
  computeChairPositions, tableBoundingPoints, rotateAround, polyBBox,
  centroid, rectContains, pointsToPath, curvedPath, MIN_ZOOM, MAX_ZOOM,
  doorRectPoints,
} from "./types.tsx";
import type { ImportModalState } from "./ImportModal.tsx";

export function useMapEditorState({ mapId, svgViewBox, bgImageUrl, initialZones = [] }: MapEditorProps) {
  const [, , vw, vh] = svgViewBox.split(" ").map(Number);

  // Canvas transform
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

  // Editor state
  const [tool, setTool]               = useState<Tool>("select");
  const [sections, setSections]       = useState<DraftSection[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [focusedSection, setFocused]  = useState<string | null>(null);
  const [drawing, setDrawing]         = useState<Point[]>([]);
  const [mouse, setMouse]             = useState<Point | null>(null);
  const [zones, setZones]             = useState<Zone[]>(initialZones);
  const [holds, setHolds]             = useState<MapHold[]>([]);
  const [newHold, setNewHold]         = useState({ name: "", color: "#cc4444" });
  const [activeHoldId, setActiveHoldId] = useState<string | null>(null);
  const [holdEditDraft, setHoldEditDraft] = useState<{ id: string; name: string; color: string } | null>(null);
  const [sidebarTab, setSidebarTab]   = useState<"editor" | "holds" | "event">("editor");
  const [showRows, setShowRows]       = useState(false);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [bakingTransforms, setBaking] = useState(false);
  const [newZone, setNewZone]         = useState({ name: "", color: "#7F77DD" });
  const [seatRadius, setSeatRadius]   = useState(5);
  const [seatShape, setSeatShape]     = useState<SeatShapeType>("circle");
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [editingSeat, setEditingSeat] = useState<{ id: string; value: string; shape: SeatShapeType; sectionId: string; screenX: number; screenY: number } | null>(null);
  const [editingRow, setEditingRow]   = useState<{ id: string; value: string; screenX: number; screenY: number } | null>(null);
  // Table tool state
  const [tableCfg, setTableCfg] = useState<TableMeta>({ shape: "rectangle", w: 120, h: 60, cpl: 4, cps: 2, angle: 0 });
  const [tableDraft, setTableDraft] = useState<{ startPt: Point; endPt: Point } | null>(null);
  const [editingTable, setEditingTable] = useState<{ sectionId: string; screenX: number; screenY: number } | null>(null);
  // Object tool draft config (sidebar, before drawing)
  const [objectDraftName, setObjectDraftName] = useState("");
  const [objectDraftSvg,  setObjectDraftSvg]  = useState<string | undefined>(undefined);
  // Text edit widget
  const [textEditId, setTextEditId] = useState<string | null>(null);

  // PSD import modal
  const [importModal, setImportModal] = useState<ImportModalState | null>(null);
  const [importElapsed, setImportElapsed] = useState(0);
  const importTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Seated section placement (tool === "seated")
  const [seatedPlacement, setSeatedPlacement] = useState<Point | null>(null);

  // Global curve/skew for applying to all rows at once
  const [globalCurve, setGlobalCurve] = useState(0);
  const [globalSkew, setGlobalSkew]   = useState(0);
  const [rowCfg, setRowCfg] = useState({
    count: 5, seatsPerRow: 10,
    startX: 200, startY: 200,
    spacingX: 28, spacingY: 24,
    rowLabelType: "letters" as "letters" | "numbers",
    rowStart: 0,
    seatOrder: "ltr" as "ltr" | "rtl",
    seatStart: 1,
  });

  // Seat hover
  const [hoveredSeat, setHoveredSeat] = useState<{
    seat: SeatDot; sectionName: string; zoneName: string; zoneColor: string;
    screenX: number; screenY: number;
  } | null>(null);

  // Map / event metadata loaded alongside sections
  const [mapMeta, setMapMeta] = useState<{
    eventId: string; eventName: string; mapSlot: number;
    scheduledStartAt: string | null; scheduledEndAt: string | null;
    isPublished: boolean;
  }>({ eventId: '', eventName: '', mapSlot: 1, scheduledStartAt: null, scheduledEndAt: null, isPublished: false });

  // Refs
  const containerRef       = useRef<HTMLDivElement>(null);
  const transformRef       = useRef(transform);
  const preFocusTransform  = useRef<{ x: number; y: number; scale: number } | null>(null);
  const sectionsRef      = useRef(sections);
  const drawingRef       = useRef(drawing);
  const toolRef          = useRef(tool);
  const focusedRef       = useRef(focusedSection);
  const selectedSeatsRef = useRef(selectedSeats);
  const seatRadiusRef    = useRef(seatRadius);
  const objectDraftNameRef = useRef(objectDraftName);
  const objectDraftSvgRef  = useRef(objectDraftSvg);
  const selectedRef        = useRef(selected);
  const multiSelectedRef = useRef(multiSelected);
  const sidebarTabRef    = useRef(sidebarTab);
  const activeHoldIdRef  = useRef(activeHoldId);

  useEffect(() => { transformRef.current     = transform;      }, [transform]);
  useEffect(() => { sectionsRef.current      = sections;       }, [sections]);
  useEffect(() => { drawingRef.current       = drawing;        }, [drawing]);
  useEffect(() => { toolRef.current          = tool;           }, [tool]);
  useEffect(() => { focusedRef.current       = focusedSection; }, [focusedSection]);
  useEffect(() => { selectedSeatsRef.current = selectedSeats;  }, [selectedSeats]);
  useEffect(() => { seatRadiusRef.current    = seatRadius;     }, [seatRadius]);
  useEffect(() => { objectDraftNameRef.current = objectDraftName; }, [objectDraftName]);
  useEffect(() => { objectDraftSvgRef.current  = objectDraftSvg;  }, [objectDraftSvg]);
  useEffect(() => { selectedRef.current        = selected;        }, [selected]);
  useEffect(() => { multiSelectedRef.current = multiSelected;  }, [multiSelected]);
  useEffect(() => { sidebarTabRef.current    = sidebarTab;     }, [sidebarTab]);
  useEffect(() => { activeHoldIdRef.current  = activeHoldId;   }, [activeHoldId]);

  // Undo / redo history (refs so pushing doesn't trigger re-render)
  const undoStack = useRef<DraftSection[][]>([]);
  const redoStack = useRef<DraftSection[][]>([]);

  // Deselect section/seats when switching to Holds tab
  useEffect(() => {
    if (sidebarTab === "holds") {
      setSelected(null);
      setSelectedSeats(new Set());
    }
  }, [sidebarTab]);
  // Clear seat selection whenever the selected section changes (handles table deselect)
  useEffect(() => { setSelectedSeats(new Set()); }, [selected]);
  // Close text edit widget when the text section is deselected
  useEffect(() => { if (textEditId && selected !== textEditId) setTextEditId(null); }, [selected, textEditId]);

  // Drag state refs
  const panState = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const sectionDragState = useRef<{
    sectionId: string;
    startClientX: number; startClientY: number;
    origPoints: Point[]; origSeats: SeatDot[];
    downTarget: Element;
    extra: { id: string; origPoints: Point[]; origSeats: SeatDot[] }[];
  } | null>(null);
  const vertexDragState = useRef<{
    sectionId: string; vertexIndex: number;
    startClientX: number; startClientY: number;
    origPoints: Point[];
    origDoorMeta?: DoorMeta;
    origStairsMeta?: DoorMeta;
    origTableMeta?: TableMeta;
  } | null>(null);
  const seatDragState = useRef<{
    primarySeatId: string;
    origSeats: { id: string; x: number; y: number }[];
    startClientX: number; startClientY: number;
    sectionId: string;
  } | null>(null);
  const marqueeStateRef = useRef<{ startSvgX: number; startSvgY: number; sectionId: string | null } | null>(null);
  const rowLabelDownRef = useRef<{ rowId: string; screenX: number; screenY: number } | null>(null);
  const rotationDragState = useRef<{
    sectionId: string;
    centerX: number; centerY: number;
    startAngle: number;
    origPoints: Point[];
    origSeats: { id: string; x: number; y: number }[];
    origDisplaySeats: { id: string; x: number; y: number }[]; // display (curve-applied) positions
    sectionHasRows: boolean; // if true, rotate display seats and zero curve/skew
    origTableAngle?: number;  // for TABLE sections: original tableMeta.angle
    origDoorAngle?: number;   // for DOOR sections: original doorMeta.angle
    origStairsAngle?: number; // for STAIRS sections: original stairsMeta.angle
    origTextAngle?: number;   // for TEXT sections: original textAngle
  } | null>(null);
  const groupRotationDragState = useRef<{
    centerX: number; centerY: number; startAngle: number;
    sections: {
      id: string; origPoints: Point[]; origSeats: { id: string; x: number; y: number }[];
      origTableAngle?: number; origDoorAngle?: number; origStairsAngle?: number; origTextAngle?: number;
    }[];
  } | null>(null);
  const tableDraftRef = useRef(tableDraft);
  useEffect(() => { tableDraftRef.current = tableDraft; }, [tableDraft]);

  // Debounce ref for icon-offset PATCH
  const iconOffsetPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDragged = useRef(false);
  const clipboardRef = useRef<DraftSection[]>([]);

  // File input refs (used by handleFileImport)
  const dxfFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  const sel    = sections.find(s => s.id === selected);
  const focSec = sections.find(s => s.id === focusedSection);

  // ── Init transform ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw / vw, ch / vh) * 0.85;
    setTransform({ scale, x: (cw - vw * scale) / 2, y: (ch - vh * scale) / 2 });
  }, [vw, vh]);

  // ── Load map ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/maps/${mapId}`)
      .then(r => r.json())
      .then((map: {
        id: string;
        mapSlot: number;
        isPublished: boolean;
        scheduledStartAt: string | null;
        scheduledEndAt: string | null;
        event?: { id: string; name: string };
        sections: {
          id: string; name: string; label: string;
          sectionType: DraftSection["sectionType"];
          polygonPath: string;
          notes?: string | null;
          zoneMappings: { zoneId: string }[];
          rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string; notes?: string | null }[] }[];
        }[];
        pricingZones: Zone[];
        mapHolds?: MapHold[];
      }) => {
        setSections(map.sections.map(s => {
          let tableMeta: TableMeta | undefined;
          let doorMeta: DoorMeta | undefined;
          let stairsMeta: DoorMeta | undefined;
          let iconOffset: { x: number; y: number } | undefined;
          let labelOffset: { x: number; y: number } | undefined;
          let iconSize: number | undefined;
          let labelSize: number | undefined;
          let showIcon: boolean | undefined;
          let showLabel: boolean | undefined;
          let textColor: string | undefined;
          let textBold: boolean | undefined;
          let textAngle: number | undefined;
          if (s.sectionType === "TABLE" && s.notes) {
            try { tableMeta = JSON.parse(s.notes) as TableMeta; } catch {}
          }
          if (s.sectionType === "DOOR" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { w?: number; h?: number; angle?: number; showLabel?: boolean; labelOffset?: { x: number; y: number }; labelSize?: number };
              if (p.w && p.h !== undefined) doorMeta = { w: p.w, h: p.h, angle: p.angle ?? 0 };
              if (p.showLabel === false) showLabel = false;
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
            } catch {}
          }
          if (s.sectionType === "STAIRS" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { w?: number; h?: number; angle?: number; showLabel?: boolean; labelOffset?: { x: number; y: number }; labelSize?: number };
              if (p.w && p.h !== undefined) stairsMeta = { w: p.w, h: p.h, angle: p.angle ?? 0 };
              if (p.showLabel === false) showLabel = false;
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
            } catch {}
          }
          if (isVenueObject(s.sectionType) && s.sectionType !== "WALL" && s.sectionType !== "DOOR" && s.notes) {
            try {
              const parsed = JSON.parse(s.notes) as {
                iconOffset?: { x: number; y: number };
                labelOffset?: { x: number; y: number };
                iconSize?: number;
                labelSize?: number;
                showIcon?: boolean;
                showLabel?: boolean;
                textColor?: string;
                textBold?: boolean;
                textAngle?: number;
              };
              if (parsed.iconOffset) iconOffset = parsed.iconOffset;
              if (parsed.labelOffset) labelOffset = parsed.labelOffset;
              if (parsed.iconSize) iconSize = parsed.iconSize;
              if (parsed.labelSize) labelSize = parsed.labelSize;
              if (parsed.showIcon === false) showIcon = false;
              if (parsed.showLabel === false) showLabel = false;
              if (parsed.textColor) textColor = parsed.textColor;
              if (parsed.textBold) textBold = parsed.textBold;
              if (parsed.textAngle !== undefined) textAngle = parsed.textAngle;
            } catch {}
          }
          // Regular sections: parse labelOffset, labelSize, edgeCurve, capacity, maxPerOrder, hideSeats, customSvg from notes
          let edgeCurve = 0;
          let capacity: number | undefined;
          let maxPerOrder: number | undefined;
          let hideSeats: boolean | undefined;
          let customSvg: string | undefined;
          let customColor: string | undefined;
          let noOrphanSeats: boolean | undefined;
          if (!isVenueObject(s.sectionType) && s.sectionType !== "TABLE" && s.notes) {
            try {
              const p = JSON.parse(s.notes) as { labelOffset?: { x: number; y: number }; iconOffset?: { x: number; y: number }; labelSize?: number; edgeCurve?: number; capacity?: number; maxPerOrder?: number; hideSeats?: boolean; customSvg?: string; customColor?: string; iconSize?: number; noOrphanSeats?: boolean };
              if (p.labelOffset) labelOffset = p.labelOffset;
              if (p.labelSize) labelSize = p.labelSize;
              if (p.edgeCurve) edgeCurve = p.edgeCurve;
              if (p.capacity !== undefined) capacity = p.capacity;
              if (p.maxPerOrder !== undefined) maxPerOrder = p.maxPerOrder;
              if (p.hideSeats !== undefined) hideSeats = p.hideSeats;
              if (p.customSvg) customSvg = p.customSvg;
              if (p.customColor) customColor = p.customColor;
              if (p.iconSize) iconSize = p.iconSize;
              if (p.iconOffset) iconOffset = p.iconOffset;
              if (p.noOrphanSeats) noOrphanSeats = p.noOrphanSeats;
            } catch {}
          }
          return {
          id: s.id, name: s.name, label: s.label,
          sectionType: s.sectionType,
          zoneId: s.zoneMappings[0]?.zoneId,
          saved: true,
          edgeCurve,
          capacity,
          maxPerOrder,
          hideSeats,
          customSvg,
          customColor,
          noOrphanSeats,
          tableMeta,
          doorMeta,
          stairsMeta,
          iconOffset,
          labelOffset,
          iconSize,
          labelSize,
          showIcon,
          showLabel,
          textColor,
          textBold,
          textAngle,
          rows: s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 })),
          seats: s.rows.flatMap(row =>
            row.seats.map(seat => {
              const SHAPES = ["circle","square","triangle","chair","wheelchair"];
              let shape: SeatShapeType | undefined;
              let seatZoneId: string | undefined;
              if (seat.notes) {
                if (SHAPES.includes(seat.notes)) { shape = seat.notes as SeatShapeType; }
                else { try { const p = JSON.parse(seat.notes); if (SHAPES.includes(p.s ?? "")) shape = p.s; if (p.z) seatZoneId = p.z; } catch {} }
              }
              return { id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id, shape, zoneId: seatZoneId };
            })
          ),
          // For sections with seats, recompute the boundary from actual seat positions.
          // This heals any stored polygon corruption (e.g. from edgeCurve being applied
          // to a reshaped boundary) without requiring a manual row regeneration.
          // TABLE sections must skip reshapeToFitSeats — their polygon is derived from
          // tableMeta dimensions, not chair positions. Fitting to chairs shifts the
          // computed center for asymmetric chair counts, causing the table surface to
          // render offset and cover chairs that should be outside it.
          points: (() => {
            if (s.sectionType === "TABLE") return pathToPoints(s.polygonPath);
            const rawSeats = s.rows.flatMap(row =>
              row.seats.map(seat => ({
                id: seat.id, x: seat.x, y: seat.y,
                seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id,
              }))
            );
            if (rawSeats.length > 0) {
              const rowInfos = s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 }));
              const displaySeats = getDisplaySeats(rawSeats, rowInfos);
              const fitted = reshapeToFitSeats(displaySeats.length > 0 ? displaySeats : rawSeats);
              if (fitted.length > 0) return fitted;
            }
            return pathToPoints(s.polygonPath);
          })(),
          };
        }));
        if (map.pricingZones.length > 0) setZones(map.pricingZones);
        if (map.mapHolds) setHolds(map.mapHolds);
        setMapMeta({
          eventId:          map.event?.id   ?? '',
          eventName:        map.event?.name ?? '',
          mapSlot:          map.mapSlot      ?? 1,
          scheduledStartAt: map.scheduledStartAt ?? null,
          scheduledEndAt:   map.scheduledEndAt   ?? null,
          isPublished:      map.isPublished  ?? false,
        });
        setLoading(false);
      });
  }, [mapId]);

  const upd = (id: string, u: Partial<DraftSection>) =>
    setSections(p => p.map(s => s.id === id ? { ...s, ...u } : s));

  // ── Focus section ─────────────────────────────────────────────────────
  const focusSection = (sectionId: string) => {
    const s = sectionsRef.current.find(sec => sec.id === sectionId);
    if (!s || !containerRef.current) return;
    preFocusTransform.current = { ...transformRef.current };
    const bbox = polyBBox(s.points);
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const PAD = 120;
    const scale = Math.min(
      (cw - PAD * 2) / Math.max(bbox.maxX - bbox.minX, 1),
      (ch - PAD * 2) / Math.max(bbox.maxY - bbox.minY, 1),
      MAX_ZOOM
    );
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    setTransform({ scale, x: cw / 2 - cx * scale, y: ch / 2 - cy * scale });
    setFocused(sectionId);
    setSelected(sectionId);
    setSelectedSeats(new Set());
    // Init global sliders from the section's current row values.
    // If all rows share the same value use it; if mixed use 0.
    const rowCurves = s.rows?.map(r => r.curve ?? 0) ?? [];
    const rowSkews  = s.rows?.map(r => r.skew  ?? 0) ?? [];
    setGlobalCurve(rowCurves.length > 0 && rowCurves.every(c => c === rowCurves[0]) ? rowCurves[0] : 0);
    setGlobalSkew (rowSkews.length  > 0 && rowSkews.every(c  => c === rowSkews[0])  ? rowSkews[0]  : 0);
  };

  const exitFocus = () => {
    setFocused(null);
    setSelectedSeats(new Set());
    if (preFocusTransform.current) {
      setTransform(preFocusTransform.current);
      preFocusTransform.current = null;
    } else {
      fitToContent();
    }
  };

  // ── Undo / Redo helpers ───────────────────────────────────────────────
  const pushHistory = () => {
    const snap = sectionsRef.current.map(s => ({
      ...s,
      points: s.points.map(p => ({ ...p })),
      seats: s.seats?.map(st => ({ ...st })),
      rows: s.rows?.map(r => ({ ...r })),
    }));
    undoStack.current = [...undoStack.current.slice(-49), snap];
    redoStack.current = [];
  };

  const syncHistoryState = async (target: DraftSection[], current: DraftSection[]) => {
    const currById = new Map(current.map(s => [s.id, s]));
    const targById = new Map(target.map(s => [s.id, s]));
    // Sections created after snapshot → batch delete from DB
    const toDelete = current.filter(s => !targById.has(s.id) && s.saved).map(s => s.id);
    if (toDelete.length > 0) {
      fetch("/api/sections/batch", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionIds: toDelete }),
      });
    }
    // Sections that changed → patch concurrently
    await Promise.all(target.map(prev => {
      const curr = currById.get(prev.id);
      if (!curr || !prev.saved) return;
      const patches: Record<string, unknown> = {};
      const prevPath = pointsToPath(prev.points);
      const currPath = pointsToPath(curr.points);
      if (prevPath !== currPath) patches.polygonPath = prevPath;
      if (prev.name !== curr.name) patches.name = prev.name;
      if (prev.label !== curr.label) patches.label = prev.label;
      if (prev.sectionType !== curr.sectionType) patches.sectionType = prev.sectionType;
      if (Object.keys(patches).length === 0) return;
      return fetch(`/api/sections/${prev.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patches),
      });
    }));
  };

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tableDraftRef.current) { setTableDraft(null); setTool("select"); return; }
        if (focusedRef.current) { exitFocus(); return; }
        if (toolRef.current === "polygon" || toolRef.current === "object") {
          setDrawing([]);
          setTool("select");
          return;
        }
        if (toolRef.current === "seated") {
          setSeatedPlacement(null);
          setTool("select");
          return;
        }
        setEditingTable(null);
        setSelected(null);
        setMultiSelected(new Set());
        return;
      }
      // Ctrl+C: copy selected sections
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        const allIds = new Set([...multiSelectedRef.current]);
        if (selectedRef.current) allIds.add(selectedRef.current);
        clipboardRef.current = sectionsRef.current.filter(s => allIds.has(s.id)).map(s => ({ ...s }));
        return;
      }
      // Ctrl+V: paste copied sections
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        const toPaste = clipboardRef.current;
        if (!toPaste.length) return;
        pushHistory();
        const OFFSET = 20;
        const newSections: DraftSection[] = toPaste.map(orig => ({
          ...orig,
          id: crypto.randomUUID(),
          saved: false,
          points: orig.points.map(p => ({ x: p.x + OFFSET, y: p.y + OFFSET })),
          seats: orig.seats?.map(seat => ({ ...seat, id: crypto.randomUUID(), x: seat.x + OFFSET, y: seat.y + OFFSET })),
          rows: orig.rows?.map(r => ({ ...r, id: crypto.randomUUID() })),
        }));
        setSections(prev => [...prev, ...newSections]);
        setMultiSelected(new Set(newSections.map(s => s.id)));
        if (newSections.length > 0) setSelected(newSections[0].id);
        savePastedSections(newSections);
        return;
      }
      // Ctrl+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (undoStack.current.length === 0) return;
        const snapshot = undoStack.current[undoStack.current.length - 1];
        const curr = sectionsRef.current.map(s => ({ ...s, points: s.points.map(p => ({ ...p })), seats: s.seats?.map(st => ({ ...st })), rows: s.rows?.map(r => ({ ...r })) }));
        redoStack.current = [...redoStack.current.slice(-49), curr];
        undoStack.current = undoStack.current.slice(0, -1);
        syncHistoryState(snapshot, sectionsRef.current);
        setSections(snapshot);
        setSelected(null);
        setMultiSelected(new Set());
        return;
      }
      // Ctrl+Y / Ctrl+Shift+Z: Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey)) && !focusedRef.current) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (redoStack.current.length === 0) return;
        const snapshot = redoStack.current[redoStack.current.length - 1];
        const curr = sectionsRef.current.map(s => ({ ...s, points: s.points.map(p => ({ ...p })), seats: s.seats?.map(st => ({ ...st })), rows: s.rows?.map(r => ({ ...r })) }));
        undoStack.current = [...undoStack.current.slice(-49), curr];
        redoStack.current = redoStack.current.slice(0, -1);
        syncHistoryState(snapshot, sectionsRef.current);
        setSections(snapshot);
        setSelected(null);
        setMultiSelected(new Set());
        return;
      }
      // Arrow keys — Shift+Arrow moves label (all sections); Arrow alone moves icon (venue objects + custom objects)
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) {
        const target = e.target as Element;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
        const sel = sectionsRef.current.find(s => s.id === selectedRef.current);
        if (!sel) return;
        const isVenueObj  = isVenueObject(sel.sectionType);
        const isCustomObj = sel.sectionType === "GA" && !!sel.customSvg && sel.customSvg !== "none";
        const isObj = isVenueObj || isCustomObj;
        if (!isObj && !e.shiftKey) return; // non-objects only respond to Shift+Arrow
        e.preventDefault();
        const step = (e.ctrlKey || e.metaKey) ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;

        if (e.shiftKey) {
          // Shift+Arrow — move text label (all section types)
          const newLabelOffset = { x: (sel.labelOffset?.x ?? 0) + dx, y: (sel.labelOffset?.y ?? 0) + dy };
          setSections(prev => prev.map(s => s.id === sel.id ? { ...s, labelOffset: newLabelOffset } : s));
          if (sel.saved) {
            if (iconOffsetPatchTimer.current) clearTimeout(iconOffsetPatchTimer.current);
            iconOffsetPatchTimer.current = setTimeout(() => {
              const latest = sectionsRef.current.find(s => s.id === sel.id);
              if (!latest) return;
              let n: Record<string, unknown> = { labelOffset: newLabelOffset };
              if (isCustomObj) {
                if (latest.customSvg)   n.customSvg   = latest.customSvg;
                if (latest.customColor) n.customColor = latest.customColor;
                if (latest.iconOffset)  n.iconOffset  = latest.iconOffset;
                if (latest.iconSize)    n.iconSize    = latest.iconSize;
                if (latest.labelSize)   n.labelSize   = latest.labelSize;
                if (latest.edgeCurve)   n.edgeCurve   = latest.edgeCurve;
              } else if (isVenueObj && sel.sectionType !== "WALL" && sel.sectionType !== "DOOR" && sel.sectionType !== "STAIRS") {
                if (latest.iconOffset) n.iconOffset = latest.iconOffset;
                if (latest.iconSize) n.iconSize = latest.iconSize;
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showIcon === false) n.showIcon = false;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (sel.sectionType === "DOOR" && latest.doorMeta) {
                n = { w: latest.doorMeta.w, h: latest.doorMeta.h, angle: latest.doorMeta.angle, labelOffset: newLabelOffset };
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (sel.sectionType === "STAIRS" && latest.stairsMeta) {
                n = { w: latest.stairsMeta.w, h: latest.stairsMeta.h, angle: latest.stairsMeta.angle, labelOffset: newLabelOffset };
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showLabel === false) n.showLabel = false;
              } else if (!isObj) {
                if (latest.labelSize) n.labelSize = latest.labelSize;
              }
              fetch(`/api/sections/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: JSON.stringify(n) }) });
            }, 400);
          }
        } else {
          // Arrow alone — move icon (venue objects + custom objects)
          const newIconOffset = { x: (sel.iconOffset?.x ?? 0) + dx, y: (sel.iconOffset?.y ?? 0) + dy };
          setSections(prev => prev.map(s => s.id === sel.id ? { ...s, iconOffset: newIconOffset } : s));
          if (sel.saved) {
            if (iconOffsetPatchTimer.current) clearTimeout(iconOffsetPatchTimer.current);
            iconOffsetPatchTimer.current = setTimeout(() => {
              const latest = sectionsRef.current.find(s => s.id === sel.id);
              if (!latest) return;
              let n: Record<string, unknown> = { iconOffset: newIconOffset };
              if (isCustomObj) {
                if (latest.customSvg)   n.customSvg   = latest.customSvg;
                if (latest.customColor) n.customColor = latest.customColor;
                if (latest.labelOffset) n.labelOffset = latest.labelOffset;
                if (latest.iconSize)    n.iconSize    = latest.iconSize;
                if (latest.labelSize)   n.labelSize   = latest.labelSize;
                if (latest.edgeCurve)   n.edgeCurve   = latest.edgeCurve;
              } else {
                if (latest.labelOffset) n.labelOffset = latest.labelOffset;
                if (latest.iconSize) n.iconSize = latest.iconSize;
                if (latest.labelSize) n.labelSize = latest.labelSize;
                if (latest.showIcon === false) n.showIcon = false;
                if (latest.showLabel === false) n.showLabel = false;
              }
              fetch(`/api/sections/${sel.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: JSON.stringify(n) }) });
            }, 400);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Zoom ──────────────────────────────────────────────────────────────
  // Must use a native (non-passive) wheel listener so preventDefault() actually blocks page scroll.
  // React's onWheel synthetic handler is passive since React 17 — calling preventDefault() there
  // produces a browser warning and has no effect.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      const t = transformRef.current;
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * (1 - e.deltaY * 0.001)));
      const sf = ns / t.scale;
      setTransform({ scale: ns, x: ox - sf * (ox - t.x), y: oy - sf * (oy - t.y) });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);
  const zoom = (factor: number) => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const ox = cw / 2, oy = ch / 2;
    setTransform(t => {
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.scale * factor));
      const sf = ns / t.scale;
      return { scale: ns, x: ox - sf * (ox - t.x), y: oy - sf * (oy - t.y) };
    });
  };
  const resetZoom = () => {
    if (!containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(cw / vw, ch / vh) * 0.85;
    setTransform({ scale, x: (cw - vw * scale) / 2, y: (ch - vh * scale) / 2 });
  };

  const fitToContent = () => {
    if (!containerRef.current) return;
    const secs = sectionsRef.current;
    if (secs.length === 0) { resetZoom(); return; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of secs) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      if (s.seats && s.seats.length > 0) {
        const disp = s.rows && s.rows.length > 0 ? getDisplaySeats(s.seats, s.rows) : s.seats;
        for (const seat of disp) {
          if (seat.x < minX) minX = seat.x; if (seat.x > maxX) maxX = seat.x;
          if (seat.y < minY) minY = seat.y; if (seat.y > maxY) maxY = seat.y;
        }
      }
    }
    if (!isFinite(minX)) { resetZoom(); return; }
    const pad = 60;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
      Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxY - minY))
    ));
    setTransform({ scale, x: (cw - (maxX - minX) * scale) / 2 - minX * scale, y: (ch - (maxY - minY) * scale) / 2 - minY * scale });
  };

  // Auto-fit to content on first load
  const hasAutoFit = useRef(false);
  useEffect(() => {
    if (sections.length > 0 && !hasAutoFit.current) {
      hasAutoFit.current = true;
      requestAnimationFrame(fitToContent);
    }
  }, [sections.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SVG coord helper ──────────────────────────────────────────────────
  const clientToSvg = (clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const t = transformRef.current;
    return { x: (clientX - rect.left - t.x) / t.scale, y: (clientY - rect.top - t.y) / t.scale };
  };

  // ── Mouse down ────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hasDragged.current = false;
    const target = e.target as Element;
    const t = transformRef.current;
    const focused = focusedRef.current;

    // Holds mode: seat click toggles selection directly (no focus mode needed)
    if (sidebarTabRef.current === "holds") {
      const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
      if (seatEl?.dataset.seatId) {
        const seatId = seatEl.dataset.seatId!;
        setSelectedSeats(prev => {
          const next = new Set(prev);
          if (next.has(seatId)) next.delete(seatId); else next.add(seatId);
          return next;
        });
        return;
      }
      // Shift+drag in holds mode → marquee select seats across all sections
      if (e.shiftKey) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: null };
        setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
        return;
      }
      // Empty canvas click in holds mode → just pan
      panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
      return;
    }

    if (toolRef.current === "select") {
      // 0. Group rotation handle (multi-selection)
      if (!focusedRef.current && target.closest("[data-group-rotation-handle]")) {
        const allPts = [...multiSelectedRef.current].flatMap(id => {
          const s = sectionsRef.current.find(sec => sec.id === id);
          return s ? s.points : [];
        });
        if (allPts.length > 0 && containerRef.current) {
          const bbox = polyBBox(allPts);
          const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
          const svgPt = clientToSvg(e.clientX, e.clientY);
          groupRotationDragState.current = {
            centerX: cx, centerY: cy,
            startAngle: Math.atan2(svgPt.y - cy, svgPt.x - cx),
            sections: [...multiSelectedRef.current].flatMap(id => {
              const s = sectionsRef.current.find(sec => sec.id === id);
              return s ? [{
                id,
                origPoints: s.points.map(p => ({ ...p })),
                origSeats: (s.seats ?? []).map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
                origTableAngle:  s.tableMeta?.angle,
                origDoorAngle:   s.doorMeta?.angle,
                origStairsAngle: s.stairsMeta?.angle,
                origTextAngle:   s.sectionType === "TEXT" ? (s.textAngle ?? 0) : undefined,
              }] : [];
            }),
          };
          return;
        }
      }

      // 1. Rotation handle
      const rotEl = target.closest("[data-rotation-handle]") as HTMLElement | null;
      if (rotEl) {
        const sectionId = rotEl.dataset.rotationHandle!;
        const s = sectionsRef.current.find(sec => sec.id === sectionId);
        if (s && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const svgX = (e.clientX - rect.left - transformRef.current.x) / transformRef.current.scale;
          const svgY = (e.clientY - rect.top  - transformRef.current.y) / transformRef.current.scale;
          // Rotation pivot — must match how the icon/label center is computed in the render:
          // • Seated sections: display-seat bbox center (curve/skew offsets included)
          // • All other sections (venue objects, GA polygons): vertex centroid of polygon.
          //   centroid is exactly preserved when all points are rotated around the centroid,
          //   so the icon/label stays pixel-perfect fixed throughout the drag.
          const cx = (() => {
            if (s.sectionType === "TEXT") {
              // Pivot at the text's visual center (centroid + labelOffset)
              const ctr = centroid(s.points);
              return { x: ctr.x + (s.labelOffset?.x ?? 0), y: ctr.y + (s.labelOffset?.y ?? 0) };
            }
            if (s.seats && s.seats.length > 0) {
              const ds = (s.rows && s.rows.length > 0)
                ? getDisplaySeats(s.seats, s.rows)
                : s.seats;
              const xs = ds.map(seat => seat.x);
              const ys = ds.map(seat => seat.y);
              return {
                x: (Math.min(...xs) + Math.max(...xs)) / 2,
                y: (Math.min(...ys) + Math.max(...ys)) / 2,
              };
            }
            return centroid(s.points);
          })();
          const hasRows = !!(s.rows && s.rows.length > 0 && s.seats && s.seats.length > 0);
          const dispSeats = hasRows
            ? getDisplaySeats(s.seats!, s.rows!)
            : (s.seats ?? []);
          rotationDragState.current = {
            sectionId, centerX: cx.x, centerY: cx.y,
            startAngle: Math.atan2(svgY - cx.y, svgX - cx.x),
            origPoints: s.points.map(p => ({ ...p })),
            origSeats: (s.seats ?? []).map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
            origDisplaySeats: dispSeats.map(seat => ({ id: seat.id, x: seat.x, y: seat.y })),
            sectionHasRows: hasRows,
            origTableAngle: s.tableMeta?.angle,
            origDoorAngle: s.doorMeta?.angle,
            origStairsAngle: s.stairsMeta?.angle,
            origTextAngle: s.sectionType === "TEXT" ? (s.textAngle ?? 0) : undefined,
          };
          return;
        }
      }

      // 2. Vertex handle
      const vertexEl = target.closest("[data-vertex-index]") as HTMLElement | null;
      if (vertexEl && !vertexEl.hasAttribute("data-section-id")) {
        const sectionEl = vertexEl.closest("[data-section-id]") as HTMLElement | null;
        if (sectionEl) {
          const sectionId = sectionEl.dataset.sectionId!;
          const s = sectionsRef.current.find(sec => sec.id === sectionId);
          if (s) {
            pushHistory();
            vertexDragState.current = {
              sectionId, vertexIndex: parseInt(vertexEl.dataset.vertexIndex!),
              startClientX: e.clientX, startClientY: e.clientY,
              origPoints: s.points.map(p => ({ ...p })),
              origDoorMeta: s.doorMeta ? { ...s.doorMeta } : undefined,
              origStairsMeta: s.stairsMeta ? { ...s.stairsMeta } : undefined,
              origTableMeta: s.tableMeta ? { ...s.tableMeta } : undefined,
            };
            return;
          }
        }
      }

      if (focused) {
        // 2. Row label click (focus mode) – track for rename on mouseup
        const rowEl = target.closest("[data-row-id]") as HTMLElement | null;
        if (rowEl) {
          rowLabelDownRef.current = { rowId: rowEl.dataset.rowId!, screenX: e.clientX, screenY: e.clientY };
          panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
          return;
        }

        // 3. Seat drag / click (focus mode)
        const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
        const seatSecEl = seatEl?.closest("[data-section-id]") as HTMLElement | null;
        if (seatEl && seatSecEl?.dataset.sectionId === focused) {
          const seatId = seatEl.dataset.seatId!;
          const section = sectionsRef.current.find(s => s.id === focused);
          if (section) {
            if (e.shiftKey) {
              setSelectedSeats(prev => {
                const next = new Set(prev);
                if (next.has(seatId)) next.delete(seatId); else next.add(seatId);
                return next;
              });
              return;
            }
            const selectedNow = selectedSeatsRef.current;
            const dragSeats = selectedNow.has(seatId)
              ? section.seats?.filter(s => selectedNow.has(s.id)) ?? []
              : section.seats?.filter(s => s.id === seatId) ?? [];
            if (!selectedNow.has(seatId)) setSelectedSeats(new Set([seatId]));
            seatDragState.current = {
              primarySeatId: seatId,
              origSeats: dragSeats.map(s => ({ id: s.id, x: s.x, y: s.y })),
              startClientX: e.clientX, startClientY: e.clientY,
              sectionId: focused,
            };
            return;
          }
        }

        // 4. Shift+drag → marquee select
        if (e.shiftKey) {
          const svgPt = clientToSvg(e.clientX, e.clientY);
          marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: focused };
          setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
          return;
        }
      }

      // 5. Shift+drag in editor (non-focus) → marquee select objects/sections
      if (e.shiftKey && !focused) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        marqueeStateRef.current = { startSvgX: svgPt.x, startSvgY: svgPt.y, sectionId: null };
        setMarqueeRect({ x1: svgPt.x, y1: svgPt.y, x2: svgPt.x, y2: svgPt.y });
        return;
      }

      // 6. Section body drag
      const sectionEl = target.closest("[data-section-id]") as HTMLElement | null;
      if (sectionEl) {
        const sectionId = sectionEl.dataset.sectionId!;
        const s = sectionsRef.current.find(sec => sec.id === sectionId);
        if (s) {
          if (e.shiftKey) {
            // Shift+click: toggle in multi-selection
            setMultiSelected(prev => {
              const next = new Set(prev);
              if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
              return next;
            });
            if (!selectedRef.current) setSelected(sectionId);
            return;
          }
          // If not in multi-selection, reset it to just this section
          if (!multiSelectedRef.current.has(sectionId)) {
            setMultiSelected(new Set([sectionId]));
          }
          // Set selected immediately so isSel = true right away (prevents flash of multiSelected dashed outline)
          if (!e.shiftKey) setSelected(sectionId);
          pushHistory();
          // Build extra sections for simultaneous drag
          const allSel = multiSelectedRef.current.size > 1 ? [...multiSelectedRef.current] : [sectionId];
          const extra = allSel
            .filter(id => id !== sectionId)
            .flatMap(id => {
              const sec = sectionsRef.current.find(sec2 => sec2.id === id);
              return sec ? [{ id, origPoints: sec.points.map(p => ({ ...p })), origSeats: (sec.seats ?? []).map(seat => ({ ...seat })) }] : [];
            });
          sectionDragState.current = {
            sectionId,
            startClientX: e.clientX, startClientY: e.clientY,
            origPoints: s.points.map(p => ({ ...p })),
            origSeats: (s.seats ?? []).map(seat => ({ ...seat })),
            downTarget: target,
            extra,
          };
          return;
        }
      }
    }

    if (toolRef.current === "table") {
      const pt = clientToSvg(e.clientX, e.clientY);
      setTableDraft({ startPt: pt, endPt: pt });
      return;
    }

    panState.current = { startX: e.clientX, startY: e.clientY, startTx: t.x, startTy: t.y };
  };

  // ── Mouse move ────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const t = transformRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    setMouse({ x: (e.clientX - rect.left - t.x) / t.scale, y: (e.clientY - rect.top - t.y) / t.scale });

    if (groupRotationDragState.current) {
      const { centerX, centerY, startAngle, sections } = groupRotationDragState.current;
      if (!hasDragged.current) hasDragged.current = true;
      const svgX = (e.clientX - rect.left - t.x) / t.scale;
      const svgY = (e.clientY - rect.top  - t.y) / t.scale;
      const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rotPt = (p: Point) => ({
        x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
        y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
      });
      const angleDeg = angle * (180 / Math.PI);
      setSections(prev => prev.map(s => {
        const orig = sections.find(sec => sec.id === s.id);
        if (!orig) return s;
        const next: typeof s = {
          ...s,
          points: orig.origPoints.map(rotPt),
          seats: s.seats?.map(seat => {
            const o = orig.origSeats.find(os => os.id === seat.id);
            return o ? { ...seat, ...rotPt(o) } : seat;
          }),
        };
        if (next.tableMeta && orig.origTableAngle !== undefined)
          next.tableMeta = { ...next.tableMeta, angle: orig.origTableAngle + angleDeg };
        if (next.doorMeta && orig.origDoorAngle !== undefined)
          next.doorMeta = { ...next.doorMeta, angle: orig.origDoorAngle + angleDeg };
        if (next.stairsMeta && orig.origStairsAngle !== undefined)
          next.stairsMeta = { ...next.stairsMeta, angle: orig.origStairsAngle + angleDeg };
        if (next.sectionType === "TEXT" && orig.origTextAngle !== undefined)
          next.textAngle = orig.origTextAngle + angleDeg;
        return next;
      }));

    } else if (rotationDragState.current) {
      const { centerX, centerY, startAngle, sectionId, origPoints, origSeats, origDisplaySeats, sectionHasRows, origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } = rotationDragState.current;
      if (!hasDragged.current) hasDragged.current = true;
      const svgX = (e.clientX - rect.left - t.x) / t.scale;
      const svgY = (e.clientY - rect.top  - t.y) / t.scale;
      const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rotate = (p: { x: number; y: number }) => ({
        x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
        y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
      });
      setSections(prev => prev.map(s => {
        if (s.id !== sectionId) return s;
        const angleDeg = angle * (180 / Math.PI);
        // TEXT: only update textAngle — polygon stays fixed (it's just a tiny hit-area placeholder)
        if (s.sectionType === "TEXT" && origTextAngle !== undefined) {
          return { ...s, textAngle: origTextAngle + angleDeg };
        }
        // DOOR: only update doorMeta.angle — polygon corners stay fixed so the SVG center never drifts
        if (s.doorMeta !== undefined && origDoorAngle !== undefined) {
          return { ...s, doorMeta: { ...s.doorMeta, angle: origDoorAngle + angleDeg } };
        }
        // STAIRS: only update stairsMeta.angle — same rationale as DOOR
        if (s.stairsMeta !== undefined && origStairsAngle !== undefined) {
          return { ...s, stairsMeta: { ...s.stairsMeta, angle: origStairsAngle + angleDeg } };
        }
        const next: typeof s = {
          ...s,
          points: origPoints.map(rotate),
          seats: sectionHasRows
            // Rotate display (curve-applied) positions and store as raw — zero out curve/skew so getDisplaySeats adds no extra offset
            ? s.seats?.map(seat => {
                const orig = origDisplaySeats.find(o => o.id === seat.id);
                return orig ? { ...seat, ...rotate(orig) } : seat;
              })
            : s.seats?.map(seat => {
                const orig = origSeats.find(o => o.id === seat.id);
                return orig ? { ...seat, ...rotate(orig) } : seat;
              }),
          // Zero out curve/skew so getDisplaySeats is a no-op and baked-in positions display correctly
          rows: sectionHasRows
            ? s.rows?.map(r => ({ ...r, curve: 0, skew: 0 }))
            : s.rows,
        };
        // For TABLE sections, rotate tableMeta.angle so the surface follows
        if (next.tableMeta !== undefined && origTableAngle !== undefined) {
          next.tableMeta = { ...next.tableMeta, angle: origTableAngle + angleDeg };
        }
        return next;
      }));

    } else if (seatDragState.current) {
      const { startClientX, startClientY, origSeats, sectionId } = seatDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 3) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      const section = sectionsRef.current.find(s => s.id === sectionId);
      if (!section) return;
      const bbox = polyBBox(section.points);
      const r = seatRadiusRef.current;
      const isTable = section.sectionType === "TABLE";
      const origMap = new Map(origSeats.map(o => [o.id, o]));
      setSections(prev => prev.map(s => s.id !== sectionId ? s : {
        ...s,
        seats: s.seats?.map(seat => {
          const orig = origMap.get(seat.id);
          if (!orig) return seat;
          return {
            ...seat,
            x: isTable ? orig.x + sdx : Math.max(bbox.minX + r, Math.min(bbox.maxX - r, orig.x + sdx)),
            y: isTable ? orig.y + sdy : Math.max(bbox.minY + r, Math.min(bbox.maxY - r, orig.y + sdy)),
          };
        }),
      }));

    } else if (marqueeStateRef.current) {
      const svgPt = clientToSvg(e.clientX, e.clientY);
      if (!hasDragged.current) hasDragged.current = true;
      setMarqueeRect(prev => prev ? { ...prev, x2: svgPt.x, y2: svgPt.y } : null);

    } else if (vertexDragState.current) {
      const { startClientX, startClientY, sectionId, vertexIndex, origPoints, origDoorMeta, origStairsMeta, origTableMeta } = vertexDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 2) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      setSections(prev => prev.map(s => {
        if (s.id !== sectionId) return s;
        // DOOR: maintain rectangle shape — fix opposite corner, resize from dragged corner
        if (s.sectionType === "DOOR" && origDoorMeta) {
          const angle = origDoorMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(10, Math.abs(ddx * cosA + ddy * sinA));
          const newH = Math.max(10, Math.abs(-ddx * sinA + ddy * cosA));
          return { ...s, points: doorRectPoints(newCx, newCy, newW, newH, angle), doorMeta: { ...origDoorMeta, w: newW, h: newH } };
        }
        if (s.sectionType === "STAIRS" && origStairsMeta) {
          const angle = origStairsMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(10, Math.abs(ddx * cosA + ddy * sinA));
          const newH = Math.max(10, Math.abs(-ddx * sinA + ddy * cosA));
          return { ...s, points: doorRectPoints(newCx, newCy, newW, newH, angle), stairsMeta: { ...origStairsMeta, w: newW, h: newH } };
        }
        if (s.sectionType === "TABLE" && origTableMeta) {
          const angle = origTableMeta.angle;
          const newCorner = { x: origPoints[vertexIndex].x + sdx, y: origPoints[vertexIndex].y + sdy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          // tableBoundingPoints adds PAD=30 on each side, so bbox span = meta.w + 60.
          // Subtract 60 to recover the actual table surface dimensions.
          const newW = Math.max(40, Math.abs(ddx * cosA + ddy * sinA) - 60);
          const newH = Math.max(30, Math.abs(-ddx * sinA + ddy * cosA) - 60);
          const newMeta = { ...origTableMeta, w: newW, h: newH };
          const newChairPts = computeChairPositions(newMeta, newCx, newCy);
          const updatedSeats = s.seats && s.seats.length > 0
            ? s.seats.map((seat, i) => i < newChairPts.length ? { ...seat, x: newChairPts[i].x, y: newChairPts[i].y } : seat)
            : s.seats;
          return { ...s, points: tableBoundingPoints(newMeta, newCx, newCy), tableMeta: newMeta, seats: updatedSeats };
        }
        return { ...s, points: origPoints.map((p, i) => i === vertexIndex ? { x: p.x + sdx, y: p.y + sdy } : { ...p }) };
      }));

    } else if (sectionDragState.current) {
      const { startClientX, startClientY, sectionId, origPoints, origSeats, extra } = sectionDragState.current;
      const dx = e.clientX - startClientX, dy = e.clientY - startClientY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 4) hasDragged.current = true;
      if (!hasDragged.current) return;
      const sdx = dx / t.scale, sdy = dy / t.scale;
      const extraMap = new Map(extra.map(x => [x.id, x]));
      setSections(prev => prev.map(s => {
        if (s.id === sectionId) return { ...s, points: origPoints.map(p => ({ x: p.x + sdx, y: p.y + sdy })), seats: origSeats.map(seat => ({ ...seat, x: seat.x + sdx, y: seat.y + sdy })) };
        const ex = extraMap.get(s.id);
        if (ex) return { ...s, points: ex.origPoints.map(p => ({ x: p.x + sdx, y: p.y + sdy })), seats: ex.origSeats.map(seat => ({ ...seat, x: seat.x + sdx, y: seat.y + sdy })) };
        return s;
      }));

    } else if (tableDraftRef.current) {
      const pt = clientToSvg(e.clientX, e.clientY);
      setTableDraft(prev => prev ? { ...prev, endPt: pt } : null);

    } else if (panState.current) {
      const { startX, startY, startTx, startTy } = panState.current;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!hasDragged.current && Math.hypot(dx, dy) > 4) hasDragged.current = true;
      if (!hasDragged.current) return;
      setTransform(prev => ({ ...prev, x: startTx + dx, y: startTy + dy }));
    }
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const t = transformRef.current;

    // Group rotation drag
    if (groupRotationDragState.current) {
      const { centerX, centerY, startAngle, sections } = groupRotationDragState.current;
      groupRotationDragState.current = null;
      if (hasDragged.current) {
        const r = containerRef.current!.getBoundingClientRect();
        const svgX = (e.clientX - r.left - t.x) / t.scale;
        const svgY = (e.clientY - r.top  - t.y) / t.scale;
        const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
        const angleDeg = angle * (180 / Math.PI);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const rotPt = (p: { x: number; y: number }) => ({
          x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
          y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
        });
        for (const { id, origPoints, origSeats, origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } of sections) {
          const sec = sectionsRef.current.find(s => s.id === id);
          if (!sec?.saved) continue;
          const finalPts = origPoints.map(rotPt);
          const finalSeats = origSeats.map(s => ({ id: s.id, ...rotPt(s) }));
          let notes: string | undefined;
          if (sec.sectionType === "TEXT" && origTextAngle !== undefined) {
            const n: Record<string, unknown> = { textAngle: origTextAngle + angleDeg };
            if (sec.textColor) n.textColor = sec.textColor;
            if (sec.textBold) n.textBold = sec.textBold;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            notes = JSON.stringify(n);
          } else if (sec.tableMeta && origTableAngle !== undefined) {
            notes = JSON.stringify({ ...sec.tableMeta, angle: origTableAngle + angleDeg });
          } else if (sec.doorMeta && origDoorAngle !== undefined) {
            const n: Record<string, unknown> = { w: sec.doorMeta.w, h: sec.doorMeta.h, angle: origDoorAngle + angleDeg };
            if (sec.showLabel === false) n.showLabel = false;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            notes = JSON.stringify(n);
          } else if (sec.stairsMeta && origStairsAngle !== undefined) {
            const n: Record<string, unknown> = { w: sec.stairsMeta.w, h: sec.stairsMeta.h, angle: origStairsAngle + angleDeg };
            if (sec.showLabel === false) n.showLabel = false;
            if (sec.labelOffset) n.labelOffset = sec.labelOffset;
            if (sec.labelSize) n.labelSize = sec.labelSize;
            notes = JSON.stringify(n);
          }
          await fetch(`/api/sections/${id}/rotate`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(finalPts), seats: finalSeats, ...(notes !== undefined ? { notes } : {}) }),
          });
        }
      }
      hasDragged.current = false;
      return;
    }

    // Rotation drag
    if (rotationDragState.current) {
      // Capture the full drag state BEFORE clearing — sectionsRef may be stale (useEffect
      // updates it after render, but we're still inside the event handler right now).
      const drag = rotationDragState.current;
      rotationDragState.current = null;
      if (hasDragged.current) {
        const { sectionId, centerX, centerY, startAngle,
                origPoints, origSeats, origDisplaySeats, sectionHasRows,
                origTableAngle, origDoorAngle, origStairsAngle, origTextAngle } = drag;

        // Recompute final angle from cursor (same formula as mousemove)
        const rect = containerRef.current!.getBoundingClientRect();
        const svgX = (e.clientX - rect.left - t.x) / t.scale;
        const svgY = (e.clientY - rect.top  - t.y) / t.scale;
        const angle = Math.atan2(svgY - centerY, svgX - centerX) - startAngle;
        const angleDeg = angle * (180 / Math.PI);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const rotPt = (p: { x: number; y: number }) => ({
          x: centerX + (p.x - centerX) * cos - (p.y - centerY) * sin,
          y: centerY + (p.x - centerX) * sin + (p.y - centerY) * cos,
        });

        // Grab the section from ref only for metadata (doorMeta etc.) — not for positions
        const section = sectionsRef.current.find(s => s.id === sectionId);

        if (origTextAngle !== undefined && section?.sectionType === "TEXT") {
          const finalTextAngle = origTextAngle + angleDeg;
          const n: Record<string, unknown> = { textAngle: finalTextAngle };
          if (section.textColor) n.textColor = section.textColor;
          if (section.textBold) n.textBold = section.textBold;
          if (section.labelSize) n.labelSize = section.labelSize;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.saved) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: JSON.stringify(n) }),
            });
          }
        } else if (origDoorAngle !== undefined && section?.doorMeta) {
          const m = section.doorMeta;
          const n: Record<string, unknown> = { w: m.w, h: m.h, angle: origDoorAngle + angleDeg };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: JSON.stringify(n) }),
          });
        } else if (origStairsAngle !== undefined && section?.stairsMeta) {
          const m = section.stairsMeta;
          const n: Record<string, unknown> = { w: m.w, h: m.h, angle: origStairsAngle + angleDeg };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: JSON.stringify(n) }),
          });
        } else {
          // Compute final positions directly from drag-state snapshots — never from stale ref
          const finalPoints = origPoints.map(rotPt);
          const finalSeats = sectionHasRows
            ? origDisplaySeats.map(s => ({ id: s.id, ...rotPt(s) }))
            : origSeats.map(s => ({ id: s.id, ...rotPt(s) }));

          await fetch(`/api/sections/${sectionId}/rotate`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(finalPoints), seats: finalSeats }),
          });
          // Bake curve/skew=0 into DB for sections with rows
          if (sectionHasRows && section?.rows?.length) {
            await Promise.all(section.rows.map(row =>
              fetch(`/api/rows/${row.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ curve: 0, skew: 0 }),
              })
            ));
          }
          // TABLE: persist the updated angle in notes
          if (origTableAngle !== undefined && section?.tableMeta) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ notes: JSON.stringify({ ...section.tableMeta, angle: origTableAngle + angleDeg }) }),
            });
          }
          // Also rotate all other multi-selected sections by the same angle
          const otherIds = [...multiSelectedRef.current].filter(id => id !== sectionId);
          for (const otherId of otherIds) {
            const other = sectionsRef.current.find(s => s.id === otherId);
            if (!other || !other.saved) continue;
            const oc = centroid(other.points);
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const rotOther = (p: Point) => ({
              x: oc.x + (p.x - oc.x) * cosA - (p.y - oc.y) * sinA,
              y: oc.y + (p.x - oc.x) * sinA + (p.y - oc.y) * cosA,
            });
            const finalPts = other.points.map(rotOther);
            const finalSts = (other.seats ?? []).map(s => ({ id: s.id, ...rotOther(s) }));
            setSections(prev => prev.map(s => s.id !== otherId ? s : {
              ...s,
              points: finalPts,
              seats: s.seats?.map(seat => { const f = finalSts.find(fs => fs.id === seat.id); return f ? { ...seat, x: f.x, y: f.y } : seat; }),
            }));
            if (other.sectionType !== "DOOR" && other.sectionType !== "STAIRS") {
              await fetch(`/api/sections/${otherId}/rotate`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ polygonPath: pointsToPath(finalPts), seats: finalSts }),
              });
            }
          }
        }
      }
      hasDragged.current = false;
      return;
    }

    // Row label click
    if (rowLabelDownRef.current) {
      const info = rowLabelDownRef.current;
      rowLabelDownRef.current = null;
      panState.current = null;
      if (!hasDragged.current) {
        const section = sectionsRef.current.find(s => s.id === focusedRef.current);
        const row = section?.rows?.find(r => r.id === info.rowId);
        if (row) setEditingRow({ id: info.rowId, value: row.label, screenX: info.screenX, screenY: info.screenY });
      }
      hasDragged.current = false;
      return;
    }

    if (seatDragState.current) {
      const { primarySeatId, origSeats, startClientX, startClientY, sectionId } = seatDragState.current;
      seatDragState.current = null;
      if (hasDragged.current) {
        const dx = (e.clientX - startClientX) / t.scale;
        const dy = (e.clientY - startClientY) / t.scale;
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section) {
          const bbox = polyBBox(section.points);
          const r = seatRadiusRef.current;
          const isTable = section.sectionType === "TABLE";
          const seatUpdates = origSeats.map(orig => ({
            id: orig.id,
            x: isTable ? orig.x + dx : Math.max(bbox.minX + r, Math.min(bbox.maxX - r, orig.x + dx)),
            y: isTable ? orig.y + dy : Math.max(bbox.minY + r, Math.min(bbox.maxY - r, orig.y + dy)),
          }));
          if (seatUpdates.length > 0) {
            await fetch(`/api/sections/${sectionId}/seats/positions`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ updates: seatUpdates }),
            });
          }
        }
      } else if (origSeats.length === 1) {
        // Single-click just selects the seat — editing opens on double-click
        setSelectedSeats(new Set([primarySeatId]));
      }

    } else if (marqueeStateRef.current) {
      const { startSvgX, startSvgY, sectionId } = marqueeStateRef.current;
      marqueeStateRef.current = null;
      const svgPt = clientToSvg(e.clientX, e.clientY);
      const box = { x1: startSvgX, y1: startSvgY, x2: svgPt.x, y2: svgPt.y };
      if (sectionId === null) {
        // Global marquee: holds mode → select seats across all sections; editor → select sections
        if (sidebarTabRef.current === "holds") {
          const ids: string[] = [];
          for (const s of sectionsRef.current) {
            if (!s.seats) continue;
            const displaySeats = (s.rows && s.rows.length > 0) ? getDisplaySeats(s.seats, s.rows) : s.seats;
            for (const seat of displaySeats) { if (rectContains(box, seat)) ids.push(seat.id); }
          }
          setSelectedSeats(new Set(ids));
        } else {
          // Select sections whose centroid falls inside the marquee
          const ids = sectionsRef.current
            .filter(s => { const c = centroid(s.points); return rectContains(box, c); })
            .map(s => s.id);
          if (ids.length > 0) {
            setMultiSelected(new Set(ids));
            setSelected(ids[0]);
          }
        }
      } else {
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section?.seats) {
          const displaySeats = (section.rows && section.rows.length > 0)
            ? getDisplaySeats(section.seats, section.rows)
            : section.seats;
          setSelectedSeats(new Set(displaySeats.filter(seat => rectContains(box, seat)).map(s => s.id)));
        }
      }
      setMarqueeRect(null);

    } else if (vertexDragState.current) {
      const { sectionId, vertexIndex, startClientX, startClientY, origPoints, origTableMeta } = vertexDragState.current;
      vertexDragState.current = null;
      if (hasDragged.current) {
        const section = sectionsRef.current.find(s => s.id === sectionId);
        if (section?.sectionType === "DOOR" && section.doorMeta) {
          const n: Record<string, unknown> = { w: section.doorMeta.w, h: section.doorMeta.h, angle: section.doorMeta.angle };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(section.points), notes: JSON.stringify(n) }),
          });
        } else if (section?.sectionType === "STAIRS" && section.stairsMeta) {
          const n: Record<string, unknown> = { w: section.stairsMeta.w, h: section.stairsMeta.h, angle: section.stairsMeta.angle };
          if (section.showLabel === false) n.showLabel = false;
          if (section.labelOffset) n.labelOffset = section.labelOffset;
          if (section.labelSize) n.labelSize = section.labelSize;
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(section.points), notes: JSON.stringify(n) }),
          });
        } else if (section?.sectionType === "TABLE" && origTableMeta) {
          // Recompute final meta from drag delta (avoids stale sectionsRef)
          const dx = (e.clientX - startClientX) / t.scale;
          const dy = (e.clientY - startClientY) / t.scale;
          const newCorner = { x: origPoints[vertexIndex].x + dx, y: origPoints[vertexIndex].y + dy };
          const opp = origPoints[(vertexIndex + 2) % 4];
          const newCx = (newCorner.x + opp.x) / 2, newCy = (newCorner.y + opp.y) / 2;
          const rad = (origTableMeta.angle * Math.PI) / 180;
          const cosA = Math.cos(rad), sinA = Math.sin(rad);
          const ddx = newCorner.x - opp.x, ddy = newCorner.y - opp.y;
          const newW = Math.max(40, Math.abs(ddx * cosA + ddy * sinA) - 60);
          const newH = Math.max(30, Math.abs(-ddx * sinA + ddy * cosA) - 60);
          const newMeta = { ...origTableMeta, w: newW, h: newH };
          const newPts = tableBoundingPoints(newMeta, newCx, newCy);
          upd(sectionId, { tableMeta: newMeta, points: newPts });
          if (section.saved) {
            await fetch(`/api/sections/${sectionId}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ polygonPath: pointsToPath(newPts), notes: JSON.stringify(newMeta) }),
            });
            // Recreate chairs at new positions
            const newChairPts = computeChairPositions(newMeta, newCx, newCy);
            if (section.rows?.[0]) {
              await fetch(`/api/rows/${section.rows[0].id}`, { method: "DELETE" });
              const rowRes = await fetch(`/api/sections/${sectionId}/rows`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  label: "chairs", startX: newCx, startY: newCy,
                  seats: newChairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
                }),
              });
              const savedRow = await rowRes.json();
              upd(sectionId, {
                rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
                seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
                  id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
                  rowLabel: "chairs", rowId: savedRow.id,
                })),
              });
            }
          }
        } else {
          const dx = (e.clientX - startClientX) / t.scale;
          const dy = (e.clientY - startClientY) / t.scale;
          const newPoints = origPoints.map((p, i) => i === vertexIndex ? { x: p.x + dx, y: p.y + dy } : { ...p });
          await fetch(`/api/sections/${sectionId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ polygonPath: pointsToPath(newPoints) }),
          });
        }
      }

    } else if (sectionDragState.current) {
      const { sectionId, startClientX, startClientY, origPoints, origSeats, extra } = sectionDragState.current;
      sectionDragState.current = null;
      if (!hasDragged.current) {
        setSelected(sectionId);
        if (!e.shiftKey) setMultiSelected(new Set([sectionId]));
      } else {
        const dx = (e.clientX - startClientX) / t.scale;
        const dy = (e.clientY - startClientY) / t.scale;
        const allToSave = [
          { id: sectionId, origPoints, origSeats },
          ...extra.map(x => ({ id: x.id, origPoints: x.origPoints, origSeats: x.origSeats })),
        ];
        for (const item of allToSave) {
          const sec = sectionsRef.current.find(s => s.id === item.id);
          if (sec?.saved) {
            await fetch(`/api/sections/${item.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ polygonPath: pointsToPath(item.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy }))) }),
            });
            if (item.origSeats.length > 0) {
              await fetch(`/api/sections/${item.id}/move`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dx, dy }),
              });
            }
          }
        }
      }

    } else if (tableDraftRef.current) {
      const draft = tableDraftRef.current;
      setTableDraft(null);
      const dx = Math.abs(draft.endPt.x - draft.startPt.x);
      const dy = Math.abs(draft.endPt.y - draft.startPt.y);
      if (dx > 20 || dy > 20) {
        const cx = (draft.startPt.x + draft.endPt.x) / 2;
        const cy = (draft.startPt.y + draft.endPt.y) / 2;
        const meta: TableMeta = { ...tableCfg, w: Math.max(40, dx), h: Math.max(30, dy), angle: 0 };
        const pts = tableBoundingPoints(meta, cx, cy);
        const id = crypto.randomUUID();
        const tableNum = sectionsRef.current.filter(s => s.sectionType === "TABLE").length + 1;
        pushHistory();
        setSections(prev => [...prev, {
          id, name: `Table ${tableNum}`, label: `T${tableNum}`,
          sectionType: "TABLE", points: pts, saved: false, edgeCurve: 0, tableMeta: meta,
        }]);
        setSelected(id);
        setTool("select");
      }

    } else if (panState.current) {
      panState.current = null;
      if (!hasDragged.current) {
        if (toolRef.current === "seated") {
          const pt = clientToSvg(e.clientX, e.clientY);
          setSeatedPlacement(pt);
          hasDragged.current = false; return;
        }

        if (toolRef.current === "text") {
          const pt = clientToSvg(e.clientX, e.clientY);
          const textNum = sectionsRef.current.filter(s => s.sectionType === "TEXT").length + 1;
          const id = crypto.randomUUID();
          // Tiny 2x2 invisible polygon as hit area, centered at click point
          const pts = [
            { x: pt.x - 1, y: pt.y - 1 }, { x: pt.x + 1, y: pt.y - 1 },
            { x: pt.x + 1, y: pt.y + 1 }, { x: pt.x - 1, y: pt.y + 1 },
          ];
          pushHistory();
          setSections(p => [...p, {
            id, name: `Text ${textNum}`, label: `Text ${textNum}`,
            sectionType: "TEXT" as DraftSection["sectionType"],
            points: pts, saved: false, edgeCurve: 0,
            textColor: "#ffffff", labelSize: 18,
          }]);
          setSelected(id);
          setTextEditId(id);
          setTool("select");
          hasDragged.current = false; return;
        }

        if (toolRef.current === "polygon" || toolRef.current === "object") {
          const pt = clientToSvg(e.clientX, e.clientY);
          const d = drawingRef.current;

          if (d.length >= 2 && Math.hypot(pt.x - d[0].x, pt.y - d[0].y) < 20 / t.scale) {
            finishPolygon(); hasDragged.current = false; return;
          }
          setDrawing(prev => [...prev, pt]);
        } else {
          if (focusedRef.current) exitFocus();
          else { setSelected(null); setMultiSelected(new Set()); }
        }
      }
    }
    hasDragged.current = false;
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolRef.current === "polygon" || toolRef.current === "object") { finishPolygon(); return; }
    const target = e.target as Element;
    // Double-click on a seat → open seat editor
    const seatEl = target.closest("[data-seat-id]") as HTMLElement | null;
    if (seatEl) {
      const seatId = seatEl.dataset.seatId!;
      const sectionId = focusedRef.current;
      if (!sectionId) return;
      const section = sectionsRef.current.find(s => s.id === sectionId);
      const seat = section?.seats?.find(s => s.id === seatId);
      if (seat) setEditingSeat({ id: seat.id, value: seat.seatNumber, shape: seat.shape ?? seatShape, sectionId, screenX: e.clientX, screenY: e.clientY });
      return;
    }
    const sectionEl = target.closest("[data-section-id]") as HTMLElement | null;
    if (sectionEl) {
      const sectionId = sectionEl.dataset.sectionId!;
      const s = sectionsRef.current.find(sec => sec.id === sectionId);
      if (!s) return;
      if (s.sectionType === "TABLE") {
        setEditingTable({ sectionId: s.id, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      if (s.sectionType === "TEXT") {
        setTextEditId(s.id);
        setSelected(s.id);
        return;
      }
      if (s.seats && s.seats.length > 0) focusSection(sectionId);
    }
  };

  const handleMouseLeave = () => {
    panState.current = null;
    sectionDragState.current = null;
    rotationDragState.current = null;
    groupRotationDragState.current = null;
  };

  // ── Polygon ───────────────────────────────────────────────────────────
  const finishPolygon = () => {
    const d = drawingRef.current;
    if (d.length < 3) return;
    pushHistory();
    const id = crypto.randomUUID();
    const isObj = toolRef.current === "object";
    const objName = isObj ? (objectDraftNameRef.current.trim() || "Custom Object") : "";
    setSections(p => [...p, {
      id,
      name:  isObj ? objName : `Section ${p.length + 1}`,
      label: isObj ? objName : `S${p.length + 1}`,
      sectionType: "GA" as DraftSection["sectionType"],
      customSvg: isObj ? (objectDraftSvgRef.current ?? "none") : undefined,
      points: [...d], saved: false, edgeCurve: 0,
    }]);
    setDrawing([]);
    setSelected(id);
    setTool("select");
    if (isObj) {
      setObjectDraftName("");
      setObjectDraftSvg(undefined);
    }
  };

  // ── Section save ──────────────────────────────────────────────────────
  const saveSection = async (s: DraftSection) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: s.name, label: s.label, sectionType: s.sectionType, polygonPath: pointsToPath(s.points),
      };
      if (s.sectionType === "DOOR" && s.doorMeta) {
        const n: Record<string, unknown> = { w: s.doorMeta.w, h: s.doorMeta.h, angle: s.doorMeta.angle };
        if (s.showLabel === false) n.showLabel = false;
        if (s.labelOffset) n.labelOffset = s.labelOffset;
        if (s.labelSize) n.labelSize = s.labelSize;
        body.notes = JSON.stringify(n);
      } else if (s.sectionType === "STAIRS" && s.stairsMeta) {
        const n: Record<string, unknown> = { w: s.stairsMeta.w, h: s.stairsMeta.h, angle: s.stairsMeta.angle };
        if (s.showLabel === false) n.showLabel = false;
        if (s.labelOffset) n.labelOffset = s.labelOffset;
        if (s.labelSize) n.labelSize = s.labelSize;
        body.notes = JSON.stringify(n);
      } else if (s.sectionType === "TEXT") {
        const notesObj: Record<string, unknown> = {};
        if (s.textColor) notesObj.textColor = s.textColor;
        if (s.textBold) notesObj.textBold = s.textBold;
        if (s.textAngle) notesObj.textAngle = s.textAngle;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      } else if (s.sectionType !== "WALL" && isVenueObject(s.sectionType)) {
        const notesObj: Record<string, unknown> = {};
        if (s.iconOffset) notesObj.iconOffset = s.iconOffset;
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (s.iconSize) notesObj.iconSize = s.iconSize;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.showIcon === false) notesObj.showIcon = false;
        if (s.showLabel === false) notesObj.showLabel = false;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      } else if (!isVenueObject(s.sectionType) && s.sectionType !== "TABLE") {
        const notesObj: Record<string, unknown> = {};
        if (s.labelOffset) notesObj.labelOffset = s.labelOffset;
        if (s.labelSize) notesObj.labelSize = s.labelSize;
        if (s.edgeCurve) notesObj.edgeCurve = s.edgeCurve;
        if (s.capacity !== undefined) notesObj.capacity = s.capacity;
        if (s.maxPerOrder !== undefined) notesObj.maxPerOrder = s.maxPerOrder;
        if (s.hideSeats)     notesObj.hideSeats    = s.hideSeats;
        if (s.customSvg)     notesObj.customSvg    = s.customSvg;
        if (s.customColor)   notesObj.customColor  = s.customColor;
        if (s.iconSize)      notesObj.iconSize     = s.iconSize;
        if (s.iconOffset)    notesObj.iconOffset   = s.iconOffset;
        if (s.noOrphanSeats) notesObj.noOrphanSeats = s.noOrphanSeats;
        if (Object.keys(notesObj).length > 0) body.notes = JSON.stringify(notesObj);
      }
      if (s.saved) {
        await fetch(`/api/sections/${s.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (s.zoneId) await fetch(`/api/sections/${s.id}/zone`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: s.zoneId }),
        });
      } else {
        const res = await fetch(`/api/maps/${mapId}/sections`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const saved = await res.json();
        if (s.zoneId) await fetch(`/api/sections/${saved.id}/zone`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: s.zoneId }),
        });
        upd(s.id, { saved: true, id: saved.id });
      }
    } finally { setSaving(false); }
  };

  // ── Generate rows ─────────────────────────────────────────────────────
  const generateRows = async () => {
    if (!selected) return;
    const sectionId = selected;
    pushHistory();
    setSaving(true);
    try {
      const { count, seatsPerRow, startX, startY, spacingX, spacingY,
              rowLabelType, rowStart, seatOrder, seatStart } = rowCfg;
      type FR = { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string }[] };
      const rowsPayload = Array.from({ length: count }, (_, r) => {
        const rowY = startY + r * spacingY;
        const rowLabel = rowLabelType === "letters"
          ? String.fromCharCode(65 + rowStart + r)
          : String(rowStart + r + 1);
        const seats = Array.from({ length: seatsPerRow }, (_, i) => {
          const num = seatOrder === "rtl" ? (seatStart + seatsPerRow - 1 - i) : (seatStart + i);
          return { seatNumber: String(num), x: startX + i * spacingX, y: rowY };
        });
        return { label: rowLabel, startX, startY: rowY, seats };
      });
      const createdRows = await fetch(`/api/sections/${sectionId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsPayload }),
      }).then(r => r.json()) as FR[];
      const newSeats: SeatDot[] = createdRows.flatMap(row =>
        row.seats.map(seat => ({ id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id }))
      );
      const newRows: RowInfo[] = createdRows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 }));
      const PAD = 16;
      const xs = newSeats.map(s => s.x), ys = newSeats.map(s => s.y);
      const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
      const x1 = Math.max(...xs) + PAD, y1 = Math.max(...ys) + PAD;
      const newPoints: Point[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      const sec = sectionsRef.current.find(s => s.id === sectionId);
      const notesObj: Record<string, unknown> = { seatRadius };
      if (sec?.edgeCurve) notesObj.edgeCurve = sec.edgeCurve;
      if (sec?.labelOffset) notesObj.labelOffset = sec.labelOffset;
      if (sec?.labelSize) notesObj.labelSize = sec.labelSize;
      if (sec?.capacity !== undefined) notesObj.capacity = sec.capacity;
      if (sec?.hideSeats) notesObj.hideSeats = sec.hideSeats;
      await fetch(`/api/sections/${sectionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygonPath: pointsToPath(newPoints), notes: JSON.stringify(notesObj) }),
      });
      upd(sectionId, { seats: newSeats, points: newPoints, rows: newRows });
      setShowRows(false);
    } finally { setSaving(false); }
  };

  // ── Create seated section from config + placement point ──────────────
  const createSeatedSection = async (origin: Point) => {
    if (!origin) return;
    const { count, seatsPerRow, spacingX, spacingY, rowLabelType, rowStart, seatOrder, seatStart } = rowCfg;
    pushHistory();
    setSaving(true);
    try {
      const secNum = sectionsRef.current.filter(s => s.sectionType === "RESERVED").length + 1;
      const secRes = await fetch(`/api/maps/${mapId}/sections`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Section ${secNum}`, label: `S${secNum}`,
          sectionType: "RESERVED",
          polygonPath: pointsToPath([origin, { x: origin.x + 1, y: origin.y }, { x: origin.x + 1, y: origin.y + 1 }, { x: origin.x, y: origin.y + 1 }]),
        }),
      });
      if (!secRes.ok) return;
      const created = await secRes.json();
      const sectionId: string = created.id;
      type FR2 = { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string }[] };
      const rowsPayload2 = Array.from({ length: count }, (_, r) => {
        const rowY = origin.y + r * spacingY;
        const rowLabel = rowLabelType === "letters"
          ? String.fromCharCode(65 + rowStart + r)
          : String(rowStart + r + 1);
        const seats = Array.from({ length: seatsPerRow }, (_, i) => {
          const num = seatOrder === "rtl" ? (seatStart + seatsPerRow - 1 - i) : (seatStart + i);
          return { seatNumber: String(num), x: origin.x + i * spacingX, y: rowY };
        });
        return { label: rowLabel, startX: origin.x, startY: rowY, seats };
      });
      const createdRows2 = await fetch(`/api/sections/${sectionId}/rows/batch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsPayload2 }),
      }).then(r => r.json()) as FR2[];
      const newSeats: SeatDot[] = createdRows2.flatMap(row =>
        row.seats.map((seat: FR2["seats"][0]) => ({ id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id }))
      );
      const newRows: RowInfo[] = createdRows2.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 }));
      const newPoints = reshapeToFitSeats(newSeats);
      await fetch(`/api/sections/${sectionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygonPath: pointsToPath(newPoints), notes: JSON.stringify({ seatRadius }) }),
      });
      setSections(prev => [...prev, {
        id: sectionId, name: `Section ${secNum}`, label: `S${secNum}`,
        sectionType: "RESERVED", points: newPoints, saved: true, edgeCurve: 0,
        seats: newSeats, rows: newRows,
      }]);
      setSelected(sectionId);
      setSeatedPlacement(null);
      setTool("select");
      focusSection(sectionId);
    } finally { setSaving(false); }
  };

  // ── Seat rename + shape ───────────────────────────────────────────────
  const saveSeatRename = async () => {
    if (!editingSeat) return;
    await fetch(`/api/seats/${editingSeat.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatNumber: editingSeat.value, shape: editingSeat.shape }),
    });
    setSections(prev => prev.map(s => ({
      ...s, seats: s.seats?.map(seat =>
        seat.id === editingSeat.id
          ? { ...seat, seatNumber: editingSeat.value, shape: editingSeat.shape }
          : seat
      ),
    })));
    setEditingSeat(null);
  };

  // ── Row rename ────────────────────────────────────────────────────────
  const saveRowRename = async () => {
    if (!editingRow) return;
    const sectionId = focusedSection;
    if (!sectionId) { setEditingRow(null); return; }
    await fetch(`/api/rows/${editingRow.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editingRow.value }),
    });
    setSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s,
      rows: s.rows?.map(r => r.id === editingRow.id ? { ...r, label: editingRow.value } : r),
      seats: s.seats?.map(seat => seat.rowId === editingRow.id ? { ...seat, rowLabel: editingRow.value } : seat),
    }));
    setEditingRow(null);
  };

  // ── Row curve/skew update — syncs s.points live via reshapeToFitSeats ──
  const updRowTransform = (rowId: string, patch: { curve?: number; skew?: number }) => {
    if (!focusedSection) return;
    setSections(prev => prev.map(s => {
      if (s.id !== focusedSection) return s;
      const newRows = s.rows?.map(r => r.id === rowId ? { ...r, ...patch } : r) ?? [];
      const disp = getDisplaySeats(s.seats ?? [], newRows);
      const pts  = disp.length > 0 ? reshapeToFitSeats(disp) : null;
      return { ...s, rows: newRows, ...(pts ? { points: pts } : {}) };
    }));
    // Persist to DB
    fetch(`/api/rows/${rowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const applyGlobalTransform = () => {
    if (!focusedSection) return;
    const sec = sectionsRef.current.find(s => s.id === focusedSection);
    if (!sec) return;
    const newRows = sec.rows?.map(r => ({ ...r, curve: globalCurve, skew: globalSkew })) ?? [];
    const disp = getDisplaySeats(sec.seats ?? [], newRows);
    const pts  = disp.length > 0 ? reshapeToFitSeats(disp) : null;
    setSections(prev => prev.map(s =>
      s.id !== focusedSection ? s : { ...s, rows: newRows, ...(pts ? { points: pts } : {}) }
    ));
    // Persist rows transform + updated polygon path in parallel
    if (sec.rows && sec.rows.length > 0) {
      fetch(`/api/sections/${focusedSection}/rows/transform`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curve: globalCurve, skew: globalSkew }),
      });
      if (pts) {
        fetch(`/api/sections/${focusedSection}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygonPath: pointsToPath(pts) }),
        });
      }
    }
  };

  // Bake all row curve/skew into actual seat positions and save to DB
  const bakeRowTransforms = async () => {
    if (!focusedSection) return;
    const section = sectionsRef.current.find(s => s.id === focusedSection);
    if (!section?.seats || !section.rows) return;
    setBaking(true);
    try {
      const displayed = getDisplaySeats(section.seats, section.rows);
      const bakedPoints = reshapeToFitSeats(displayed);
      upd(focusedSection, {
        seats: displayed,
        rows: section.rows.map(r => ({ ...r, curve: 0, skew: 0 })),
        points: bakedPoints,
      });
      const bakeUpdates = displayed.map(seat => ({ id: seat.id, x: seat.x, y: seat.y }));
      if (bakeUpdates.length > 0) {
        await fetch(`/api/sections/${focusedSection}/seats/positions`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: bakeUpdates }),
        });
      }
      await fetch(`/api/sections/${focusedSection}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygonPath: pointsToPath(bakedPoints) }),
      });
    } finally { setBaking(false); }
  };

  // ── Delete / fill-gaps helpers ────────────────────────────────────────
  const deleteSeat = async (seatId: string, sectionId: string) => {
    await fetch(`/api/seats/${seatId}`, { method: "DELETE" });
    setSections(prev => prev.map(s => s.id !== sectionId ? s : {
      ...s, seats: s.seats?.filter(seat => seat.id !== seatId),
    }));
    setSelectedSeats(prev => { const n = new Set(prev); n.delete(seatId); return n; });
    setEditingSeat(null);
  };

  const deleteSelectedSeats = async () => {
    if (!focusedSection || selectedSeats.size === 0) return;
    await fetch(`/api/sections/${focusedSection}/seats/batch`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds: [...selectedSeats] }),
    });
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : {
      ...s, seats: s.seats?.filter(seat => !selectedSeats.has(seat.id)),
    }));
    setSelectedSeats(new Set());
  };

  // Fill gaps: redistribute seats evenly within each row (same span, equal spacing)
  const fillGaps = async () => {
    if (!focusedSection) return;
    const section = sectionsRef.current.find(s => s.id === focusedSection);
    if (!section?.seats) return;
    const rowMap = new Map<string, SeatDot[]>();
    for (const seat of section.seats) {
      if (!rowMap.has(seat.rowId)) rowMap.set(seat.rowId, []);
      rowMap.get(seat.rowId)!.push(seat);
    }
    const updates: { id: string; x: number; y: number }[] = [];
    const updatedSeats = section.seats.map(seat => ({ ...seat }));
    for (const [, rowSeats] of rowMap) {
      const sorted = [...rowSeats].sort((a, b) => a.x - b.x);
      if (sorted.length < 2) continue;
      const x0 = sorted[0].x, x1 = sorted[sorted.length - 1].x;
      const avgY = sorted.reduce((s, seat) => s + seat.y, 0) / sorted.length;
      const step = (x1 - x0) / (sorted.length - 1);
      sorted.forEach((seat, i) => {
        const nx = x0 + i * step, ny = avgY;
        updates.push({ id: seat.id, x: nx, y: ny });
        const idx = updatedSeats.findIndex(s => s.id === seat.id);
        if (idx >= 0) { updatedSeats[idx].x = nx; updatedSeats[idx].y = ny; }
      });
    }
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : { ...s, seats: updatedSeats }));
    if (updates.length > 0) {
      await fetch(`/api/sections/${focusedSection}/seats/positions`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    }
  };

  const hasAnyTransform = focSec?.rows?.some(r => r.curve !== 0 || r.skew !== 0) ?? false;

  // ── Persist section field changes to DB ──────────────────────────────
  const saveSectionPatch = (sectionId: string, data: Record<string, unknown>) => {
    fetch(`/api/sections/${sectionId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };

  const saveZoneChange = async (sectionId: string, zoneId: string | undefined) => {
    await fetch(`/api/sections/${sectionId}/zone`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zoneId }),
    });
  };

  const deleteSection = async (sectionId: string, saved: boolean) => {
    pushHistory();
    if (saved) await fetch(`/api/sections/${sectionId}`, { method: "DELETE" });
    setSections(p => p.filter(s => s.id !== sectionId));
    setSelected(null);
    if (focusedSection === sectionId) setFocused(null);
  };

  const deleteMultiSelected = async () => {
    pushHistory();
    const ids = [...multiSelected];
    const savedIds = ids.filter(id => sectionsRef.current.find(sec => sec.id === id)?.saved);
    if (savedIds.length > 0) {
      await fetch("/api/sections/batch", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionIds: savedIds }),
      });
    }
    setSections(p => p.filter(s => !multiSelected.has(s.id)));
    setMultiSelected(new Set());
    setSelected(null);
  };

  // ── Split / Merge sections ────────────────────────────────────────────
  const splitSection = async () => {
    if (!focusedSection || selectedSeats.size === 0) return;
    pushHistory();
    setSaving(true);
    try {
      const res = await fetch(`/api/sections/${focusedSection}/split`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: [...selectedSeats] }),
      });
      if (!res.ok) return;
      const map = await fetch(`/api/maps/${mapId}`).then(r => r.json()) as {
        sections: { id: string; name: string; label: string; sectionType: DraftSection["sectionType"]; polygonPath: string; notes?: string | null; zoneMappings: { zoneId: string }[]; rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string; notes?: string | null }[] }[] }[];
        pricingZones: Zone[]; mapHolds?: MapHold[];
      };
      setSections(map.sections.map(s => {
        let tableMeta: TableMeta | undefined; let iconOffset: { x: number; y: number } | undefined;
        let labelOffset: { x: number; y: number } | undefined; let iconSize: number | undefined;
        let labelSize: number | undefined; let edgeCurve = 0;
        let capacity: number | undefined; let maxPerOrder: number | undefined;
        let hideSeats: boolean | undefined; let customSvg: string | undefined;
        let customColor: string | undefined; let noOrphanSeats: boolean | undefined;
        if (!isVenueObject(s.sectionType) && s.sectionType !== "TABLE" && s.notes) {
          try {
            const p = JSON.parse(s.notes) as Record<string, unknown>;
            if (p.labelOffset) labelOffset = p.labelOffset as { x: number; y: number };
            if (p.labelSize) labelSize = p.labelSize as number;
            if (p.edgeCurve) edgeCurve = p.edgeCurve as number;
            if (p.capacity !== undefined) capacity = p.capacity as number;
            if (p.maxPerOrder !== undefined) maxPerOrder = p.maxPerOrder as number;
            if (p.hideSeats !== undefined) hideSeats = p.hideSeats as boolean;
            if (p.customSvg) customSvg = p.customSvg as string;
            if (p.customColor) customColor = p.customColor as string;
            if (p.iconSize) iconSize = p.iconSize as number;
            if (p.iconOffset) iconOffset = p.iconOffset as { x: number; y: number };
            if (p.noOrphanSeats) noOrphanSeats = p.noOrphanSeats as boolean;
          } catch {}
        }
        return {
          id: s.id, name: s.name, label: s.label, sectionType: s.sectionType,
          zoneId: s.zoneMappings[0]?.zoneId, saved: true, edgeCurve,
          capacity, maxPerOrder, hideSeats, customSvg, customColor, noOrphanSeats,
          tableMeta, iconOffset, labelOffset, iconSize, labelSize,
          rows: s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 })),
          seats: s.rows.flatMap(row => row.seats.map(seat => ({
            id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
            rowLabel: row.label, rowId: row.id,
          }))),
          points: pathToPoints(s.polygonPath),
        };
      }));
      setSelectedSeats(new Set());
      setFocused(null);
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  const mergeSections = async () => {
    if (multiSelected.size < 2) return;
    pushHistory();
    setSaving(true);
    try {
      const sectionIds = [...multiSelected];
      const res = await fetch(`/api/maps/${mapId}/merge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionIds }),
      });
      if (!res.ok) return;
      const merged = await res.json() as { id: string; name: string; label: string; sectionType: DraftSection["sectionType"]; polygonPath: string; notes?: string | null; zoneMappings: { zoneId: string }[]; rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string }[] }[] };
      setSections(prev => {
        const remaining = prev.filter(s => !multiSelected.has(s.id) || s.id === sectionIds[0]);
        return remaining.map(s => {
          if (s.id !== sectionIds[0]) return s;
          return {
            ...s, id: merged.id, name: merged.name, label: merged.label,
            saved: true,
            rows: merged.rows.map(r => ({ id: r.id, label: r.label, curve: r.curve ?? 0, skew: r.skew ?? 0 })),
            seats: merged.rows.flatMap(r => r.seats.map(seat => ({
              id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
              rowLabel: r.label, rowId: r.id,
            }))),
          };
        });
      });
      setMultiSelected(new Set([sectionIds[0]]));
      setSelected(sectionIds[0]);
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save pasted sections to DB ──────────────────────────────────
  const savePastedSections = async (newSecs: DraftSection[]) => {
    const idMap = new Map<string, string>(); // tempId -> realId
    for (const s of newSecs) {
      try {
        if (s.sectionType === "TABLE" && s.tableMeta) {
          const meta = s.tableMeta;
          const res = await fetch(`/api/maps/${mapId}/sections`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: s.name, label: s.label, sectionType: "TABLE", polygonPath: pointsToPath(s.points), notes: JSON.stringify(meta) }),
          });
          const savedSec = await res.json();
          const realId: string = savedSec.id;
          idMap.set(s.id, realId);
          const bbox = polyBBox(s.points);
          const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
          const chairPts = (s.seats && s.seats.length > 0) ? s.seats : computeChairPositions(meta, cx, cy);
          const rowRes = await fetch(`/api/sections/${realId}/rows`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: "chairs", startX: cx, startY: cy,
              seats: chairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
            }),
          });
          const savedRow = await rowRes.json();
          upd(s.id, {
            id: realId, saved: true,
            rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
            seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
              id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: "chairs", rowId: savedRow.id,
            })),
          });
        } else {
          // Build notes body same way as saveSection
          const body: Record<string, unknown> = {
            name: s.name, label: s.label, sectionType: s.sectionType,
            polygonPath: pointsToPath(s.points),
          };
          if (s.sectionType === "DOOR" && s.doorMeta) {
            const n: Record<string, unknown> = { w: s.doorMeta.w, h: s.doorMeta.h, angle: s.doorMeta.angle };
            if (s.showLabel === false) n.showLabel = false;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            body.notes = JSON.stringify(n);
          } else if (s.sectionType === "STAIRS" && s.stairsMeta) {
            const n: Record<string, unknown> = { w: s.stairsMeta.w, h: s.stairsMeta.h, angle: s.stairsMeta.angle };
            if (s.showLabel === false) n.showLabel = false;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            body.notes = JSON.stringify(n);
          } else if (s.sectionType === "TEXT") {
            const n: Record<string, unknown> = {};
            if (s.textColor) n.textColor = s.textColor;
            if (s.textBold) n.textBold = s.textBold;
            if (s.textAngle) n.textAngle = s.textAngle;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          } else if (s.sectionType !== "WALL" && isVenueObject(s.sectionType)) {
            const n: Record<string, unknown> = {};
            if (s.iconOffset) n.iconOffset = s.iconOffset;
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.iconSize) n.iconSize = s.iconSize;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.showIcon === false) n.showIcon = false;
            if (s.showLabel === false) n.showLabel = false;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          } else {
            const n: Record<string, unknown> = {};
            if (s.labelOffset) n.labelOffset = s.labelOffset;
            if (s.labelSize) n.labelSize = s.labelSize;
            if (s.edgeCurve) n.edgeCurve = s.edgeCurve;
            if (s.capacity !== undefined) n.capacity = s.capacity;
            if (s.maxPerOrder !== undefined) n.maxPerOrder = s.maxPerOrder;
            if (s.hideSeats) n.hideSeats = s.hideSeats;
            if (Object.keys(n).length > 0) body.notes = JSON.stringify(n);
          }
          const res = await fetch(`/api/maps/${mapId}/sections`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const saved = await res.json();
          const realId: string = saved.id;
          idMap.set(s.id, realId);
          upd(s.id, { saved: true, id: realId });
          if (s.zoneId) {
            await fetch(`/api/sections/${realId}/zone`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ zoneId: s.zoneId }),
            });
          }
          // Save rows/seats if any
          if (s.rows && s.seats && s.rows.length > 0) {
            const rowMap = new Map<string, SeatDot[]>();
            for (const seat of s.seats) {
              if (!rowMap.has(seat.rowId)) rowMap.set(seat.rowId, []);
              rowMap.get(seat.rowId)!.push(seat);
            }
            const pasteRowsPayload = s.rows.map(row => {
              const rSeats = rowMap.get(row.id) ?? [];
              return {
                label: row.label,
                startX: rSeats[0]?.x ?? 0, startY: rSeats[0]?.y ?? 0,
                seats: rSeats.map(seat => ({ seatNumber: seat.seatNumber, x: seat.x, y: seat.y })),
              };
            });
            type PasteRow = { id: string; label: string; seats: { id: string; x: number; y: number; seatNumber: string }[] };
            const pasteCreated = await fetch(`/api/sections/${realId}/rows/batch`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rows: pasteRowsPayload }),
            }).then(r => r.json()) as PasteRow[];
            const finalRows: RowInfo[] = [];
            const finalSeats: SeatDot[] = [];
            pasteCreated.forEach((savedRow, ri) => {
              const origRow = s.rows![ri];
              const rSeats = rowMap.get(origRow.id) ?? [];
              finalRows.push({ id: savedRow.id, label: savedRow.label, curve: origRow.curve, skew: origRow.skew });
              savedRow.seats.forEach((seat, i) => {
                finalSeats.push({
                  id: seat.id, x: seat.x, y: seat.y,
                  seatNumber: seat.seatNumber, rowLabel: savedRow.label, rowId: savedRow.id,
                  shape: rSeats[i]?.shape,
                });
              });
            });
            setSections(prev => prev.map(sec => sec.id === realId ? { ...sec, rows: finalRows, seats: finalSeats } : sec));
          }
        }
      } catch (e) {
        console.error("Failed to save pasted section", e);
      }
    }
    // Update multiSelected and selected to use real IDs
    if (idMap.size > 0) {
      setMultiSelected(prev => {
        const next = new Set<string>();
        for (const id of prev) next.add(idMap.get(id) ?? id);
        return next;
      });
      setSelected(prev => prev ? (idMap.get(prev) ?? prev) : prev);
    }
  };

  // ── Save new table to DB ─────────────────────────────────────────────
  const saveTable = async (s: DraftSection) => {
    if (!s.tableMeta) return;
    setSaving(true);
    try {
      const meta = s.tableMeta;
      const bbox = polyBBox(s.points);
      const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
      const res = await fetch(`/api/maps/${mapId}/sections`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name, label: s.label, sectionType: "TABLE",
          polygonPath: pointsToPath(s.points), notes: JSON.stringify(meta),
        }),
      });
      const saved = await res.json();
      const chairPts = computeChairPositions(meta, cx, cy);
      const rowRes = await fetch(`/api/sections/${saved.id}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "chairs", startX: cx, startY: cy,
          seats: chairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
        }),
      });
      const savedRow = await rowRes.json();
      if (s.zoneId) await fetch(`/api/sections/${saved.id}/zone`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: s.zoneId }),
      });
      upd(s.id, {
        id: saved.id, saved: true,
        rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
        seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
          id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
          rowLabel: "chairs", rowId: savedRow.id,
        })),
      });
    } finally { setSaving(false); }
  };

  // ── Update table meta (shape/size/chairs) ────────────────────────────
  const updateTableMeta = async (sectionId: string, patch: Partial<TableMeta>) => {
    const s = sectionsRef.current.find(sec => sec.id === sectionId);
    if (!s?.tableMeta) return;
    const newMeta = { ...s.tableMeta, ...patch };
    const bbox = polyBBox(s.points);
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    const newPts = tableBoundingPoints(newMeta, cx, cy);
    const newChairPts = computeChairPositions(newMeta, cx, cy);
    upd(sectionId, { tableMeta: newMeta, points: newPts });
    if (!s.saved) return;
    await fetch(`/api/sections/${sectionId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygonPath: pointsToPath(newPts), notes: JSON.stringify(newMeta) }),
    });
    const oldCount = s.seats?.length ?? 0;
    if (oldCount !== newChairPts.length && s.rows?.[0]) {
      const rowId = s.rows[0].id;
      await fetch(`/api/rows/${rowId}`, { method: "DELETE" });
      const rowRes = await fetch(`/api/sections/${sectionId}/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "chairs", startX: cx, startY: cy,
          seats: newChairPts.map((pt, i) => ({ seatNumber: String(i + 1), x: pt.x, y: pt.y })),
        }),
      });
      const savedRow = await rowRes.json();
      upd(sectionId, {
        rows: [{ id: savedRow.id, label: "chairs", curve: 0, skew: 0 }],
        seats: savedRow.seats.map((seat: { id: string; x: number; y: number; seatNumber: string }) => ({
          id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber,
          rowLabel: "chairs", rowId: savedRow.id,
        })),
      });
    } else {
      const seats = s.seats ?? [];
      upd(sectionId, {
        seats: seats.map((seat, i) => i < newChairPts.length ? { ...seat, x: newChairPts[i].x, y: newChairPts[i].y } : seat),
      });
      const chairUpdates = Array.from(
        { length: Math.min(seats.length, newChairPts.length) },
        (_, i) => ({ id: seats[i].id, x: newChairPts[i].x, y: newChairPts[i].y })
      );
      if (chairUpdates.length > 0) {
        await fetch(`/api/sections/${sectionId}/seats/positions`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: chairUpdates }),
        });
      }
    }
  };

  // ── Add zone ──────────────────────────────────────────────────────────
  const addZone = async () => {
    if (!newZone.name) return;
    const zone = await fetch(`/api/maps/${mapId}/zones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newZone),
    }).then(r => r.json());
    setZones(p => [...p, zone]);
    setNewZone({ name: "", color: "#7F77DD" });
  };

  const deleteZone = async (zoneId: string) => {
    await fetch(`/api/zones/${zoneId}`, { method: "DELETE" });
    setZones(p => p.filter(z => z.id !== zoneId));
    // Clear section-level zone references
    setSections(p => p.map(s => s.zoneId === zoneId ? { ...s, zoneId: undefined } : s));
  };

  // ── Per-seat zone assignment (focused seated sections) ─────────────────
  const applyZoneToSelectedSeats = async (zoneId: string | null) => {
    if (!focusedSection || selectedSeats.size === 0) return;
    const ids = Array.from(selectedSeats);
    await fetch(`/api/maps/${mapId}/seats/batch-zone`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds: ids, zoneId }),
    });
    setSections(prev => prev.map(s => s.id !== focusedSection ? s : {
      ...s, seats: s.seats?.map(seat =>
        selectedSeats.has(seat.id) ? { ...seat, zoneId: zoneId ?? undefined } : seat
      ),
    }));
  };

  // ── Map holds ─────────────────────────────────────────────────────────
  const addHold = async () => {
    if (!newHold.name) return;
    const hold = await fetch(`/api/maps/${mapId}/holds`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newHold),
    }).then(r => r.json());
    setHolds(p => [...p, hold]);
    setNewHold({ name: "", color: "#cc4444" });
  };
  const deleteHold = async (holdId: string) => {
    await fetch(`/api/holds/${holdId}`, { method: "DELETE" });
    setHolds(p => p.filter(h => h.id !== holdId));
    if (activeHoldId === holdId) setActiveHoldId(null);
  };
  const assignSeatsToHold = async (holdId: string, seatIds: string[]) => {
    const hold = await fetch(`/api/holds/${holdId}/seats`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatIds }),
    }).then(r => r.json());
    if (hold.ok) {
      setHolds(p => p.map(h => h.id === holdId ? { ...h, seats: seatIds.map(id => ({ seatId: id })) } : h));
    }
  };

  // ── File import handlers ──────────────────────────────────────────────
  interface ImportPreviewSection {
    name: string; label: string;
    sectionType: DraftSection["sectionType"];
    polygonPath: string;
    rows: { label: string; startX: number; startY: number; angle: number; seats: { seatNumber: string; x: number; y: number }[] }[];
    sourceLayerName: string;
    confidence: number;
    estimatedSeats: number;
    bbox?: { top: number; left: number; bottom: number; right: number };
    include: boolean;
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, endpoint: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const fileLabel = endpoint === "analyze-psd" ? "PSD" : endpoint === "analyze-dxf" ? "DXF/DWG" : "Image";
    const previewUrl = endpoint === "analyze-image" ? URL.createObjectURL(file) : undefined;
    setImportElapsed(0);
    setImportModal({ stage: "uploading", sections: [], warnings: [], error: null, fileLabel, previewUrl });
    importTimerRef.current = setInterval(() => setImportElapsed(s => s + 1), 1000);
    const stopTimer = () => { if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; } };
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/maps/${mapId}/${endpoint}`, { method: "POST", body: formData });
      stopTimer();
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Analysis failed" }));
        setImportModal(m => m ? { ...m, stage: "preview", error: body.error ?? "Analysis failed" } : null);
        return;
      }
      const data = await res.json() as { sections: Omit<ImportPreviewSection, "include">[]; warnings: string[] };
      setImportModal({
        stage: "preview",
        sections: data.sections.map(s => ({ ...s, include: true })),
        warnings: data.warnings,
        error: null,
        fileLabel,
        previewUrl,
      });
    } catch {
      stopTimer();
      setImportModal(m => m ? { ...m, stage: "preview", error: "Network error" } : null);
    }
  };

  const handleImportConfirm = async () => {
    if (!importModal) return;
    const toImport = importModal.sections.filter(s => s.include);
    if (toImport.length === 0) { setImportModal(null); return; }
    setImportModal(m => m ? { ...m, stage: "saving" } : null);
    try {
      const res = await fetch(`/api/maps/${mapId}/import-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: toImport }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setImportModal(m => m ? { ...m, stage: "preview", error: body.error ?? "Save failed" } : null);
        return;
      }
      // Reload map from server — reuse the same deserialization as the initial load useEffect
      const mapRes = await fetch(`/api/maps/${mapId}`);
      if (mapRes.ok) {
        const fresh = await mapRes.json() as {
          sections: { id: string; name: string; label: string; sectionType: DraftSection["sectionType"]; polygonPath: string; notes?: string | null; zoneMappings: { zoneId: string }[]; rows: { id: string; label: string; curve?: number; skew?: number; seats: { id: string; x: number; y: number; seatNumber: string; notes?: string | null }[] }[] }[];
          pricingZones: Zone[];
          mapHolds?: MapHold[];
        };
        setSections(fresh.sections.map(s => {
          let tableMeta: TableMeta | undefined;
          let doorMeta: DoorMeta | undefined;
          let stairsMeta: DoorMeta | undefined;
          if (s.sectionType === "TABLE" && s.notes) {
            try { tableMeta = JSON.parse(s.notes) as TableMeta; } catch {}
          }
          if (s.sectionType === "DOOR" && s.notes) {
            try { doorMeta = JSON.parse(s.notes) as DoorMeta; } catch {}
          }
          if (s.sectionType === "STAIRS" && s.notes) {
            try { stairsMeta = JSON.parse(s.notes) as DoorMeta; } catch {}
          }
          const SHAPES2 = ["circle","square","triangle","chair","wheelchair"];
          const rawSeats = s.rows.flatMap(row => row.seats.map(seat => {
            let shape: SeatShapeType | undefined;
            let seatZoneId: string | undefined;
            if (seat.notes) {
              if (SHAPES2.includes(seat.notes)) { shape = seat.notes as SeatShapeType; }
              else { try { const p = JSON.parse(seat.notes); if (SHAPES2.includes(p.s ?? "")) shape = p.s; if (p.z) seatZoneId = p.z; } catch {} }
            }
            return { id: seat.id, x: seat.x, y: seat.y, seatNumber: seat.seatNumber, rowLabel: row.label, rowId: row.id, shape, zoneId: seatZoneId };
          }));
          return {
            id: s.id, name: s.name, label: s.label,
            sectionType: s.sectionType,
            zoneId: s.zoneMappings[0]?.zoneId,
            saved: true,
            edgeCurve: 0,
            tableMeta,
            doorMeta,
            stairsMeta,
            rows: s.rows.map(row => ({ id: row.id, label: row.label, curve: row.curve ?? 0, skew: row.skew ?? 0 })),
            seats: rawSeats,
            points: (() => {
              if (s.sectionType === "TABLE") return pathToPoints(s.polygonPath);
              if (rawSeats.length > 0) { const fitted = reshapeToFitSeats(rawSeats); if (fitted.length > 0) return fitted; }
              return pathToPoints(s.polygonPath);
            })(),
          };
        }));
      }
      if (importModal?.previewUrl) URL.revokeObjectURL(importModal.previewUrl);
      setImportModal(null);
    } catch {
      setImportModal(m => m ? { ...m, stage: "preview", error: "Network error" } : null);
    }
  };

  const saveSchedule = async (patch: {
    scheduledStartAt?: string | null;
    scheduledEndAt?:   string | null;
    isPublished?: boolean;
  }) => {
    const r = await fetch(`/api/maps/${mapId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const updated = await r.json();
      setMapMeta(prev => ({
        ...prev,
        scheduledStartAt: updated.scheduledStartAt ?? null,
        scheduledEndAt:   updated.scheduledEndAt   ?? null,
        isPublished:      updated.isPublished,
      }));
    }
  };

  const canvasCursor = (seatDragState.current || sectionDragState.current) ? "grabbing" : (tool === "polygon" || tool === "table" || tool === "object" || tool === "text") ? "crosshair" : "grab";

  return {
    // State
    transform, setTransform,
    tool, setTool,
    sections, setSections,
    selected, setSelected,
    multiSelected, setMultiSelected,
    focusedSection, setFocused,
    drawing, setDrawing,
    mouse, setMouse,
    zones, setZones,
    holds, setHolds,
    newHold, setNewHold,
    activeHoldId, setActiveHoldId,
    holdEditDraft, setHoldEditDraft,
    loading,
    sidebarTab, setSidebarTab,
    showRows, setShowRows,
    saving, setSaving,
    bakingTransforms, setBaking,
    newZone, setNewZone,
    seatRadius, setSeatRadius,
    seatShape, setSeatShape,
    selectedSeats, setSelectedSeats,
    marqueeRect, setMarqueeRect,
    editingSeat, setEditingSeat,
    editingRow, setEditingRow,
    tableCfg, setTableCfg,
    tableDraft, setTableDraft,
    editingTable, setEditingTable,
    objectDraftName, setObjectDraftName,
    objectDraftSvg,  setObjectDraftSvg,
    textEditId, setTextEditId,
    importModal, setImportModal,
    importElapsed, setImportElapsed,
    seatedPlacement, setSeatedPlacement,
    globalCurve, setGlobalCurve,
    globalSkew, setGlobalSkew,
    rowCfg, setRowCfg,
    hoveredSeat, setHoveredSeat,
    // Refs
    containerRef,
    transformRef,
    sectionsRef,
    drawingRef,
    toolRef,
    focusedRef,
    selectedSeatsRef,
    seatRadiusRef,
    selectedRef,
    multiSelectedRef,
    sidebarTabRef,
    activeHoldIdRef,
    panState,
    sectionDragState,
    vertexDragState,
    seatDragState,
    marqueeStateRef,
    rowLabelDownRef,
    rotationDragState,
    groupRotationDragState,
    tableDraftRef,
    iconOffsetPatchTimer,
    hasDragged,
    clipboardRef,
    importTimerRef,
    fileInputRef,
    dxfFileInputRef,
    imageFileInputRef,
    // Derived
    sel,
    focSec,
    vw,
    vh,
    bgImageUrl,
    svgViewBox,
    // Functions
    upd,
    focusSection,
    exitFocus,
    zoom,
    resetZoom,
    fitToContent,
    clientToSvg,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    handleMouseLeave,
    finishPolygon,
    saveSection,
    generateRows,
    createSeatedSection,
    saveSeatRename,
    saveRowRename,
    updRowTransform,
    applyGlobalTransform,
    bakeRowTransforms,
    deleteSeat,
    deleteSelectedSeats,
    fillGaps,
    hasAnyTransform,
    saveSectionPatch,
    saveZoneChange,
    deleteSection,
    deleteMultiSelected,
    splitSection,
    mergeSections,
    savePastedSections,
    saveTable,
    updateTableMeta,
    addZone,
    deleteZone,
    applyZoneToSelectedSeats,
    addHold,
    deleteHold,
    assignSeatsToHold,
    handleFileImport,
    handleImportConfirm,
    canvasCursor,
    mapMeta, setMapMeta,
    saveSchedule,
  };
}
