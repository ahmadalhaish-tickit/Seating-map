-- Migration: events_primary
-- Flips the relationship so Event is the top-level entity and VenueMap belongs to Event.
-- Adds mapSlot + schedule fields to VenueMap.

-- ── Step 1: Add venueId to Event (nullable back-reference to Venue) ─────────
ALTER TABLE "Event" ADD COLUMN "venueId" TEXT;

-- ── Step 2: Add new columns to VenueMap ─────────────────────────────────────
ALTER TABLE "VenueMap" ADD COLUMN "eventId"          TEXT;
ALTER TABLE "VenueMap" ADD COLUMN "mapSlot"          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "VenueMap" ADD COLUMN "scheduledStartAt" TIMESTAMP(3);
ALTER TABLE "VenueMap" ADD COLUMN "scheduledEndAt"   TIMESTAMP(3);

-- ── Step 3: Migrate existing data ───────────────────────────────────────────

-- For each existing Event that has a mapId, point VenueMap.eventId back to that Event
UPDATE "VenueMap" vm
SET "eventId" = e."id"
FROM "Event" e
WHERE e."mapId" = vm."id";

-- Carry venueId from VenueMap → Event (so events keep their venue reference)
UPDATE "Event" e
SET "venueId" = vm."venueId"
FROM "VenueMap" vm
WHERE vm."id" = e."mapId";

-- ── Step 4: Create placeholder Events for VenueMaps that still have no eventId
DO $$
DECLARE
  vm_rec RECORD;
  new_id TEXT;
BEGIN
  FOR vm_rec IN
    SELECT vm.id AS map_id, vm."venueId" AS venue_id, v.name AS venue_name
    FROM   "VenueMap" vm
    JOIN   "Venue"    v  ON v.id = vm."venueId"
    WHERE  vm."eventId" IS NULL
  LOOP
    new_id := gen_random_uuid()::TEXT;
    INSERT INTO "Event" ("id", "name", "date", "isActive", "createdAt", "updatedAt", "venueId")
    VALUES (new_id, vm_rec.venue_name, NOW(), false, NOW(), NOW(), vm_rec.venue_id);
    UPDATE "VenueMap" SET "eventId" = new_id WHERE id = vm_rec.map_id;
  END LOOP;
END $$;

-- ── Step 5: Enforce NOT NULL and add FK on VenueMap.eventId ─────────────────
ALTER TABLE "VenueMap" ALTER COLUMN "eventId" SET NOT NULL;

ALTER TABLE "VenueMap"
  ADD CONSTRAINT "VenueMap_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Step 6: Add FK for Event.venueId ────────────────────────────────────────
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Step 7: Drop old VenueMap.venueId ───────────────────────────────────────
ALTER TABLE "VenueMap" DROP CONSTRAINT "VenueMap_venueId_fkey";
ALTER TABLE "VenueMap" DROP COLUMN "venueId";

-- ── Step 8: Drop old Event.mapId ────────────────────────────────────────────
ALTER TABLE "Event" DROP CONSTRAINT "Event_mapId_fkey";
ALTER TABLE "Event" DROP COLUMN "mapId";
