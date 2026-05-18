# API Inventory: TICKIT Seating Map

## Summary

| Field | Value |
|---|---|
| Project | seating-test1 (TICKIT Seating Map) |
| Developer | Ahmad Alhaish — ahmad.alhaish@tickit.co |
| Audit date | 2026-05-08 |
| Total APIs found | 44 HTTP endpoints + 7 Socket.IO events |
| Active / probably active | 38 HTTP + 7 Socket.IO |
| Needs developer confirmation | 6 |
| Deprecated/unreachable candidates | 0 |

**Base URL:** `import.meta.env.VITE_API_URL` (default `http://localhost:3001`). Dev: Vite proxies `/api/*` → `localhost:3001`. Prod: Vercel rewrites `/api/*` → Railway URL.

**Auth pattern:** All admin/editor endpoints are called with no explicit `Authorization` header in the fetch calls — the JWT is stored in a URL query param and verified once on load. The server currently does not enforce a bearer token on individual API routes; auth relies on the editor being accessible only via shared link. Customer-facing endpoints are fully public.

---

## API Inventory

| # | Feature | Method | Route | Status | Source refs | Request shape | Response fields used | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Auth — admin verify | GET | `/api/auth/verify` | Active | `App.tsx:53` | `?token=<jwt>` in query string | `d.eventId`, `d.error` | Entry point for admin link; token from URL param |
| 2 | Auth — issue token | POST | `/api/auth/token` | Needs developer confirmation | Server `index.ts:72`; not called by client | `{ eventId }` | Signed JWT | Used by external tooling to create share links; client never calls it |
| 3 | Events — list all | GET | `/api/events` | Active | `App.tsx:66,84` | — | `[{ id, name, date, venue, maps[] }]` | Used in both admin event selector and customer view fallback |
| 4 | Events — create | POST | `/api/events` | Active | `App.tsx:114` | `{ name: string }` | Full `EventData` with id | Admin modal |
| 5 | Events — active map | GET | `/api/events/:id/active-map` | Active | `App.tsx:90` | — | `{ id: mapId }` | Public; resolves published map for customer view |
| 6 | Events — create map | POST | `/api/events/:id/maps` | Active | `App.tsx:130` | `{ name, mapSlot: 1\|2\|3 }` | `{ id, name, mapSlot, svgViewBox, isPublished, … }` | Max 3 maps per event |
| 7 | Maps — load full map | GET | `/api/maps/:id` | Active | `SeatMap.tsx:382`, `useMapEditorState.ts:210,2152,2611` | — | Full map: sections, rows, seats, pricingZones, mapHolds, svgViewBox, bgImageUrl, floorNames | Called on mount; also re-fetched after split and import |
| 8 | Maps — toggle publish | PATCH | `/api/maps/:id/publish` | Needs developer confirmation | Server `index.ts:218`; no client fetch found | `{ isPublished: bool }` | Updated map | `isPublished` is set through `/schedule` endpoint in practice; this route may be unused |
| 9 | Maps — save schedule | PATCH | `/api/maps/:id/schedule` | Active | `useMapEditorState.ts:2673` | `{ scheduledStartAt?, scheduledEndAt?, isPublished? }` | Updated map with schedule fields | SidebarEventPanel "Save Schedule" button; also sets isPublished |
| 10 | Maps — floor names | PATCH | `/api/maps/:id/floor-names` | Active | `useMapEditorState.ts:441` | `{ floorNames: Record<string,string> }` | (not read) | Fire-and-forget |
| 11 | Maps — create section | POST | `/api/maps/:id/sections` | Active | `useMapEditorState.ts:1821,1893,2242,2313,2404` | `{ name, label, sectionType, polygonPath, floor?, notes? }` | `{ id, name, label }` | Used for all section types (seated, GA, table, venue object, text) |
| 12 | Maps — list zones | GET | `/api/maps/:id/zones` | Needs developer confirmation | Server `index.ts:897`; no client fetch found | — | `[{ id, name, color }]` | Zones are bundled in `GET /api/maps/:id`; this standalone route may be unused |
| 13 | Maps — create zone | POST | `/api/maps/:id/zones` | Active | `useMapEditorState.ts:2491` | `{ name, color }` | `{ id }` | ZonesPanel new zone form |
| 14 | Maps — batch assign seat zones | POST | `/api/maps/:id/seats/batch-zone` | Active | `useMapEditorState.ts:2510` | `{ seatIds: string[], zoneId: string\|null }` | (not read) | Per-seat zone override (stored in seat.notes JSON) |
| 15 | Maps — merge sections | POST | `/api/maps/:id/merge` | Active | `useMapEditorState.ts:2207` | `{ sectionIds: string[] }` | Merged section with rows + seats | Multi-select merge |
| 16 | Maps — analyze PSD | POST | `/api/maps/:id/analyze-psd` | Active | `useMapEditorState.ts:2572` | `FormData` (file) | `{ sections: ImportPreviewSection[], warnings: string[] }` | Proxied to Python analyzer service |
| 17 | Maps — analyze DXF/DWG | POST | `/api/maps/:id/analyze-dxf` | Active | `useMapEditorState.ts:2572` | `FormData` (file) | `{ sections, warnings }` | Proxied to Python analyzer service |
| 18 | Maps — analyze image | POST | `/api/maps/:id/analyze-image` | Active | `useMapEditorState.ts:2572` | `FormData` (file) | `{ sections, warnings }` | Proxied to Python analyzer service |
| 19 | Maps — import sections | POST | `/api/maps/:id/import-sections` | Active | `useMapEditorState.ts:2600` | `{ sections: ImportPreviewSection[] }` | `res.ok` only | After user confirms import preview; triggers full map reload |
| 20 | Maps — create hold | POST | `/api/maps/:id/holds` | Active | `useMapEditorState.ts:2524` | `{ name, color }` | `{ id }` | SidebarHoldsTab |
| 21 | Sections — update | PATCH | `/api/sections/:id` | Active | `useMapEditorState.ts:504,668,695,1344,1355,1365,1391,1515,1524,1544,1573,1812,1876,2009,2038,2105,2447` | `{ polygonPath?, name?, label?, sectionType?, notes?, floor? }` | (not read) | Generic section update; used for polygon drag, label/icon offsets, type changes |
| 22 | Sections — delete | DELETE | `/api/sections/:id` | Active | `useMapEditorState.ts:1596,2120` | — | (not read) | Single section delete |
| 23 | Sections — rotate | PATCH | `/api/sections/:id/rotate` | Active | `useMapEditorState.ts:1300,1344,1355,1365,1376,1415` | `{ polygonPath, seats?: [{id,x,y}], notes? }` | (not read) | Persists polygon + seat positions after rotation drag |
| 24 | Sections — move | PATCH | `/api/sections/:id/move` | Active | `useMapEditorState.ts:1601` | `{ dx, dy }` | (not read) | Bulk translate section by delta |
| 25 | Sections — split | POST | `/api/sections/:id/split` | Active | `useMapEditorState.ts:2147` | `{ seatIds: string[] }` | `res.ok` only | Triggers full map reload after split |
| 26 | Sections — create single row | POST | `/api/sections/:id/rows` | Needs developer confirmation | Server `index.ts:765`; no client fetch found | `{ label, startX, startY, seats: [{seatNumber,x,y}] }` | Row with id and seats | Client always uses batch version; this single-row endpoint may be unused |
| 27 | Sections — batch create rows | POST | `/api/sections/:id/rows/batch` | Active | `useMapEditorState.ts:1552,1856,1916,2252,2344,2413,2455` | `{ rows: [{ label, startX, startY, curve?, skew?, seats: [{seatNumber,x,y}] }] }` | `[{ id, label, curve, skew, seats: [{id,x,y,seatNumber}] }]` | Hot path — used for generate rows, table chairs, paste, seated section init |
| 28 | Sections — batch delete | DELETE | `/api/sections/batch` | Active | `useMapEditorState.ts:487,2131` | `{ sectionIds: string[] }` | (not read) | Used in undo/redo cleanup and multi-select delete |
| 29 | Sections — batch delete seats | DELETE | `/api/sections/:id/seats/batch` | Active | `useMapEditorState.ts:2057` | `{ seatIds: string[] }` | (not read) | Multi-seat delete within a section |
| 30 | Sections — rows transform | PATCH | `/api/sections/:id/rows/transform` | Active | `useMapEditorState.ts:2004` | `{ curve, skew }` | (not read) | Global curve/skew applied to all rows at once via `updateMany` |
| 31 | Sections — batch update seat positions | PATCH | `/api/sections/:id/seats/positions` | Active | `useMapEditorState.ts:1458,2033,2094,2480` | `{ updates: [{id,x,y}] }` | (not read) | Used after drag, bake transforms, fill gaps, table chair reposition |
| 32 | Sections — assign zone | PUT | `/api/sections/:id/zone` | Active | `useMapEditorState.ts:1816,1826,2112,2322` | `{ zoneId: string }` | (not read) | Assigns pricing zone to entire section |
| 33 | Seats — update | PATCH | `/api/seats/:id` | Active | `useMapEditorState.ts:1944` | `{ seatNumber, shape }` | (not read) | Rename seat or change shape (circle, square, triangle, chair, wheelchair) |
| 34 | Seats — delete | DELETE | `/api/seats/:id` | Active | `useMapEditorState.ts:2047,2054` | — | (not read) | Individual seat delete |
| 35 | Rows — update | PATCH | `/api/rows/:id` | Active | `useMapEditorState.ts:1383,1963,1986,2004,2009` | `{ label?, curve?, skew? }` | (not read) | Update row label or curvature/skew |
| 36 | Rows — delete | DELETE | `/api/rows/:id` | Active | `useMapEditorState.ts:1551,2454` | — | (not read) | Used when recreating table chairs or adjusting table dimensions |
| 37 | Zones — delete | DELETE | `/api/zones/:id` | Active | `useMapEditorState.ts:2500` | — | (not read) | Delete pricing zone |
| 38 | Holds — update | PATCH | `/api/holds/:id` | Active | `SidebarHoldsTab.tsx:28` | `{ name, color }` | (not read) | Edit hold name/color from holds tab |
| 39 | Holds — delete | DELETE | `/api/holds/:id` | Active | `useMapEditorState.ts:2532` | — | (not read) | Delete hold |
| 40 | Holds — assign seats | PUT | `/api/holds/:id/seats` | Active | `useMapEditorState.ts:2537` | `{ seatIds: string[] }` | Hold with updated seats array | Overwrites entire seat list for the hold |
| 41 | Inventory — seat status | GET | `/api/events/:id/inventory` | Active | `SeatMap.tsx:383,394,396` | — | `Record<seatId, "AVAILABLE"\|"HELD"\|"RESERVED"\|"SOLD"\|"BLOCKED">` | Loaded on mount; also re-fetched on `seat:stale` and `holds:expired` WS events |
| 42 | Venues — list | GET | `/api/venues` | Needs developer confirmation | Server `index.ts:114`; no client fetch found | — | `[{ id, name }]` | May be used by a separate admin tool or not yet wired to UI |
| 43 | Venues — create | POST | `/api/venues` | Needs developer confirmation | Server `index.ts:117`; no client fetch found | `{ name }` | `{ id, name }` | May be used by a separate admin tool or not yet wired to UI |
| 44 | Dev — mark sold | POST | `/api/dev/events/:id/mark-sold` | Active (dev only) | `SeatMap.tsx:1110` | `{ seatIds: string[] }` | `res.ok` | Dev/test button in customer view; should be removed or guarded before production |

