-- AlterTable
ALTER TABLE "Claims" ADD COLUMN "assignedAt" DATETIME;
ALTER TABLE "Claims" ADD COLUMN "assignedRole" TEXT;
ALTER TABLE "Claims" ADD COLUMN "assignedTo" TEXT;

-- CreateIndex
CREATE INDEX "Claims_assignedTo_Status_idx" ON "Claims"("assignedTo", "Status");
