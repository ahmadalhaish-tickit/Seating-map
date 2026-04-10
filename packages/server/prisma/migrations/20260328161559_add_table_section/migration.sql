-- AlterEnum
ALTER TYPE "SectionType" ADD VALUE 'TABLE';

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "notes" TEXT;
