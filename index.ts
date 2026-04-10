import express from "express";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import cors from "cors";
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
app.use(express.json());

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
  label: z.string().max(6),
  sectionType: z.enum(["RESERVED", "GA", "ACCESSIBLE", "RESTRICTED"]),
  polygonPath: z.string(),
  sortOrder: z.number().int().optional(),
});
const CreateZoneSchema = z.object({
  name: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().optional(),
});

function err(res: express.Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

async function expireHolds() {
  const cutoff = new Date(Date.now() - HOLD_DURATION_MS);
  const expired = await prisma.seatInventory.updateMany({
    where: { status: "HELD", heldAt: { lt: cutoff } },
    data: { status: "AVAILABLE", heldBy: null, heldAt: null },
  });
  if (expired.count > 0) io.emit("holds:expired", { count: expired.count });
}
setInterval(expireHolds, 30_000);

// Venues
app.get("/api/venues", async (_req, res) => {
  res.json(await prisma.venue.findMany({ orderBy: { name: "asc" } }));
});
app.post("/api/venues", async (req, res) => {
  const p = CreateVenueSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  try { res.status(201).json(await prisma.venue.create({ data: p.data })); }
  catch { err(res, 409, "Slug already exists"); }
});

// Maps
app.get("/api/maps/:mapId", async (req, res) => {
  const map = await prisma.venueMap.findUnique({
    where: { id: req.params.mapId },
    include: {
      sections: { include: { rows: { include: { seats: true } }, zoneMappings: true }, orderBy: { sortOrder: "asc" } },
      pricingZones: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!map) return err(res, 404, "Map not found");
  res.json(map);
});
app.post("/api/venues/:venueId/maps", async (req, res) => {
  const p = CreateMapSchema.safeParse({ ...req.body, venueId: req.params.venueId });
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.venueMap.create({ data: p.data }));
});
app.patch("/api/maps/:mapId/publish", async (req, res) => {
  res.json(await prisma.venueMap.update({
    where: { id: req.params.mapId },
    data: { isPublished: req.body.isPublished ?? true },
  }));
});

// Sections
app.post("/api/maps/:mapId/sections", async (req, res) => {
  const p = UpsertSectionSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.section.create({ data: { ...p.data, mapId: req.params.mapId } }));
});
app.patch("/api/sections/:sectionId", async (req, res) => {
  const p = UpsertSectionSchema.partial().safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.json(await prisma.section.update({ where: { id: req.params.sectionId }, data: p.data }));
});
app.delete("/api/sections/:sectionId", async (req, res) => {
  await prisma.section.delete({ where: { id: req.params.sectionId } });
  res.status(204).send();
});

// Rows + Seats
app.post("/api/sections/:sectionId/rows", async (req, res) => {
  const { label, startX, startY, angle, seats } = req.body;
  res.status(201).json(await prisma.row.create({
    data: { sectionId: req.params.sectionId, label, startX, startY, angle: angle ?? 0,
      seats: seats ? { create: seats } : undefined },
    include: { seats: true },
  }));
});

// Zones
app.get("/api/maps/:mapId/zones", async (req, res) => {
  res.json(await prisma.pricingZone.findMany({ where: { mapId: req.params.mapId }, orderBy: { sortOrder: "asc" } }));
});
app.post("/api/maps/:mapId/zones", async (req, res) => {
  const p = CreateZoneSchema.safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.status(201).json(await prisma.pricingZone.create({ data: { ...p.data, mapId: req.params.mapId } }));
});
app.put("/api/sections/:sectionId/zone", async (req, res) => {
  const { zoneId } = req.body;
  res.json(await prisma.sectionZoneMapping.upsert({
    where: { sectionId_zoneId: { sectionId: req.params.sectionId, zoneId } },
    create: { sectionId: req.params.sectionId, zoneId },
    update: {},
  }));
});

// Inventory
app.get("/api/events/:eventId/inventory", async (req, res) => {
  const rows = await prisma.seatInventory.findMany({
    where: { eventId: req.params.eventId },
    select: { seatId: true, status: true },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.seatId] = r.status;
  res.json(map);
});

// WebSocket
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
    } catch { ack({ ok: false, error: "Server error" }); }
  });

  socket.on("seat:release", async ({ eventId, seatId }: { eventId: string; seatId: string }) => {
    await prisma.seatInventory.updateMany({
      where: { eventId, seatId, heldBy: sessionId, status: "HELD" },
      data: { status: "AVAILABLE", heldBy: null, heldAt: null },
    });
    io.to(`event:${eventId}`).emit("seat:update", { seatId, status: "AVAILABLE" });
  });

  socket.on("disconnect", async () => {
    if (!sessionId) return;
    const r = await prisma.seatInventory.updateMany({
      where: { heldBy: sessionId, status: "HELD" },
      data: { status: "AVAILABLE", heldBy: null, heldAt: null },
    });
    if (r.count > 0) io.emit("seat:stale", { sessionId });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on :${PORT}`));
