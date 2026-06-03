ALTER TABLE "supplier_invoice" ADD COLUMN "origin" text DEFAULT 'PURCHASE' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "supplierDocumentNumber" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "dueDate" timestamp with time zone;
ALTER TABLE "supplier_invoice" ADD COLUMN "status" text DEFAULT 'POSTED' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "paymentStatus" "payment_status" DEFAULT 'PENDING' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "subtotalAmount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "retentionAmount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "notes" text;
ALTER TABLE "supplier_invoice" ADD COLUMN "createdAt" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "supplier_invoice" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "supplier_invoice_line" ADD COLUMN "expenseAccountId" text REFERENCES "account_chart"("id") ON DELETE set null;
ALTER TABLE "supplier_invoice_line" ADD COLUMN "taxDeductiblePct" numeric(6, 3) DEFAULT '100' NOT NULL;
ALTER TABLE "supplier_invoice_line" ADD COLUMN "retentionRate" numeric(6, 3) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice_line" ADD COLUMN "subtotalAmount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice_line" ADD COLUMN "taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "supplier_invoice_line" ADD COLUMN "retentionAmount" numeric(12, 2) DEFAULT '0' NOT NULL;

UPDATE "supplier_invoice_line"
SET
  "subtotalAmount" = round(("quantity" * "unitPrice")::numeric, 2),
  "taxAmount" = round((("quantity" * "unitPrice" * "taxRate") / 100)::numeric, 2),
  "retentionAmount" = 0;

UPDATE "supplier_invoice"
SET
  "subtotalAmount" = coalesce(lines."subtotalAmount", 0),
  "taxAmount" = coalesce(lines."taxAmount", 0),
  "retentionAmount" = coalesce(lines."retentionAmount", 0)
FROM (
  SELECT
    "supplierInvoiceId",
    round(sum("subtotalAmount")::numeric, 2) AS "subtotalAmount",
    round(sum("taxAmount")::numeric, 2) AS "taxAmount",
    round(sum("retentionAmount")::numeric, 2) AS "retentionAmount"
  FROM "supplier_invoice_line"
  GROUP BY "supplierInvoiceId"
) lines
WHERE "supplier_invoice"."id" = lines."supplierInvoiceId";

CREATE INDEX "supplier_invoice_company_origin_idx" ON "supplier_invoice" ("companyId", "origin");
CREATE INDEX "supplier_invoice_company_payment_status_idx" ON "supplier_invoice" ("companyId", "paymentStatus");
