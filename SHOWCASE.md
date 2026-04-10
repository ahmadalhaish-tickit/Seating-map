# TICKIT — Interactive Venue Seating Platform

> A full-stack, real-time seat selection and map management platform built for concert halls and theaters. Customers browse live seat availability; administrators draw and configure maps with a professional WYSIWYG editor.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **Backend** | Node.js + Express + TypeScript |
| **Real-time** | Socket.io (WebSocket seat locking) |
| **Database** | PostgreSQL via Prisma ORM |
| **Gestures** | @use-gesture/react (pan, pinch, scroll zoom) |
| **Validation** | Zod |
| **Monorepo** | npm workspaces |

---

## Project Structure

```
seating-test1/
├── package.json                        # Root — workspaces + concurrently dev script
└── packages/
    ├── client/                         # React SPA (Vite)
    │   ├── index.html
    │   ├── vite.config.ts              # Proxies /api → localhost:3001 in dev
    │   ├── tsconfig.json
    │   └── src/
    │       ├── main.tsx                # React entry point
    │       ├── App.tsx                 # Nav shell + view switching + map/event selectors
    │       ├── index.css
    │       ├── hooks/
    │       │   └── useSession.ts       # Persistent browser session ID hook
    │       └── components/
    │           ├── SeatMap.tsx         # Customer-facing real-time seat map
    │           └── MapEditor.tsx       # Admin WYSIWYG map builder
    │
    ├── server/                         # Node.js API + WebSocket server
    │   ├── tsconfig.json
    │   ├── package.json
    │   ├── src/
    │   │   └── index.ts               # Express REST API + Socket.io (single entry)
    │   └── prisma/
    │       ├── schema.prisma           # Full DB schema — all models & enums
    │       └── seed.ts                 # Demo venue, map, event, and inventory
    │
    └── shared/
        └── src/                        # Shared TypeScript types (to be populated)
```

---

## Frontend Architecture

### Component Hierarchy & Data Flow

```
App.tsx
├── useSession()              → sessionId (browser-persistent UUID)
├── fetch /api/maps           → maps[], selectedMapId, selectedEventId
│
├── <SeatMap>                 (Customer view)
│   ├── fetch /api/maps/:id   → sections, rows, seats, zones, holds
│   ├── fetch /api/events/:id/inventory → { seatId: status }
│   └── socket.io             → live seat:update / seat:hold / seat:release
│
└── <MapEditor>               (Admin view)
    ├── fetch /api/maps/:id   → full map data
    ├── CRUD /api/sections    → create, update, delete, rotate, move
    ├── CRUD /api/rows        → create, update, delete
    ├── CRUD /api/seats       → update position, shape, seatNumber
    └── CRUD /api/maps/:id/zones → create zones, assign to sections
```

---

### Reused Geometry Utilities

One of the key design decisions was to extract all SVG geometry into standalone pure functions, which are shared between both `SeatMap.tsx` (the viewer) and `MapEditor.tsx` (the editor). This avoids duplication and ensures that what the editor draws and what the viewer renders are computed identically.

**Functions used in both components:**

| Function | Purpose |
|---|---|
| `pathPoints(path)` | Parse SVG polygon path string → `Point[]` |
| `centroid(path)` | Compute polygon center (used for labels and rotation pivot) |
| `pathBBox(path)` | Get bounding box (min/max X and Y) |
| `polyArea(pts)` | Shoelace formula — polygon area (for label sizing) |
| `curvedPath(pts, curve)` | Generate quadratic bezier SVG path from polygon vertices |
| `rotateAround(pts, cx, cy, deg)` | 2D rotation of a point set |
| `computeChairPositions(meta, cx, cy)` | Chair placement around tables (all table shapes) |
| `renderSeat()` | Unified seat renderer for all shapes |
| `renderVenueIcon()` | SVG icon renderer for stage, bar, bathroom, etc. |

```ts
// curvedPath — used by both viewer and editor to render smooth section edges
function curvedPath(pts: Point[], curve: number): string {
  if (Math.abs(curve) < 0.5 || pts.length < 2) {
    return "M " + pts.map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
  }
  const n = pts.length;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    d += ` Q ${mx + curve * (-dy / len)} ${my + curve * (dx / len)} ${p2.x} ${p2.y}`;
  }
  return d;
}

// rotateAround — used in both rotation drag (editor) and displaying rotated sections (viewer)
function rotateAround(pts: Point[], cx: number, cy: number, angleDeg: number): Point[] {
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return pts.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}
```

