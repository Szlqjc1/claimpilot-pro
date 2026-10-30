-- CreateTable
CREATE TABLE "Claims" (
    "Claim_ID" TEXT NOT NULL PRIMARY KEY,
    "Employee" TEXT NOT NULL,
    "Department" TEXT NOT NULL,
    "Project_Code" TEXT,
    "Category" TEXT NOT NULL,
    "Amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "Status" TEXT NOT NULL DEFAULT 'Pending',
    "Original_Receipt" TEXT NOT NULL,
    "AI_Analyzed_Receipt" TEXT,
    "Extracted_Data" TEXT,
    "vendorId" TEXT,
    "vendorName" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "poNumber" TEXT,
    "grnNumber" TEXT,
    "receiptHash" TEXT,
    "receiptMime" TEXT,
    "receiptName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "submittedAt" DATETIME NOT NULL,
    "analyzedAt" DATETIME,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "decision" TEXT,
    "ocrText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claims_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("vendorId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claims_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder" ("poNumber") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claims_Project_Code_fkey" FOREIGN KEY ("Project_Code") REFERENCES "Project" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Exceptions" (
    "Exception_ID" TEXT NOT NULL PRIMARY KEY,
    "Claim_ID" TEXT NOT NULL,
    "Anomaly_Type" TEXT NOT NULL,
    "Risk_Level" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exceptions_Claim_ID_fkey" FOREIGN KEY ("Claim_ID") REFERENCES "Claims" ("Claim_ID") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "Log_ID" TEXT NOT NULL PRIMARY KEY,
    "Timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Actor" TEXT NOT NULL,
    "Action" TEXT NOT NULL,
    "Details" TEXT NOT NULL,
    "Claim_ID" TEXT,
    "metadata" TEXT,
    CONSTRAINT "AuditLog_Claim_ID_fkey" FOREIGN KEY ("Claim_ID") REFERENCES "Claims" ("Claim_ID") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "department" TEXT NOT NULL,
    "title" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Vendor" (
    "vendorId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "w9OnFile" BOOLEAN NOT NULL,
    "w9ExpiresAt" DATETIME,
    "insuranceExpiresAt" DATETIME,
    "paymentTerms" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountLast4" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "poNumber" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "consumedAmount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costType" TEXT NOT NULL DEFAULT 'Expense',
    "issuedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("vendorId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "grnNumber" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT NOT NULL,
    "gatePassNumber" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL,
    "plant" TEXT NOT NULL,
    CONSTRAINT "GoodsReceipt_poNumber_fkey" FOREIGN KEY ("poNumber") REFERENCES "PurchaseOrder" ("poNumber") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "budget" DECIMAL NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "customerProgram" TEXT NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Policy" (
    "category" TEXT NOT NULL PRIMARY KEY,
    "perClaimLimit" DECIMAL NOT NULL,
    "requiresPo" BOOLEAN NOT NULL,
    "requiresGrn" BOOLEAN NOT NULL,
    "requiresProjectCode" BOOLEAN NOT NULL,
    "approvalThreshold" DECIMAL NOT NULL,
    "notes" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "itemCode" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "p50" DECIMAL NOT NULL,
    "p90" DECIMAL NOT NULL,
    "effectiveDate" DATETIME NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "confidence" REAL,
    "warnings" TEXT,
    "narrative" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestKey" TEXT,
    "responseJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRun_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claims" ("Claim_ID") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Claims_Status_submittedAt_idx" ON "Claims"("Status", "submittedAt");

-- CreateIndex
CREATE INDEX "Claims_Department_Category_idx" ON "Claims"("Department", "Category");

-- CreateIndex
CREATE INDEX "Claims_Project_Code_idx" ON "Claims"("Project_Code");

-- CreateIndex
CREATE INDEX "Claims_vendorName_invoiceNumber_idx" ON "Claims"("vendorName", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Exceptions_Claim_ID_status_idx" ON "Exceptions"("Claim_ID", "status");

-- CreateIndex
CREATE INDEX "Exceptions_Anomaly_Type_Risk_Level_idx" ON "Exceptions"("Anomaly_Type", "Risk_Level");

-- CreateIndex
CREATE UNIQUE INDEX "Exceptions_Claim_ID_ruleId_key" ON "Exceptions"("Claim_ID", "ruleId");

-- CreateIndex
CREATE INDEX "AuditLog_Claim_ID_Timestamp_idx" ON "AuditLog"("Claim_ID", "Timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_Timestamp_idx" ON "AuditLog"("Timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "GoodsReceipt_poNumber_idx" ON "GoodsReceipt"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_idempotencyKey_key" ON "AiRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_requestKey_key" ON "AiRun"("requestKey");

-- CreateIndex
CREATE INDEX "AiRun_claimId_idx" ON "AiRun"("claimId");
