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
│   │   │       └── MapEditor.tsx  # Admin polygon-draw map builder
│   │   ├── index.html
│   │   ├── vite.config.ts         # proxies /api -> localhost:3001
│   │   ├── tsconfig.json
│   │   └── .env                   # VITE_API_URL
│   └── shared/
│       └── src/                   # Shared types (to populate)
```

---

## Data model (Prisma)

```
Venue
 └── VenueMap          (svgViewBox, bgImageUrl, isPublished)
      ├── Section[]     (polygonPath, sectionType: RESERVED|GA|ACCESSIBLE|RESTRICTED)
      │    └── Row[]
      │         └── Seat[]   (x, y, seatNumber, isAccessible, isObstructed)
      ├── PricingZone[] (name, color hex, sortOrder)
      │    └── SectionZoneMapping (many-to-many Section <-> Zone)
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
| GET | /api/maps/:id | Full map with sections, rows, seats, zones |
| POST | /api/venues/:id/maps | Create map for venue |
| PATCH | /api/maps/:id/publish | Toggle isPublished |
| POST | /api/maps/:id/sections | Create section |
| PATCH | /api/sections/:id | Update section |
| DELETE | /api/sections/:id | Delete section |
| POST | /api/sections/:id/rows | Create row + seats |
| GET | /api/maps/:id/zones | List pricing zones |
| POST | /api/maps/:id/zones | Create pricing zone |
| PUT | /api/sections/:id/zone | Assign zone to section |
| GET | /api/events/:id/inventory | Compact {seatId: status} snapshot |

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
  sessionId="uuid..."          // from useSession hook (see below)
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

Tools: Select | Draw polygon. Section inspector: name, label, type, zone.
Row generator: fills RESERVED section with auto-positioned seat circles.

---

## Environment variables

### packages/server/.env
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tickit_seating_test1"
CLIENT_URL="http://localhost:5173"
PORT=3001
```

### packages/client/.env
```
VITE_API_URL=http://localhost:3001
```

---

## Dev commands

```bash
# Run client + server together
cd ~/Desktop/TICKIT/seating-test1
npm run dev

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

## What to build next

### 1. useSession hook (do first)
Create `packages/client/src/hooks/useSession.ts`

```ts
import { useState } from "react"
export function useSession() {
  const [id] = useState(() => {
    let s = sessionStorage.getItem("tickit_session")
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem("tickit_session", s) }
    return s
  })
  return id
}
```

### 2. CheckoutPanel component
- Receives selected seat IDs from SeatMap onSelectionChange
- Fetches ticket prices from GET /api/events/:id/ticket-types
- Shows seat list + total price + "Proceed to payment" CTA
- Releases all holds on abandon

### 3. HoldTimer component
- Counts down 8:00 from first seat hold
- Warns at 2:00 remaining
- Auto-releases all held seats on expiry

### 4. Event + seed routes
- POST /api/events
- POST /api/events/:id/ticket-types
- `packages/server/prisma/seed.ts` — test venue + map + event + inventory

### 5. Shared types
Move SeatStatus, SeatInventory, FullMap types from SeatMap.tsx into
`packages/shared/src/types.ts` and import in both server and client.

---

## Known gaps

- No user authentication yet — add JWT middleware to server when ready
- `seat:hold` upsert needs a Prisma transaction with `WHERE status = AVAILABLE` to prevent race conditions under high concurrency
- SeatMap.tsx imports Prisma types directly — move to shared package
- No React error boundaries yet
- Test pinch-zoom on a real mobile device for touch-action conflicts