---

### `useSession` Hook

A lightweight custom hook that generates and persists a UUID for the browser session. It is passed to `SeatMap` and Socket.io to associate real-time seat holds with a specific client. Used in both components through `App.tsx`.

```ts
// packages/client/src/hooks/useSession.ts
export function useSession() {
  const [id] = useState(() => {
    let s = sessionStorage.getItem("tickit_session");
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem("tickit_session", s); }
    return s;
  });
  return id;
}
```

```tsx
// App.tsx — sessionId flows down to SeatMap
const sessionId = useSession()
// ...
<SeatMap mapId={selectedMapId} eventId={selectedEventId} sessionId={sessionId} />
```

---

### Shared Type System

Both `SeatMap` and `MapEditor` share the same core TypeScript types. These are co-located today and targeted to move into `packages/shared` as the project grows.

```ts
type SeatStatus = "AVAILABLE" | "HELD" | "RESERVED" | "SOLD" | "BLOCKED";
type SeatShapeType = "circle" | "square" | "triangle" | "chair" | "wheelchair";
type TableShape = "rectangle" | "round" | "square" | "oval" | "booth";
type VenueObjectType = "STAGE" | "BAR" | "BATHROOM" | "DANCING" | "PARKING"
                     | "STAIRS" | "WALL" | "DOOR" | "CHECKIN" | "TEXT";

interface Point { x: number; y: number }
interface TableMeta { shape: TableShape; w: number; h: number; cpl: number; cps: number; angle: number }

// Seat status → color mapping — same object used in viewer and editor
const STATUS_COLORS: Record<SeatStatus, string> = {
  AVAILABLE: "#1D9E75",
  HELD:      "#BA7517",
  RESERVED:  "#D85A30",
  SOLD:      "#888780",
  BLOCKED:   "#888780",
};
```

---

### State Management — Drag State Machine (useRef Pattern)

The `MapEditor` manages multiple concurrent drag interactions (pan, section move, vertex resize, seat drag, rotation, group rotation). Rather than putting in-progress drag state into `useState` (which would trigger expensive re-renders on every mouse move), each drag operation uses a `useRef` — updated freely on `mousemove` without re-rendering, and committed to `useState` only on `mouseup`.

```ts
// Drag state refs — none of these trigger re-renders on mouse move
const panState = useRef<{
  startX: number; startY: number; startTx: number; startTy: number;
} | null>(null);

const sectionDragState = useRef<{
  sectionId: string;
  startClientX: number; startClientY: number;
  origPoints: Point[]; origSeats: SeatDot[];
  downTarget: Element;
  extra: { id: string; origPoints: Point[]; origSeats: SeatDot[] }[];  // multi-select
} | null>(null);

const rotationDragState = useRef<{
  sectionId: string;
  centerX: number; centerY: number; startAngle: number;
  origPoints: Point[];
  origSeats: { id: string; x: number; y: number }[];
  origDisplaySeats: { id: string; x: number; y: number }[];
  sectionHasRows: boolean;
  origTableAngle?: number;
  origDoorAngle?: number;
} | null>(null);

const groupRotationDragState = useRef<{
  centerX: number; centerY: number; startAngle: number;
  sections: {
    id: string; origPoints: Point[]; origSeats: { id: string; x: number; y: number }[];
    origTableAngle?: number; origDoorAngle?: number;
  }[];
} | null>(null);

const hasDragged = useRef(false);     // click vs. drag threshold
const clipboardRef = useRef<DraftSection[]>([]);  // Cmd+C / Cmd+V clipboard
```

---

### Real-time Seat Selection with Socket.io

`SeatMap` establishes a Socket.io connection authenticated with the session ID. The component joins the event's room and subscribes to live inventory updates — every hold, release, or expiry broadcast by the server is merged directly into the local inventory map, making the UI update without a full refetch.

