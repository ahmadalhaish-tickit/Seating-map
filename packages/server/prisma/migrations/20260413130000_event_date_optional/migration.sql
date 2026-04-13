-- Make Event.date optional (was required in the original schema)
ALTER TABLE "Event" ALTER COLUMN "date" DROP NOT NULL;
