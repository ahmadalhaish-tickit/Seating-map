import express from "express";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import cors from "cors";
import multer from "multer";
import { PrismaClient, SeatStatus } from "@prisma/client";
import { z } from "zod";

const app = express();
const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: process.env.CLIENT_URL || "http://localhost:5173" },
});
const prisma = new PrismaClient();
const HOLD_DURATION_MS = 8 * 60 * 1000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));

// ── Helpers ────────────────────────────────────────────────────────────────

function err(res: express.Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

// Wraps async route handlers so any thrown error goes to Express error handler
type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>;
function ah(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ── Hold expiry (runs every 30s) ──────────────────────────────────────────
async function expireHolds() {
  try {
    const cutoff = new Date(Date.now() - HOLD_DURATION_MS);
    const expired = await prisma.seatInventory.updateMany({
      where: { status: "HELD", heldAt: { lt: cutoff } },
      data: { status: "AVAILABLE", heldBy: null, heldAt: null },
    });
    if (expired.count > 0) io.emit("holds:expired", { count: expired.count });
  } catch (e) {
    console.error("[expireHolds]", e);
  }
}
setInterval(expireHolds, 30_000);

// ── Schemas ───────────────────────────────────────────────────────────────
const CreateVenueSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  address: z.string().optional(),
});
const CreateMapSchema = z.object({
  venueId: z.string(),
  name: z.string().min(1),
  svgViewBox: z.string().optional(),
  bgImageUrl: z.string().url().optional(),
});
const UpsertSectionSchema = z.object({
  name: z.string(),
  label: z.string(),
  sectionType: z.enum(["RESERVED", "GA", "ACCESSIBLE", "RESTRICTED", "TABLE", "STAGE", "BAR", "BATHROOM", "DANCING", "PARKING", "STAIRS", "WALL", "DOOR", "CHECKIN", "TEXT"]),
  polygonPath: z.string(),
  notes: z.string().optional(),
  sortOrder: z.number().int().optional(),
});
const CreateZoneSchema = z.object({
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().optional(),
});

// ── Venues ────────────────────────────────────────────────────────────────
app.get("/api/venues", ah(async (_req, res) => {
  res.json(await prisma.venue.findMany({ orderBy: { name: "asc" } }));
}));
app.post("/api/venues", ah(async (req, res) => {
  const p = CreateVenueSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  try { res.status(201).json(await prisma.venue.create({ data: p.data })); }
  catch { err(res, 409, "Slug already exists"); }
}));

