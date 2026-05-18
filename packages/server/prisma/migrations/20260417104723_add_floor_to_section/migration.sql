-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "floor" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VenueMap" ADD COLUMN     "floorNames" TEXT;