```ts
// Connect and join the event room
useEffect(() => {
  const socket = io(import.meta.env.VITE_API_URL || "http://localhost:3001", {
    auth: { sessionId },
  });
  socketRef.current = socket;
  socket.emit("event:join", eventId);

  // Merge single-seat updates into local inventory
  socket.on("seat:update", ({ seatId, status }: { seatId: string; status: SeatStatus }) =>
    setInventory(p => ({ ...p, [seatId]: status })));

  // Re-fetch full inventory when the server signals stale state
  socket.on("seat:stale", () =>
    fetch(`/api/events/${eventId}/inventory`).then(r => r.json()).then(setInventory));

  socket.on("holds:expired", () =>
    fetch(`/api/events/${eventId}/inventory`).then(r => r.json()).then(setInventory));

  return () => { socket.emit("event:leave", eventId); socket.disconnect(); };
}, [eventId, sessionId]);
```

When a customer clicks a seat, the hold is requested via a Socket.io acknowledgement callback:

```ts
socketRef.current?.emit("seat:hold", { eventId, seatId: seat.id },
  (res: { ok: boolean; status?: SeatStatus }) => {
    if (!res.ok) {
      // Server rejected — remove from selection and reflect true status
      setInventory(p => ({ ...p, [seat.id]: res.status ?? "HELD" }));
      setSelected(p => { const n = new Set(p); n.delete(seat.id); return n; });
    }
  }
);
```

---

### Pan + Pinch Zoom via @use-gesture

Both the viewer and editor support smooth pan and pinch/scroll zoom, implemented with `useGesture`. The viewport is a single CSS `transform` on an SVG group — no layout recalculation on zoom.

```ts
useGesture({
  onDrag: ({ delta: [dx, dy] }) =>
    setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy })),

  onPinch: ({ origin, da: [d], memo }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const ox = origin[0] - rect.left, oy = origin[1] - rect.top;
    const prevScale = memo?.scale ?? transform.scale;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevScale * (d / (memo?.d ?? d))));
    const sf = newScale / prevScale;
    setTransform(t => ({ scale: newScale, x: ox - sf * (ox - t.x), y: oy - sf * (oy - t.y) }));
    return { scale: newScale, d };
  },

  onWheel: ({ delta: [, dy], event }) => {
    event.preventDefault();
    // ... scroll-to-zoom logic
  },
}, { target: containerRef, eventOptions: { passive: false } });
```

---

## Backend Architecture

### Express + TypeScript — Clean Async Handler Pattern

All route handlers use a thin `ah()` wrapper that forwards any thrown promise rejection to Express's error middleware — eliminating try/catch boilerplate from every route while still producing consistent error responses.

```ts
// Utility helpers
function err(res: express.Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

type AsyncHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<unknown>;

function ah(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Global error handler — catches anything from ah()
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[API Error]", error);
  res.status(500).json({ error: error.message || "Internal server error" });
});
```

Every route uses `ah()` and validates its body with a **Zod schema** before touching the database:

```ts
const UpsertSectionSchema = z.object({
  name:        z.string(),
  label:       z.string(),
  sectionType: z.enum(["RESERVED","GA","ACCESSIBLE","RESTRICTED","TABLE",
                        "STAGE","BAR","BATHROOM","DANCING","PARKING",
                        "STAIRS","WALL","DOOR","CHECKIN","TEXT"]),
  polygonPath: z.string(),
  notes:       z.string().optional(),
  sortOrder:   z.number().int().optional(),
});

app.patch("/api/sections/:sectionId", ah(async (req, res) => {
  const p = UpsertSectionSchema.partial().safeParse(req.body);
  if (!p.success) return err(res, 400, p.error.message);
  res.json(await prisma.section.update({
    where: { id: req.params.sectionId },
    data: p.data,
  }));
}));
```

---

### Prisma ORM — Data Model

The schema mirrors the real-world hierarchy of a venue. `SeatInventory` is kept as a **separate projection table** — seats themselves are venue-level data (permanent), while inventory is event-level data (ephemeral per event). This design lets seat positions and numbering be defined once and reused across any number of events.

