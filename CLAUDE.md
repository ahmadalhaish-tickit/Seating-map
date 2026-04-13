# TICKIT — seating-test1

> Concert hall / theater seat map platform — React + Node.js monorepo.

## Project location
`~/Desktop/TICKIT/seating-test1`

---

## Stack

| Layer | Tech |
|---|---|
| Client | React 18 + TypeScript + Vite |
| Server | Node.js + Express + TypeScript |
| Realtime | Socket.io (WebSocket seat locking) |
| Database | PostgreSQL via Prisma ORM |
| Gestures | @use-gesture/react (pan, pinch, scroll zoom) |
| Validation | Zod |
| Monorepo | npm workspaces |

---

## Folder structure

```
seating-test1/
├── package.json                    # root — workspaces + concurrently dev script
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   └── index.ts           # Express REST API + Socket.io seat locking
│   │   ├── prisma/
│   │   │   └── schema.prisma      # Full DB schema
│   │   ├── tsconfig.json
│   │   └── .env                   # DATABASE_URL, CLIENT_URL, PORT
│   ├── client/
│   │   ├── src/
│   │   │   ├── main.tsx           # React entry point
│   │   │   ├── App.tsx            # Nav shell
│   │   │   ├── index.css
│   │   │   └── components/
│   │   │       ├── SeatMap.tsx    # Customer-facing seat map renderer
│   │   │       └── MapEditor.tsx  # Thin wrapper — provides MapEditorContext
│   │   │       └── mapeditor/     # All MapEditor sub-components (see below)
│   │   ├── index.html
│   │   ├── vite.config.ts         # proxies /api -> localhost:3001
│   │   ├── tsconfig.json
│   │   └── .env                   # VITE_API_URL
│   └── shared/
│       └── src/                   # Shared types (to populate)
```

---

## MapEditor architecture

MapEditor.tsx is now a thin wrapper (~20 lines). All state and logic lives in sub-modules:

```
components/mapeditor/
├── types.tsx              # All types, constants, and pure helper functions
├── styles.ts              # Shared CSS style constants (inp, pbtn, sbtn, dbtn, zbtn)
├── useMapEditorState.ts   # Custom hook — all state, refs, effects, handlers (~2400 lines)
├── MapEditorContext.tsx   # React Context wrapping useMapEditorState return type
├── Sidebar.tsx            # <aside> shell — tab bar, focus banner, renders sub-panels
├── CanvasSVG.tsx          # Full SVG canvas — all section type renderers, zoom controls
├── SidebarFocusTools.tsx  # Seat style, curve/skew sliders, bake transforms
├── SidebarEditorTools.tsx # Tool buttons (Select/Table/Object/Text/GA/Seated), file imports
├── SidebarInspectors.tsx  # Section, table, text, venue object inspectors + row generator
├── SidebarHoldsTab.tsx    # Holds management tab
├── ZonesPanel.tsx         # Pricing zones list + new zone form
├── CanvasOverlays.tsx     # Floating popups: seat rename, row edit, table popup, text widget
└── ImportModal.tsx        # PSD/DXF/Image import preview modal
```

**Pattern:** Every sub-component calls `useMapEditorContext()` — no props passed down. `MapEditor.tsx` only instantiates the hook, wraps with `<MapEditorContext.Provider>`, and renders `<Sidebar>`, `<CanvasSVG>`, and `<ImportModal>`.

**Wheel zoom:** React's `onWheel` is passive since React 17 (can't call `preventDefault`). The hook attaches a native `addEventListener("wheel", fn, { passive: false })` in a `useEffect` instead.

**Per-seat zone color:** Stored in `seat.notes` as JSON `{"s":"shape","z":"zoneId"}`. On the canvas, `dominantPerSeatZone` (most seats) colors the polygon fill; a small dot palette shows unique zones in the section without expanding it.

**Seat zone enforcement (SeatMap):** Seats with no pricing zone assigned cannot be selected in the customer-facing map view.

---

## Data model (Prisma)

```
Venue
 └── VenueMap          (svgViewBox, bgImageUrl, isPublished)
      ├── Section[]     (polygonPath, sectionType: RESERVED|GA|ACCESSIBLE|RESTRICTED|TABLE|TEXT|STAGE|BAR|…)
      │    └── Row[]
      │         └── Seat[]   (x, y, seatNumber, notes: JSON with shape + zoneId)
      ├── PricingZone[] (name, color hex, sortOrder)
      │    └── SectionZoneMapping (many-to-many Section <-> Zone)
      ├── MapHold[]     (name, color — blocks seats for organizer holds)
      └── Event[]
           ├── TicketType[] (price in cents, currency, maxPerOrder)
           └── SeatInventory[]  (status: AVAILABLE|HELD|RESERVED|SOLD|BLOCKED)
```

---

## REST API routes