// ── Maps ──────────────────────────────────────────────────────────────────
app.get("/api/maps", ah(async (_req, res) => {
  const maps = await prisma.venueMap.findMany({
    include: {
      venue: { select: { name: true } },
      events: { select: { id: true, name: true, date: true }, orderBy: { date: "asc" } },
      pricingZones: { select: { id: true, name: true, color: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(maps);
}));
app.get("/api/maps/:mapId", ah(async (req, res) => {
  const map = await prisma.venueMap.findUnique({
    where: { id: req.params.mapId },
    include: {
      sections: { include: { rows: { include: { seats: true } }, zoneMappings: true }, orderBy: { sortOrder: "asc" } },
      pricingZones: { orderBy: { sortOrder: "asc" } },
      mapHolds: { include: { seats: { select: { seatId: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!map) return err(res, 404, "Map not found");
  res.json(map);
}));
app.post("/api/venues/:venueId/maps", ah(async (req, res) => {
  const p = CreateMapSchema.safeParse({ ...req.body, venueId: req.params.venueId });
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.venueMap.create({ data: p.data }));
}));
app.patch("/api/maps/:mapId/publish", ah(async (req, res) => {
  res.json(await prisma.venueMap.update({
    where: { id: req.params.mapId },
    data: { isPublished: req.body.isPublished ?? true },
  }));
}));

// ── Sections ──────────────────────────────────────────────────────────────
app.post("/api/maps/:mapId/sections", ah(async (req, res) => {
  const p = UpsertSectionSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.section.create({ data: { ...p.data, mapId: req.params.mapId } }));
}));
app.patch("/api/sections/:sectionId", ah(async (req, res) => {
  const p = UpsertSectionSchema.partial().safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.json(await prisma.section.update({ where: { id: req.params.sectionId }, data: p.data }));
}));
app.delete("/api/sections/:sectionId", ah(async (req, res) => {
  const sectionId = req.params.sectionId;
  const rows = await prisma.row.findMany({ where: { sectionId }, select: { id: true } });
  const rowIds = rows.map(r => r.id);
  await prisma.$transaction([
    prisma.seatInventory.deleteMany({ where: { seat: { rowId: { in: rowIds } } } }),
    prisma.seat.deleteMany({ where: { rowId: { in: rowIds } } }),
    prisma.row.deleteMany({ where: { sectionId } }),
    prisma.sectionZoneMapping.deleteMany({ where: { sectionId } }),
    prisma.section.delete({ where: { id: sectionId } }),
  ]);
  res.status(204).send();
}));

// Rotate section: update polygon path + all seat positions in one transaction
app.patch("/api/sections/:sectionId/rotate", ah(async (req, res) => {
  const { polygonPath, seats, notes } = req.body as {
    polygonPath: string;
    seats: { id: string; x: number; y: number }[];
    notes?: string;
  };
  await prisma.$transaction(async tx => {
    await tx.section.update({ where: { id: req.params.sectionId }, data: { polygonPath, ...(notes !== undefined ? { notes } : {}) } });
    for (const seat of seats) {
      await tx.seat.update({ where: { id: seat.id }, data: { x: seat.x, y: seat.y } });
    }
  });
  res.json({ ok: true });
}));

// Bulk-move section polygon + all its seats by a delta
app.patch("/api/sections/:sectionId/move", ah(async (req, res) => {
  const { dx, dy } = req.body as { dx: number; dy: number };
  const rows = await prisma.row.findMany({
    where: { sectionId: req.params.sectionId },
    select: { id: true },
  });
  const rowIds = rows.map(r => r.id);
  await prisma.seat.updateMany({
    where: { rowId: { in: rowIds } },
    data: { x: { increment: dx }, y: { increment: dy } },
  });
  res.json({ ok: true });
}));

// Split: move a subset of seats into a brand-new section in the same map
app.post("/api/sections/:sectionId/split", ah(async (req, res) => {
  const { seatIds } = req.body as { seatIds: string[] };
  if (!seatIds || seatIds.length === 0) return err(res, 400, "seatIds required");
  const source = await prisma.section.findUnique({
    where: { id: req.params.sectionId },
    include: { rows: { include: { seats: true } }, zoneMappings: true },
  });
  if (!source) return err(res, 404, "Section not found");

  const seatSet = new Set(seatIds);
  const allSeats = source.rows.flatMap(r => r.seats);
  const toMove = allSeats.filter(s => seatSet.has(s.id));
  if (toMove.length === 0) return err(res, 400, "No matching seats");

  // Compute new polygon from moved-seats bounding box
  const xs = toMove.map(s => s.x), ys = toMove.map(s => s.y);
  const pad = 20;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const newPolygon = `M ${minX} ${minY} L ${maxX} ${minY} L ${maxX} ${maxY} L ${minX} ${maxY} Z`;

  const existingCount = await prisma.section.count({ where: { mapId: source.mapId } });
  const newSec = await prisma.section.create({
    data: {
      mapId: source.mapId,
      name: `${source.name} B`,
      label: source.label.slice(0, 5) + "B",
      sectionType: source.sectionType,
      polygonPath: newPolygon,
      sortOrder: existingCount,
      ...(source.zoneMappings[0] ? { zoneMappings: { create: { zoneId: source.zoneMappings[0].zoneId } } } : {}),
    },
  });

  // Group toMove seats by their original row label, create matching rows in new section
  const rowByLabel = new Map<string, typeof toMove>();
  for (const seat of toMove) {
    const row = source.rows.find(r => r.id === seat.rowId);
    const label = row?.label ?? "A";
    if (!rowByLabel.has(label)) rowByLabel.set(label, []);
    rowByLabel.get(label)!.push(seat);
  }
  for (const [label, seats] of rowByLabel) {
    const newRow = await prisma.row.create({
      data: { sectionId: newSec.id, label, startX: seats[0].x, startY: seats[0].y },
    });
    // Re-assign each seat to the new row
    for (const seat of seats) {
      await prisma.seat.update({ where: { id: seat.id }, data: { rowId: newRow.id } });
    }
  }

  // Clean up empty rows in source section
  const emptyRows = await prisma.row.findMany({
    where: { sectionId: req.params.sectionId },
    include: { _count: { select: { seats: true } } },
  });
  for (const row of emptyRows) {
    if (row._count.seats === 0) await prisma.row.delete({ where: { id: row.id } });
  }

  res.status(201).json({ ok: true, newSectionId: newSec.id });
}));

// Merge: combine rows/seats of multiple sections into the first one, delete the rest
app.post("/api/maps/:mapId/merge", ah(async (req, res) => {
  const { sectionIds } = req.body as { sectionIds: string[] };
  if (!sectionIds || sectionIds.length < 2) return err(res, 400, "Need at least 2 sectionIds");

  const [primaryId, ...otherIds] = sectionIds;
  const primary = await prisma.section.findUnique({
    where: { id: primaryId },
    include: { rows: { include: { seats: true } } },
  });
  if (!primary) return err(res, 404, "Primary section not found");

  // Re-assign all rows from secondary sections to primary
  for (const otherId of otherIds) {
    const other = await prisma.section.findUnique({
      where: { id: otherId },
      include: { rows: { include: { seats: true } } },
    });
    if (!other) continue;
    for (const row of other.rows) {
      await prisma.row.update({ where: { id: row.id }, data: { sectionId: primaryId } });
    }
    // Delete the now-empty section (zone mappings etc.)
    const remainingRows = await prisma.row.findMany({ where: { sectionId: otherId }, select: { id: true } });
    if (remainingRows.length === 0) {
      await prisma.$transaction([
        prisma.sectionZoneMapping.deleteMany({ where: { sectionId: otherId } }),
        prisma.section.delete({ where: { id: otherId } }),
      ]);
    }
  }

  // Recompute polygon to wrap all remaining seats
  const updatedRows = await prisma.row.findMany({
    where: { sectionId: primaryId },
    include: { seats: true },
  });
  const allSeats = updatedRows.flatMap(r => r.seats);
  if (allSeats.length > 0) {
    const xs = allSeats.map(s => s.x), ys = allSeats.map(s => s.y);
    const pad = 20;
    const poly = `M ${Math.min(...xs)-pad} ${Math.min(...ys)-pad} L ${Math.max(...xs)+pad} ${Math.min(...ys)-pad} L ${Math.max(...xs)+pad} ${Math.max(...ys)+pad} L ${Math.min(...xs)-pad} ${Math.max(...ys)+pad} Z`;
    await prisma.section.update({ where: { id: primaryId }, data: { polygonPath: poly } });
  }

  const merged = await prisma.section.findUnique({
    where: { id: primaryId },
    include: { rows: { include: { seats: true } }, zoneMappings: true },
  });
  res.json(merged);
}));

// ── PSD Analyzer ──────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const ANALYZER_URL = process.env.ANALYZER_URL || "http://127.0.0.1:8001";

// Proxy a PSD file to the Python analyzer and return the analysis JSON.
// Nothing is written to the DB here — the client shows a preview first.
app.post("/api/maps/:mapId/analyze-psd", upload.single("file"), ah(async (req, res) => {
  if (!req.file) return err(res, 400, "No file uploaded");
  if (!req.file.originalname.toLowerCase().endsWith(".psd"))
    return err(res, 400, "Only .psd files are accepted");

  const map = await prisma.venueMap.findUnique({
    where: { id: req.params.mapId },
    select: { svgViewBox: true },
  });
  if (!map) return err(res, 404, "Map not found");

  const [, , svgWidth, svgHeight] = map.svgViewBox.split(" ").map(Number);

  const form = new FormData();
  form.append("file", new Blob([req.file.buffer as unknown as ArrayBuffer], { type: "application/octet-stream" }), req.file.originalname);

  let analyzerRes: Response;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 110_000); // 110s — just under Vite's 120s proxy timeout
    analyzerRes = await fetch(
      `${ANALYZER_URL}/analyze?svgWidth=${svgWidth}&svgHeight=${svgHeight}`,
      { method: "POST", body: form, signal: ac.signal }
    );
    clearTimeout(timer);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError")
      return err(res, 504, "Analysis timed out. The file may be too complex — try simplifying the PSD layers.");
    return err(res, 502, "Analyzer service is not reachable. Make sure it is running on port 8001.");
  }

  if (!analyzerRes.ok) {
    const body = await analyzerRes.text().catch(() => "");
    return err(res, 502, `Analyzer error: ${body}`);
  }

  const result = await analyzerRes.json().catch(() => null);
  if (!result) return err(res, 502, "Analyzer returned an unreadable response");
  res.json(result);
}));

// Proxy a DXF/DWG file to the Python analyzer and return the analysis JSON.
app.post("/api/maps/:mapId/analyze-dxf", upload.single("file"), ah(async (req, res) => {
  if (!req.file) return err(res, 400, "No file uploaded");
  const fname = req.file.originalname.toLowerCase();
  if (!fname.endsWith(".dxf") && !fname.endsWith(".dwg"))
    return err(res, 400, "Only .dxf and .dwg files are accepted");

  const map = await prisma.venueMap.findUnique({
    where: { id: req.params.mapId },
    select: { svgViewBox: true },
  });
  if (!map) return err(res, 404, "Map not found");

  const [, , svgWidth, svgHeight] = map.svgViewBox.split(" ").map(Number);

  const form = new FormData();
  form.append("file", new Blob([req.file.buffer as unknown as ArrayBuffer], { type: "application/octet-stream" }), req.file.originalname);

  let analyzerRes: Response;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 110_000);
    analyzerRes = await fetch(
      `${ANALYZER_URL}/analyze-dxf?svgWidth=${svgWidth}&svgHeight=${svgHeight}`,
      { method: "POST", body: form, signal: ac.signal }
    );
    clearTimeout(timer);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError")
      return err(res, 504, "Analysis timed out. The file may be too complex — try simplifying layers or exporting a smaller area.");
    return err(res, 502, "Analyzer service is not reachable. Make sure it is running on port 8001.");
  }

  if (!analyzerRes.ok) {
    const body = await analyzerRes.text().catch(() => "");
    return err(res, 502, `Analyzer error: ${body}`);
  }

  const result = await analyzerRes.json().catch(() => null);
  if (!result) return err(res, 502, "Analyzer returned an unreadable response");
  res.json(result);
}));

// Proxy a raster image (PNG/JPEG/WebP) to the Python analyzer.
app.post("/api/maps/:mapId/analyze-image", upload.single("file"), ah(async (req, res) => {
  if (!req.file) return err(res, 400, "No file uploaded");
  const fname = req.file.originalname.toLowerCase();
  if (!fname.endsWith(".png") && !fname.endsWith(".jpg") && !fname.endsWith(".jpeg") && !fname.endsWith(".webp"))
    return err(res, 400, "Only .png, .jpg, .jpeg, .webp images are accepted");

  const map = await prisma.venueMap.findUnique({
    where: { id: req.params.mapId },
    select: { svgViewBox: true },
  });
  if (!map) return err(res, 404, "Map not found");

  const [, , svgWidth, svgHeight] = map.svgViewBox.split(" ").map(Number);

  const form = new FormData();
  form.append("file", new Blob([req.file.buffer as unknown as ArrayBuffer], { type: req.file.mimetype }), req.file.originalname);

  let analyzerRes: Response;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 110_000);
    analyzerRes = await fetch(
      `${ANALYZER_URL}/analyze-image?svgWidth=${svgWidth}&svgHeight=${svgHeight}`,
      { method: "POST", body: form, signal: ac.signal }
    );
    clearTimeout(timer);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError")
      return err(res, 504, "Analysis timed out. The image may be too large or complex.");
    return err(res, 502, "Analyzer service is not reachable. Make sure it is running on port 8001.");
  }

  if (!analyzerRes.ok) {
    const body = await analyzerRes.text().catch(() => "");
    return err(res, 502, `Analyzer error: ${body}`);
  }

  const result = await analyzerRes.json().catch(() => null);
  if (!result) return err(res, 502, "Analyzer returned an unreadable response");
  res.json(result);
}));

// Grid-fill seat generator — mirrors seat_generator.py logic
// Runs server-side during import so Python analyzer stays fast.
const SEAT_SPACING_X = 22;
const SEAT_SPACING_Y = 22;
const SEAT_MARGIN    = 10;
const SEATED_IMPORT_TYPES = new Set(["RESERVED", "ACCESSIBLE", "RESTRICTED"]);

function rowLabel(index: number): string {
  let label = "";
  let n = index;
  do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return label;
}

function generateRowsForBbox(bbox: { top: number; left: number; bottom: number; right: number }, sectionType: string) {
  if (!SEATED_IMPORT_TYPES.has(sectionType)) return [];
  const left = bbox.left + SEAT_MARGIN, right = bbox.right - SEAT_MARGIN;
  const top  = bbox.top  + SEAT_MARGIN, bottom = bbox.bottom - SEAT_MARGIN;
  if (right <= left || bottom <= top) return [];
  const rows: { label: string; startX: number; startY: number; angle: number; seats: { seatNumber: string; x: number; y: number }[] }[] = [];
  let rowY = top, rowIdx = 0;
  while (rowY <= bottom) {
    const seats: { seatNumber: string; x: number; y: number }[] = [];
    let seatX = left, seatNum = 1;
    while (seatX <= right) { seats.push({ seatNumber: String(seatNum++), x: Math.round(seatX * 100) / 100, y: Math.round(rowY * 100) / 100 }); seatX += SEAT_SPACING_X; }
    if (seats.length) rows.push({ label: rowLabel(rowIdx), startX: Math.round(left * 100) / 100, startY: Math.round(rowY * 100) / 100, angle: 0, seats });
    rowY += SEAT_SPACING_Y; rowIdx++;
  }
  return rows;
}

const ImportSectionsSchema = z.object({
  sections: z.array(z.object({
    name: z.string(),
    label: z.string(),
    sectionType: z.enum(["RESERVED", "GA", "ACCESSIBLE", "RESTRICTED", "TABLE", "STAGE", "BAR", "BATHROOM", "DANCING", "PARKING", "STAIRS", "WALL", "DOOR", "CHECKIN", "TEXT"]),
    polygonPath: z.string(),
    bbox: z.object({ top: z.number(), left: z.number(), bottom: z.number(), right: z.number() }).optional(),
    tableChairs: z.number().int().positive().nullish(),
    rows: z.array(z.object({
      label: z.string(), startX: z.number(), startY: z.number(), angle: z.number().default(0),
      seats: z.array(z.object({ seatNumber: z.string(), x: z.number(), y: z.number() })),
    })).default([]),
  })),
});

// Generate tableMeta JSON for a TABLE section based on its bbox.
// Stored in notes so the client renders it as a round table graphic with chairs.
// Chairs are rendered at: table_radius + GAP(14) + chair_radius(~7) = table_radius + 21
// So the bbox Claude returns ≈ table_diameter + 2*21 = table_diameter + 42
// → table_diameter = bbox_size - 42
const CHAIR_VISUAL_MARGIN = 42; // space occupied by chairs outside table surface

function tableNotesForBbox(
  bbox: { top: number; left: number; bottom: number; right: number },
  tableChairs?: number | null,
): string {
  const bw = bbox.right - bbox.left;
  const bh = bbox.bottom - bbox.top;
  const isRound = Math.abs(bw - bh) / Math.max(bw, bh, 1) < 0.35;
  if (isRound) {
    const diameter = Math.max(24, Math.min(bw, bh) - CHAIR_VISUAL_MARGIN);
    const cpl = tableChairs
      ? Math.max(4, Math.min(20, tableChairs))
      : Math.max(4, Math.min(16, Math.round(Math.PI * diameter / 16)));
    return JSON.stringify({ shape: "round", w: Math.round(diameter), h: Math.round(diameter), cpl, cps: 0, angle: 0 });
  } else {
    const w = Math.max(24, bw - CHAIR_VISUAL_MARGIN);
    const h = Math.max(24, bh - CHAIR_VISUAL_MARGIN);
    const cpl = tableChairs ? Math.max(1, Math.ceil(tableChairs / 2)) : Math.max(1, Math.round(w / 22));
    const cps = tableChairs ? Math.max(1, Math.floor(tableChairs / 2)) : Math.max(1, Math.round(h / 22));
    return JSON.stringify({ shape: "rectangle", w: Math.round(w), h: Math.round(h), cpl, cps, angle: 0 });
  }
}

// Push overlapping TABLE bboxes apart while preserving their relative arrangement.
// Uses iterative repulsion: tables push each other away until no bbox centers overlap.
function resolveTableOverlaps(
  tables: { bbox: { top: number; left: number; bottom: number; right: number }; name: string }[],
  maxIter = 50,
): void {
  if (tables.length < 2) return;
  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const a = tables[i].bbox, b = tables[j].bbox;
        const acx = (a.left + a.right) / 2, acy = (a.top + a.bottom) / 2;
        const bcx = (b.left + b.right) / 2, bcy = (b.top + b.bottom) / 2;
        const aw = a.right - a.left, ah = a.bottom - a.top;
        const bw = b.right - b.left, bh = b.bottom - b.top;
        // Minimum separation needed (center-to-center)
        const minDx = (aw + bw) / 2;
        const minDy = (ah + bh) / 2;
        const dx = bcx - acx, dy = bcy - acy;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // Push along the axis of least overlap
        moved = true;
        const pushX = overlapX < overlapY ? (dx >= 0 ? overlapX / 2 : -overlapX / 2) : 0;
        const pushY = overlapX >= overlapY ? (dy >= 0 ? overlapY / 2 : -overlapY / 2) : 0;
        const half = 0.5;
        tables[i].bbox = { left: a.left - pushX * half, right: a.right - pushX * half, top: a.top - pushY * half, bottom: a.bottom - pushY * half };
        tables[j].bbox = { left: b.left + pushX * half, right: b.right + pushX * half, top: b.top + pushY * half, bottom: b.bottom + pushY * half };
      }
    }
    if (!moved) break;
  }
}