---

## WebSocket Events (Socket.IO)

Connection: `VITE_API_URL || "http://localhost:3001"` — auth: `{ auth: { sessionId } }` (UUID from sessionStorage)

| Direction | Event | Payload | Trigger | Handler |
|---|---|---|---|---|
| Client → Server | `event:join` | `eventId` | SeatMap mount | Joins event room for real-time seat updates |
| Client → Server | `event:leave` | `eventId` | SeatMap unmount | Leaves event room; socket disconnects |
| Client → Server | `seat:hold` | `{ eventId, seatId }` | User clicks available seat | Callback: `{ ok: boolean }` |
| Client → Server | `seat:release` | `{ eventId, seatId }` | User deselects seat or unmount | Fire-and-forget |
| Server → Client | `seat:update` | `{ seatId, status }` | Any seat state change | Patches single seat in local inventory state |
| Server → Client | `seat:stale` | `{ sessionId }` | Session dropped | Triggers full `GET /api/events/:id/inventory` refetch |
| Server → Client | `holds:expired` | `{ count }` | Server batch expiry sweep (30s) | Triggers full `GET /api/events/:id/inventory` refetch |

---

## Feature Details

### 1. Customer Seat Map (public)

**Flow:** App auto-detects first published event → `GET /api/events/:id/active-map` → renders `<SeatMap mapId={id} eventId={id} sessionId={uuid}>`.

