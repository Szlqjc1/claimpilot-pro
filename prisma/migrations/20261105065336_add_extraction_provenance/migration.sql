-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN "extractionSource" TEXT;
ALTER TABLE "AiRun" ADD COLUMN "ocrConfidence" REAL;
ALTER TABLE "AiRun" ADD COLUMN "runDetail" JSONB;

-- AlterTable
ALTER TABLE "Claims" ADD COLUMN "extractionSource" TEXT;
