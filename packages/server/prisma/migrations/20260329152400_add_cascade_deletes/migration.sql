-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_mapId_fkey";

-- DropForeignKey
ALTER TABLE "PricingZone" DROP CONSTRAINT "PricingZone_mapId_fkey";

-- DropForeignKey
ALTER TABLE "Row" DROP CONSTRAINT "Row_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "Seat" DROP CONSTRAINT "Seat_rowId_fkey";

-- DropForeignKey
ALTER TABLE "SeatInventory" DROP CONSTRAINT "SeatInventory_eventId_fkey";

-- DropForeignKey
ALTER TABLE "SeatInventory" DROP CONSTRAINT "SeatInventory_seatId_fkey";

-- DropForeignKey
ALTER TABLE "Section" DROP CONSTRAINT "Section_mapId_fkey";

-- DropForeignKey
ALTER TABLE "SectionZoneMapping" DROP CONSTRAINT "SectionZoneMapping_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "SectionZoneMapping" DROP CONSTRAINT "SectionZoneMapping_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "TicketType" DROP CONSTRAINT "TicketType_eventId_fkey";

-- DropForeignKey
ALTER TABLE "TicketType" DROP CONSTRAINT "TicketType_zoneId_fkey";

-- DropForeignKey
ALTER TABLE "VenueMap" DROP CONSTRAINT "VenueMap_venueId_fkey";

-- AddForeignKey
ALTER TABLE "VenueMap" ADD CONSTRAINT "VenueMap_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "VenueMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Row" ADD CONSTRAINT "Row_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "Row"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingZone" ADD CONSTRAINT "PricingZone_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "VenueMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionZoneMapping" ADD CONSTRAINT "SectionZoneMapping_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionZoneMapping" ADD CONSTRAINT "SectionZoneMapping_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "PricingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "VenueMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketType" ADD CONSTRAINT "TicketType_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "PricingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatInventory" ADD CONSTRAINT "SeatInventory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatInventory" ADD CONSTRAINT "SeatInventory_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
