-- Payment facts kept after account deletion. No public key and no invoice.
CREATE TABLE "RetainedFinancialRecord" (
    "id" TEXT NOT NULL,
    "retainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentCreatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetainedFinancialRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetainedFinancialRecord_paymentId_key" ON "RetainedFinancialRecord"("paymentId");
CREATE INDEX "RetainedFinancialRecord_retainedAt_idx" ON "RetainedFinancialRecord"("retainedAt");