- `GET /api/maps/:id` — load map geometry (sections, rows, seats, zones, holds)
- `GET /api/events/:id/inventory` — load seat availability snapshot
- Socket.IO: `event:join` → `seat:update` / `seat:stale` / `holds:expired` → optional inventory refetch
- `seat:hold` — customer clicks seat to lock it for 8 minutes
- `seat:release` — customer deselects or navigates away

Response fields the UI depends on: `sections[].rows[].seats[].id`, `seat.x/y`, `seat.seatNumber`, `seat.notes` (JSON with `z` for zoneId, `s` for shape), `pricingZones[].id/color`, `mapHolds[].seats[].id`, `svgViewBox`, `floorNames`.

### 2. Admin Map Editor

**Entry:** `?token=<jwt>` → `GET /api/auth/verify` → event selector → map slot tabs → `<MapEditor mapId={id}>`.

- `GET /api/maps/:id` — load full map on mount
- `POST /api/maps/:id/sections` → `POST /api/sections/:id/rows/batch` — create section + populate rows
- `PATCH /api/sections/:id/seats/positions` — persist seat drag (debounced, batched)
- `PATCH /api/sections/:id/rows/transform` — global curve/skew
- `POST /api/sections/:id/split` + `GET /api/maps/:id` — split section then re-fetch
- `POST /api/maps/:id/merge` — merge selected sections
- `PATCH /api/sections/:id/move` + `PATCH /api/sections/:id/rotate` — translate/rotate
- `DELETE /api/sections/batch` + `PATCH /api/sections/:id` — undo/redo sync
- `PATCH /api/maps/:id/floor-names` — floor label management
- `PATCH /api/maps/:id/schedule` — publish toggle + schedule window

