-- CreateTable
CREATE TABLE "MapHold" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#888888',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldSeat" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,

    CONSTRAINT "HeldSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeldSeat_holdId_seatId_key" ON "HeldSeat"("holdId", "seatId");

-- AddForeignKey
ALTER TABLE "MapHold" ADD CONSTRAINT "MapHold_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "VenueMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSeat" ADD CONSTRAINT "HeldSeat_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "MapHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSeat" ADD CONSTRAINT "HeldSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