| Method | Path | Description |
|---|---|---|
| GET | /api/venues | List all venues |
| POST | /api/venues | Create venue |
| GET | /api/maps/:id | Full map with sections, rows, seats, zones, holds |
| POST | /api/venues/:id/maps | Create map for venue |
| PATCH | /api/maps/:id/publish | Toggle isPublished |
| POST | /api/maps/:id/sections | Create section |
| PATCH | /api/sections/:id | Update section |
| DELETE | /api/sections/:id | Delete section |
| PATCH | /api/sections/:id/rotate | Rotate polygon + all seat positions |
| PATCH | /api/sections/:id/move | Bulk-move polygon + seats by delta |
| POST | /api/sections/:id/rows | Create row + seats |
| GET | /api/maps/:id/zones | List pricing zones |
| POST | /api/maps/:id/zones | Create pricing zone |
| PUT | /api/sections/:id/zone | Assign zone to section |
| GET | /api/events/:id/inventory | Compact {seatId: status} snapshot |
| POST | /api/maps/:id/analyze-psd | Proxy PSD to Python analyzer |
| POST | /api/maps/:id/analyze-dxf | Proxy DXF/DWG to Python analyzer |
| POST | /api/maps/:id/analyze-image | Proxy PNG/JPEG to Python analyzer |
| POST | /api/maps/:id/import-sections | Bulk-create sections from analyzer result |

---

## WebSocket events (Socket.io)

### Client -> Server
| Event | Payload | Description |
|---|---|---|
| event:join | eventId | Subscribe to event seat updates |
| event:leave | eventId | Unsubscribe |
| seat:hold | { eventId, seatId } | Request 8-min hold |
| seat:release | { eventId, seatId } | Release held seat |

### Server -> Client
| Event | Payload | Description |
|---|---|---|
| seat:update | { seatId, status } | Broadcast state change |
| seat:stale | { sessionId } | Session dropped, re-fetch inventory |
| holds:expired | { count } | Batch expiry, re-fetch inventory |

Auth: socket connects with `{ auth: { sessionId } }` — UUID stored in sessionStorage.
Hold expiry sweep runs every 30s on the server.

---

## SeatMap component

```tsx
<SeatMap
  mapId="cuid..."
  eventId="cuid..."
  sessionId="uuid..."          // from useSession hook
  onSelectionChange={(ids) => {}}
/>
```

Seat colours:
| Status | Colour |
|---|---|
| AVAILABLE | #1D9E75 teal |
| HELD (mine) | #7F77DD purple |
| HELD (other) | #BA7517 amber |
| RESERVED | #D85A30 coral |
| SOLD / BLOCKED | #888780 gray |

Seats with no pricing zone assigned are **not selectable**.

---

## MapEditor component

```tsx
<MapEditor
  mapId="cuid..."
  svgViewBox="0 0 1200 800"
  bgImageUrl="/floor-plan.png"
  initialZones={[]}
/>
```

Tools: Select | Table | Object | Text | GA Section | Seated
Section types: RESERVED, GA, ACCESSIBLE, RESTRICTED, TABLE, TEXT, STAGE, BAR, BATHROOM, DANCING, PARKING, STAIRS, WALL, DOOR, CHECKIN

---

## Environment variables

### packages/server/.env
```
DATABASE_URL="postgresql://ahmadalhaich@localhost:5432/tickit"
CLIENT_URL="http://localhost:5173"
PORT=3001
ANALYZER_URL=http://127.0.0.1:8001
```

### packages/client/.env
```
VITE_API_URL=http://localhost:3001
```

---

## Dev commands

```bash
# Run client + server together (from repo root)
cd ~/Desktop/TICKIT/seating-test1
npm run dev

# Server only
cd packages/server && npm run dev

# First-time DB setup
cd packages/server
npx prisma migrate dev --name init

# After schema changes
npx prisma generate

# Browse DB in browser
npx prisma studio
```

URLs:
- Client:        http://localhost:5173
- Server:        http://localhost:3001
- Prisma Studio: http://localhost:5555

---

## Git remote

`https://github.com/ahmadalhaish-tickit/Seating-map.git` — full monorepo pushed to `main`.

---

## What to build next

### 1. CheckoutPanel component
- Receives selected seat IDs from SeatMap onSelectionChange
- Fetches ticket prices from GET /api/events/:id/ticket-types
- Shows seat list + total price + "Proceed to payment" CTA
- Releases all holds on abandon

### 2. HoldTimer component
- Counts down 8:00 from first seat hold
- Warns at 2:00 remaining
- Auto-releases all held seats on expiry

### 3. Event + seed routes
- POST /api/events
- POST /api/events/:id/ticket-types
- `packages/server/prisma/seed.ts` — test venue + map + event + inventory

### 4. Shared types
Move SeatStatus, SeatInventory, FullMap types from SeatMap.tsx into
`packages/shared/src/types.ts` and import in both server and client.

### 5. Python analyzer (local image pipeline)
Plan exists at `/Users/ahmadalhaich/.claude/plans/wild-herding-dolphin.md`.
Local OpenCV + K-means + rules pipeline so image analysis works without Claude API key.

---

## Known gaps

- No user authentication yet — add JWT middleware to server when ready
- `seat:hold` upsert needs a Prisma transaction with `WHERE status = AVAILABLE` to prevent race conditions under high concurrency
- SeatMap.tsx imports Prisma types directly — move to shared package
- No React error boundaries yet
- Test pinch-zoom on a real mobile device for touch-action conflicts
- `useSession` hook already built (`packages/client/src/hooks/useSession.ts`)