### 3. Pricing Zones

- `POST /api/maps/:id/zones` — create zone
- `DELETE /api/zones/:id` — delete zone
- `PUT /api/sections/:id/zone` — assign zone to section
- `POST /api/maps/:id/seats/batch-zone` — per-seat zone override

### 4. Holds Management

- `POST /api/maps/:id/holds` — create hold
- `PATCH /api/holds/:id` — rename/recolor hold
- `PUT /api/holds/:id/seats` — assign seats to hold (full overwrite)
- `DELETE /api/holds/:id` — delete hold

### 5. File Import (PSD / DXF / Image)

Sequential flow:
1. `POST /api/maps/:id/analyze-{psd|dxf|image}` — upload file → server proxies to Python analyzer → returns `{ sections, warnings }`
2. User confirms in ImportModal
3. `POST /api/maps/:id/import-sections` — save analyzed sections
4. `GET /api/maps/:id` — reload map to show new sections

### 6. Event & Map Management (Admin)

- `GET /api/events` — load event list
- `POST /api/events` — create event
- `GET /api/events/:id/active-map` — resolve customer view map
- `POST /api/events/:id/maps` — create new map slot (max 3)

---

## Needs Developer Confirmation

- [ ] `POST /api/auth/token` — Is this endpoint called by any client? It appears only in a code comment in `SidebarEventPanel.tsx` and is registered on the server, but no `fetch()` call to it was found in the client. Is it used by an external system or admin tool to generate share links?
- [ ] `PATCH /api/maps/:id/publish` — Is this route still needed? In practice `isPublished` is set via `PATCH /api/maps/:id/schedule`. No client fetch call to `/publish` was found. Can it be removed?
- [ ] `GET /api/maps/:id/zones` — Is this route used? Zone data is already bundled in `GET /api/maps/:id`. No standalone call to this endpoint was found in the client.
- [ ] `POST /api/sections/:id/rows` (single row) — Is this route used? The client exclusively calls `/rows/batch`. Can this route be consolidated or removed?
- [ ] `GET /api/venues` — Is this endpoint wired to any UI? No client fetch found. Used by a separate admin dashboard or external tool?
- [ ] `POST /api/venues` — Same question as above — no client fetch found.