```prisma
model Venue {
  id      String     @id @default(cuid())
  name    String
  slug    String     @unique
  address String?
  maps    VenueMap[]
}

model VenueMap {
  id           String        @id @default(cuid())
  venueId      String
  svgViewBox   String        @default("0 0 1200 800")
  isPublished  Boolean       @default(false)
  venue        Venue         @relation(fields: [venueId], references: [id], onDelete: Cascade)
  sections     Section[]
  pricingZones PricingZone[]
  events       Event[]
  mapHolds     MapHold[]
}

model Section {
  id          String      @id @default(cuid())
  sectionType SectionType @default(RESERVED)
  polygonPath String                           // SVG path string — source of truth for shape
  notes       String?                          // JSON metadata (table config, label offsets, etc.)
  rows        Row[]
  zoneMappings SectionZoneMapping[]
}

model Row {
  id    String  @id @default(cuid())
  label String
  curve Float   @default(0)   // Arc/bulge applied to seat positions
  skew  Float   @default(0)   // Asymmetric offset
  seats Seat[]
}

model Seat {
  id           String  @id @default(cuid())
  seatNumber   String
  x            Float           // SVG coordinate
  y            Float
  isAccessible Boolean @default(false)
  inventory    SeatInventory[]
}

// Event-scoped seat status — decoupled from seat geometry
model SeatInventory {
  eventId String
  seatId  String
  status  SeatStatus @default(AVAILABLE)
  heldBy  String?    // sessionId of holding client
  heldAt  DateTime?
  @@unique([eventId, seatId])
  @@index([eventId, status])   // Fast expiry sweeps
}

// Many-to-many: sections can belong to a pricing zone
model SectionZoneMapping {
  sectionId String
  zoneId    String
  @@unique([sectionId, zoneId])
}

enum SeatStatus  { AVAILABLE  HELD  RESERVED  SOLD  BLOCKED }
enum SectionType { RESERVED  GA  ACCESSIBLE  RESTRICTED  TABLE
                   STAGE  BAR  BATHROOM  DANCING  PARKING
                   STAIRS  WALL  DOOR  CHECKIN  TEXT }
```

---

### Socket.io — Real-time Seat Locking

The server organises clients into per-event rooms (`event:{id}`). When a hold is requested, the server upserts the `SeatInventory` row and verifies ownership — ensuring only one client can hold a seat at a time. The result is broadcast to all clients in the room.

```ts
io.on("connection", (socket) => {
  const sessionId = socket.handshake.auth.sessionId as string | undefined;

  socket.on("event:join",  (eventId: string) => socket.join(`event:${eventId}`));
  socket.on("event:leave", (eventId: string) => socket.leave(`event:${eventId}`));

  socket.on("seat:hold", async (
    { eventId, seatId }: { eventId: string; seatId: string },
    ack: (r: { ok: boolean; status?: SeatStatus; error?: string }) => void
  ) => {
    try {
      const inv = await prisma.seatInventory.upsert({
        where:  { eventId_seatId: { eventId, seatId } },
        create: { eventId, seatId, status: "HELD", heldBy: sessionId, heldAt: new Date() },
        update: { status: "HELD", heldBy: sessionId, heldAt: new Date() },
      });
      // Ownership check — guard against a race condition
      if (inv.status !== "HELD" || inv.heldBy !== sessionId)
        return ack({ ok: false, status: inv.status, error: "Not available" });

      io.to(`event:${eventId}`).emit("seat:update", { seatId, status: "HELD" });
      ack({ ok: true, status: "HELD" });
    } catch (e) {
      ack({ ok: false, error: "Server error" });
    }
  });

  socket.on("seat:release", async ({ eventId, seatId }) => {
    await prisma.seatInventory.updateMany({
      where: { eventId, seatId, heldBy: sessionId, status: "HELD" },
      data:  { status: "AVAILABLE", heldBy: null, heldAt: null },
    });
    io.to(`event:${eventId}`).emit("seat:update", { seatId, status: "AVAILABLE" });
  });

  // Auto-release all holds when the client disconnects
  socket.on("disconnect", async () => {
    if (!sessionId) return;
    const r = await prisma.seatInventory.updateMany({
      where: { heldBy: sessionId, status: "HELD" },
      data:  { status: "AVAILABLE", heldBy: null, heldAt: null },
    });
    if (r.count > 0) io.emit("seat:stale", { sessionId });
  });
});
```

Hold expiry runs as a background sweep every 30 seconds — any hold older than 8 minutes is released and all clients are notified to re-fetch inventory:

```ts
const HOLD_DURATION_MS = 8 * 60 * 1000;

async function expireHolds() {
  const cutoff = new Date(Date.now() - HOLD_DURATION_MS);
  const expired = await prisma.seatInventory.updateMany({
    where: { status: "HELD", heldAt: { lt: cutoff } },
    data:  { status: "AVAILABLE", heldBy: null, heldAt: null },
  });
  if (expired.count > 0) io.emit("holds:expired", { count: expired.count });
}

setInterval(expireHolds, 30_000);
```