// Bulk-create sections + rows + seats from an analyzed file.
// Seat generation happens here (not in Python) to keep analysis fast.
app.post("/api/maps/:mapId/import-sections", ah(async (req, res) => {
  const p = ImportSectionsSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);

  const mapExists = await prisma.venueMap.findUnique({ where: { id: req.params.mapId }, select: { id: true } });
  if (!mapExists) return err(res, 404, "Map not found");

  const sectionIds: string[] = [];

  const VENUE_OBJ_TYPES = new Set(["STAGE","BAR","BATHROOM","DANCING","PARKING","STAIRS","WALL","DOOR","CHECKIN"]);
  type BboxEntry = { bbox: { top: number; left: number; bottom: number; right: number }; name: string };

  // Step 1: resolve TABLE-to-TABLE overlaps (symmetric — both sides move)
  const tableSections = p.data.sections
    .filter(s => s.sectionType === "TABLE" && s.bbox)
    .map(s => ({ bbox: { ...s.bbox! }, name: s.name }));
  resolveTableOverlaps(tableSections);

  // Step 2: push venue objects away from final table positions (one-sided — only object moves)
  const objSections = p.data.sections
    .filter(s => VENUE_OBJ_TYPES.has(s.sectionType) && s.bbox)
    .map(s => ({ bbox: { ...s.bbox! }, name: s.name }));

  for (const obj of objSections) {
    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (const tbl of tableSections) {
        const a = obj.bbox, b = tbl.bbox;
        const acx = (a.left + a.right) / 2, acy = (a.top + a.bottom) / 2;
        const bcx = (b.left + b.right) / 2, bcy = (b.top + b.bottom) / 2;
        const overlapX = (a.right - a.left + b.right - b.left) / 2 - Math.abs(acx - bcx);
        const overlapY = (a.bottom - a.top + b.bottom - b.top) / 2 - Math.abs(acy - bcy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // Only move the object (not the table)
        const dx = acx - bcx, dy = acy - bcy;
        if (overlapX < overlapY) {
          const push = dx >= 0 ? overlapX : -overlapX;
          obj.bbox = { left: a.left + push, right: a.right + push, top: a.top, bottom: a.bottom };
        } else {
          const push = dy >= 0 ? overlapY : -overlapY;
          obj.bbox = { left: a.left, right: a.right, top: a.top + push, bottom: a.bottom + push };
        }
        moved = true;
      }
      if (!moved) break;
    }
  }

  // Step 3: resolve venue object-to-object overlaps (symmetric)
  resolveTableOverlaps(objSections);

  // Write resolved bboxes back
  let tableIdx = 0, objIdx = 0;
  const resolvedSections = p.data.sections.map(s => {
    if (s.sectionType === "TABLE" && s.bbox) {
      return { ...s, bbox: tableSections[tableIdx++].bbox };
    }
    if (VENUE_OBJ_TYPES.has(s.sectionType) && s.bbox) {
      return { ...s, bbox: objSections[objIdx++].bbox };
    }
    return s;
  });

  // Process sections sequentially outside a single mega-transaction to avoid
  // timeout on large venues. Each section is its own atomic unit.
  for (const sec of resolvedSections) {
    const rows = sec.rows.length > 0
      ? sec.rows                                      // caller provided rows (legacy)
      : sec.bbox ? generateRowsForBbox(sec.bbox, sec.sectionType) : [];  // generate from bbox

    // TABLE sections: store tableMeta in notes so client renders the round/rect graphic.
    // Also recompute polygonPath from resolved bbox so the selection outline matches.
    let { polygonPath } = sec;
    const notes = (sec.sectionType === "TABLE" && sec.bbox)
      ? tableNotesForBbox(sec.bbox, sec.tableChairs)
      : undefined;
    if (sec.bbox && (sec.sectionType === "TABLE" || VENUE_OBJ_TYPES.has(sec.sectionType))) {
      const { left, top, right, bottom } = sec.bbox;
      polygonPath = `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
    }

    await prisma.$transaction(async (tx) => {
      const created = await tx.section.create({
        data: { mapId: req.params.mapId, name: sec.name, label: sec.label, sectionType: sec.sectionType, polygonPath, ...(notes ? { notes } : {}) },
      });
      sectionIds.push(created.id);
      for (const row of rows) {
        await tx.row.create({
          data: {
            sectionId: created.id, label: row.label, startX: row.startX, startY: row.startY, angle: row.angle,
            ...(row.seats.length > 0 ? { seats: { create: row.seats } } : {}),
          },
        });
      }
    });
  }

  res.status(201).json({ ok: true, count: sectionIds.length, sectionIds });
}));

// ── Rows + Seats ──────────────────────────────────────────────────────────
app.post("/api/sections/:sectionId/rows", ah(async (req, res) => {
  const { label, startX, startY, angle, seats } = req.body;
  res.status(201).json(await prisma.row.create({
    data: { sectionId: req.params.sectionId, label, startX, startY, angle: angle ?? 0,
      seats: seats ? { create: seats } : undefined },
    include: { seats: true },
  }));
}));

// Update seat (seatNumber, position, shape, and/or zoneId — shape+zone stored as JSON in notes)
app.patch("/api/seats/:seatId", ah(async (req, res) => {
  const { seatNumber, x, y, shape, zoneId } = req.body as { seatNumber?: string; x?: number; y?: number; shape?: string; zoneId?: string };
  const data: Record<string, unknown> = {};
  if (seatNumber !== undefined) data.seatNumber = seatNumber;
  if (x !== undefined) data.x = x;
  if (y !== undefined) data.y = y;
  if (shape !== undefined || zoneId !== undefined) {
    const cur = await prisma.seat.findUnique({ where: { id: req.params.seatId }, select: { notes: true } });
    let parsed: { s?: string; z?: string } = {};
    if (cur?.notes) {
      try { const p = JSON.parse(cur.notes); if (p.s) parsed.s = p.s; if (p.z) parsed.z = p.z; }
      catch { parsed.s = cur.notes; } // legacy plain-string shape
    }
    if (shape !== undefined) { if (shape) parsed.s = shape; else delete parsed.s; }
    if (zoneId !== undefined) { if (zoneId) parsed.z = zoneId; else delete parsed.z; }
    data.notes = Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null;
  }
  if (Object.keys(data).length === 0) return err(res, 400, "Nothing to update");
  res.json(await prisma.seat.update({ where: { id: req.params.seatId }, data }));
}));

// Delete a single seat
app.delete("/api/seats/:seatId", ah(async (req, res) => {
  await prisma.$transaction([
    prisma.seatInventory.deleteMany({ where: { seatId: req.params.seatId } }),
    prisma.seat.delete({ where: { id: req.params.seatId } }),
  ]);
  res.status(204).send();
}));

// Delete a row (and all its seats)
app.delete("/api/rows/:rowId", ah(async (req, res) => {
  const rowId = req.params.rowId;
  await prisma.$transaction([
    prisma.seatInventory.deleteMany({ where: { seat: { rowId } } }),
    prisma.seat.deleteMany({ where: { rowId } }),
    prisma.row.delete({ where: { id: rowId } }),
  ]);
  res.status(204).send();
}));

// Update a row (label and/or curve/skew)
app.patch("/api/rows/:rowId", ah(async (req, res) => {
  const { label, curve, skew } = req.body as { label?: string; curve?: number; skew?: number };
  const data: Record<string, unknown> = {};
  if (label !== undefined) data.label = label;
  if (curve !== undefined) data.curve = curve;
  if (skew  !== undefined) data.skew  = skew;
  if (Object.keys(data).length === 0) return err(res, 400, "Nothing to update");
  res.json(await prisma.row.update({ where: { id: req.params.rowId }, data }));
}));

// ── Zones ─────────────────────────────────────────────────────────────────
app.get("/api/maps/:mapId/zones", ah(async (req, res) => {
  res.json(await prisma.pricingZone.findMany({ where: { mapId: req.params.mapId }, orderBy: { sortOrder: "asc" } }));
}));
app.post("/api/maps/:mapId/zones", ah(async (req, res) => {
  const p = CreateZoneSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.pricingZone.create({ data: { ...p.data, mapId: req.params.mapId } }));
}));
app.put("/api/sections/:sectionId/zone", ah(async (req, res) => {
  const { zoneId } = req.body as { zoneId?: string };
  const sectionId = req.params.sectionId;
  await prisma.sectionZoneMapping.deleteMany({ where: { sectionId } });
  if (!zoneId) { res.json({ ok: true }); return; }
  res.json(await prisma.sectionZoneMapping.create({ data: { sectionId, zoneId } }));
}));
app.delete("/api/zones/:zoneId", ah(async (req, res) => {
  // SectionZoneMapping cascades via Prisma schema (onDelete: Cascade on zone relation)
  await prisma.pricingZone.delete({ where: { id: req.params.zoneId } });
  res.status(204).send();
}));
// Batch-assign a zone (or clear it) for a list of seats — stores zone in seat.notes JSON
app.post("/api/maps/:mapId/seats/batch-zone", ah(async (req, res) => {
  const { seatIds, zoneId } = req.body as { seatIds: string[]; zoneId: string | null };
  if (!Array.isArray(seatIds) || seatIds.length === 0) return err(res, 400, "seatIds must be a non-empty array");
  const existing = await prisma.seat.findMany({ where: { id: { in: seatIds } }, select: { id: true, notes: true } });
  await prisma.$transaction(existing.map(seat => {
    let parsed: { s?: string; z?: string } = {};
    if (seat.notes) {
      try { const p = JSON.parse(seat.notes); if (p.s) parsed.s = p.s; if (p.z) parsed.z = p.z; }
      catch { parsed.s = seat.notes; } // legacy plain-string shape
    }
    if (zoneId) parsed.z = zoneId; else delete parsed.z;
    const notes = Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null;
    return prisma.seat.update({ where: { id: seat.id }, data: { notes } });
  }));
  res.json({ ok: true, count: existing.length });
}));

// ── Map Holds ─────────────────────────────────────────────────────────────
app.post("/api/maps/:mapId/holds", ah(async (req, res) => {
  const { name, color } = req.body as { name: string; color?: string };
  if (!name) return err(res, 400, "name required");
  res.status(201).json(await prisma.mapHold.create({
    data: { mapId: req.params.mapId, name, color: color ?? "#888888" },
    include: { seats: { select: { seatId: true } } },
  }));
}));
app.patch("/api/holds/:holdId", ah(async (req, res) => {
  const { name, color } = req.body as { name?: string; color?: string };
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (color !== undefined) data.color = color;
  if (Object.keys(data).length === 0) return err(res, 400, "Nothing to update");
  res.json(await prisma.mapHold.update({
    where: { id: req.params.holdId }, data,
    include: { seats: { select: { seatId: true } } },
  }));
}));
app.delete("/api/holds/:holdId", ah(async (req, res) => {
  await prisma.$transaction([
    prisma.heldSeat.deleteMany({ where: { holdId: req.params.holdId } }),
    prisma.mapHold.delete({ where: { id: req.params.holdId } }),
  ]);
  res.status(204).send();
}));
// Replace the full seat list for a hold
app.put("/api/holds/:holdId/seats", ah(async (req, res) => {
  const { seatIds } = req.body as { seatIds: string[] };
  if (!Array.isArray(seatIds)) return err(res, 400, "seatIds must be array");
  const holdId = req.params.holdId;
  await prisma.$transaction([
    prisma.heldSeat.deleteMany({ where: { holdId } }),
    ...(seatIds.length > 0 ? [prisma.heldSeat.createMany({
      data: seatIds.map(seatId => ({ holdId, seatId })),
      skipDuplicates: true,
    })] : []),
  ]);
  res.json({ ok: true, count: seatIds.length });
}));

// ── Inventory ─────────────────────────────────────────────────────────────
app.get("/api/events/:eventId/inventory", ah(async (req, res) => {
  const rows = await prisma.seatInventory.findMany({
    where: { eventId: req.params.eventId },
    select: { seatId: true, status: true },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.seatId] = r.status;
  res.json(map);
}));

// ── Dev helpers ───────────────────────────────────────────────────────────
app.post("/api/dev/events/:eventId/mark-sold", ah(async (req, res) => {
  const { seatIds } = req.body as { seatIds: string[] };
  if (!Array.isArray(seatIds) || seatIds.length === 0) return err(res, 400, "seatIds required");
  await prisma.seatInventory.updateMany({
    where: { eventId: req.params.eventId, seatId: { in: seatIds } },
    data: { status: "SOLD", heldBy: null, heldAt: null },
  });
  for (const seatId of seatIds) {
    io.to(`event:${req.params.eventId}`).emit("seat:update", { seatId, status: "SOLD" });
  }
  res.json({ ok: true, count: seatIds.length });
}));

// ── Global error handler ──────────────────────────────────────────────────
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[API Error]", error);
  res.status(500).json({ error: error.message || "Internal server error" });
});

// ── WebSocket ─────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const sessionId = socket.handshake.auth.sessionId as string | undefined;

  socket.on("event:join", (eventId: string) => socket.join(`event:${eventId}`));
  socket.on("event:leave", (eventId: string) => socket.leave(`event:${eventId}`));

  socket.on("seat:hold", async (
    { eventId, seatId }: { eventId: string; seatId: string },
    ack: (r: { ok: boolean; status?: SeatStatus; error?: string }) => void
  ) => {
    try {
      const inv = await prisma.seatInventory.upsert({
        where: { eventId_seatId: { eventId, seatId } },
        create: { eventId, seatId, status: "HELD", heldBy: sessionId, heldAt: new Date() },
        update: { status: "HELD", heldBy: sessionId, heldAt: new Date() },
      });
      if (inv.status !== "HELD" || inv.heldBy !== sessionId)
        return ack({ ok: false, status: inv.status, error: "Not available" });
      io.to(`event:${eventId}`).emit("seat:update", { seatId, status: "HELD" });
      ack({ ok: true, status: "HELD" });
    } catch (e) { ack({ ok: false, error: "Server error" }); console.error("[seat:hold]", e); }
  });

  socket.on("seat:release", async ({ eventId, seatId }: { eventId: string; seatId: string }) => {
    try {
      await prisma.seatInventory.updateMany({
        where: { eventId, seatId, heldBy: sessionId, status: "HELD" },
        data: { status: "AVAILABLE", heldBy: null, heldAt: null },
      });
      io.to(`event:${eventId}`).emit("seat:update", { seatId, status: "AVAILABLE" });
    } catch (e) { console.error("[seat:release]", e); }
  });

  socket.on("disconnect", async () => {
    if (!sessionId) return;
    try {
      const r = await prisma.seatInventory.updateMany({
        where: { heldBy: sessionId, status: "HELD" },
        data: { status: "AVAILABLE", heldBy: null, heldAt: null },
      });
      if (r.count > 0) io.emit("seat:stale", { sessionId });
    } catch (e) { console.error("[disconnect]", e); }
  });
});

// ── Process-level safety net ──────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on :${PORT}`));