---

## Deprecated / Unreachable Candidates

None confirmed at this time. The six endpoints in "Needs Developer Confirmation" are server-implemented but unreferenced in the client — they may be intentional (external tools, future UI) or dead code.

---

## Backend Migration Notes

### Response shape assumptions (strict field naming)

The frontend destructures these fields by exact name — renaming them on the backend will break the UI silently:

| Resource | Fields the client depends on |
|---|---|
| Map | `svgViewBox`, `bgImageUrl`, `floorNames`, `mapSlot`, `isPublished`, `scheduledStartAt`, `scheduledEndAt`, `event.name` |
| Section | `id`, `name`, `label`, `sectionType`, `polygonPath`, `floor`, `notes` (JSON string with `s`/`z` keys) |
| Row | `id`, `label`, `curve`, `skew`, `seats` |
| Seat | `id`, `x`, `y`, `seatNumber`, `notes` (JSON string — `{"s":"shape","z":"zoneId"}`) |
| PricingZone | `id`, `name`, `color` |
| MapHold | `id`, `name`, `color`, `seats[].id` |
| Inventory | Flat `Record<seatId, SeatStatus>` — not a nested object |

### Performance-sensitive / hot paths

- `PATCH /api/sections/:id/seats/positions` — called on every seat drag release; can carry hundreds of `{id,x,y}` pairs. Must be O(1) round trips, not N+1.
- `POST /api/sections/:id/rows/batch` — called on every row generation, paste, and table resize.
- `GET /api/events/:id/inventory` — called on mount and on every `seat:stale` / `holds:expired` Socket.IO event. Response must be fast; compact format (`Record<id,status>`) is already in place.
- `GET /api/maps/:id` — called on mount and after split/import operations; payload can be large for complex maps.

### Socket.IO concurrency gap

`seat:hold` should use a Prisma transaction with `WHERE status = AVAILABLE` to prevent race conditions. Currently the upsert is not atomic, which means two concurrent hold requests for the same seat could both succeed.

### Notes field as embedded JSON

`seat.notes` and `section.notes` are plain `TEXT` columns storing JSON strings. The client encodes/decodes them manually. Migration should preserve the exact string encoding or update all client read paths.

### Dev endpoint in production build

`POST /api/dev/events/:id/mark-sold` is registered unconditionally in `index.ts:989` and is reachable in production. It should be gated behind a `NODE_ENV === 'development'` check before shipping.

### Nested objects the UI expects from GET /api/maps/:id

```
{
  id, mapSlot, isPublished, svgViewBox, bgImageUrl, floorNames,
  scheduledStartAt, scheduledEndAt,
  event: { name },
  sections: [{
    id, name, label, sectionType, polygonPath, floor, notes,
    rows: [{
      id, label, curve, skew,
      seats: [{ id, x, y, seatNumber, notes }]
    }]
  }],
  pricingZones: [{ id, name, color, sortOrder }],
  mapHolds: [{ id, name, color, seats: [{ id }] }]
}
```