---

### Prisma Transactions — Atomic Batch Operations

Operations that must update multiple tables together use `prisma.$transaction` to guarantee atomicity. For example, rotating a section updates the polygon path and all seat coordinates in one database transaction:

```ts
app.patch("/api/sections/:sectionId/rotate", ah(async (req, res) => {
  const { polygonPath, seats, notes } = req.body as {
    polygonPath: string;
    seats: { id: string; x: number; y: number }[];
    notes?: string;
  };

  await prisma.$transaction(async tx => {
    await tx.section.update({
      where: { id: req.params.sectionId },
      data: { polygonPath, ...(notes !== undefined ? { notes } : {}) },
    });
    for (const seat of seats) {
      await tx.seat.update({ where: { id: seat.id }, data: { x: seat.x, y: seat.y } });
    }
  });

  res.json({ ok: true });
}));
```

The bulk-move endpoint uses Prisma's `increment` syntax to shift all seats in a section by a delta without fetching individual records:

```ts
app.patch("/api/sections/:sectionId/move", ah(async (req, res) => {
  const { dx, dy } = req.body as { dx: number; dy: number };
  const rows = await prisma.row.findMany({
    where:  { sectionId: req.params.sectionId },
    select: { id: true },
  });
  await prisma.seat.updateMany({
    where: { rowId: { in: rows.map(r => r.id) } },
    data:  { x: { increment: dx }, y: { increment: dy } },
  });
  res.json({ ok: true });
}));
```

---

## REST API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/venues` | List all venues |
| `POST` | `/api/venues` | Create venue |
| `GET` | `/api/maps` | List all maps (with venue, events, zones) |
| `GET` | `/api/maps/:id` | Full map — sections, rows, seats, zones, holds |
| `POST` | `/api/venues/:id/maps` | Create map for venue |
| `PATCH` | `/api/maps/:id/publish` | Toggle `isPublished` |
| `POST` | `/api/maps/:id/sections` | Create section |
| `PATCH` | `/api/sections/:id` | Update section |
| `DELETE` | `/api/sections/:id` | Delete section |
| `PATCH` | `/api/sections/:id/rotate` | Atomic rotate (section + all seats) |
| `PATCH` | `/api/sections/:id/move` | Bulk translate all seats by delta |
| `POST` | `/api/sections/:id/rows` | Create row with seats |
| `PATCH` | `/api/rows/:id` | Update row curve / skew |
| `DELETE` | `/api/rows/:id` | Delete row |
| `PATCH` | `/api/seats/:id` | Update seat number, position, or shape |
| `DELETE` | `/api/seats/:id` | Delete seat |
| `GET` | `/api/maps/:id/zones` | List pricing zones |
| `POST` | `/api/maps/:id/zones` | Create pricing zone |
| `PUT` | `/api/sections/:id/zone` | Assign (or unassign) section to zone |
| `GET` | `/api/events/:id/inventory` | Compact `{ seatId: status }` snapshot |
| `POST` | `/api/maps/:id/holds` | Create named map hold |
| `PUT` | `/api/holds/:id/seats` | Assign seats to a hold |
| `DELETE` | `/api/holds/:id` | Delete hold |

---

## WebSocket Event Reference

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `event:join` | `eventId` | Subscribe to live seat updates for an event |
| `event:leave` | `eventId` | Unsubscribe |
| `seat:hold` | `{ eventId, seatId }` | Request an 8-minute hold (with ACK callback) |
| `seat:release` | `{ eventId, seatId }` | Release a held seat |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `seat:update` | `{ seatId, status }` | Single seat status changed — merge into local inventory |
| `seat:stale` | `{ sessionId }` | Session dropped — re-fetch full inventory |
| `holds:expired` | `{ count }` | Batch expiry — re-fetch full inventory |

---

## Roadmap

- **Redux Toolkit / RTK Query** — centralised API state caching, replacing per-component `useState` fetches with shared query slices and cache invalidation
- **JWT auth middleware** — protect admin routes; guest vs. authenticated user flows
- **Shared types package** — migrate `SeatStatus`, `FullMap`, and other shared interfaces from component files into `packages/shared/src/types.ts`
- **Test suite** — Vitest for client-side unit tests, Supertest for API integration tests
