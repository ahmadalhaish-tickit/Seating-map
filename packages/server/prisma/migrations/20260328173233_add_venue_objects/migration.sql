-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SectionType" ADD VALUE 'STAGE';
ALTER TYPE "SectionType" ADD VALUE 'BAR';
ALTER TYPE "SectionType" ADD VALUE 'BATHROOM';
ALTER TYPE "SectionType" ADD VALUE 'DANCING';
ALTER TYPE "SectionType" ADD VALUE 'PARKING';
ALTER TYPE "SectionType" ADD VALUE 'STAIRS';
ALTER TYPE "SectionType" ADD VALUE 'WALL';
ALTER TYPE "SectionType" ADD VALUE 'DOOR';
ALTER TYPE "SectionType" ADD VALUE 'CHECKIN';
