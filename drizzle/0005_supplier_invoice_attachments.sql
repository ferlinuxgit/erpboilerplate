CREATE TABLE "supplier_invoice_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "supplierInvoiceId" text NOT NULL REFERENCES "supplier_invoice"("id") ON DELETE cascade,
  "companyId" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "fileName" text NOT NULL,
  "fileUrl" text NOT NULL,
  "storageKey" text,
  "contentType" text,
  "sizeBytes" integer,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "supplier_invoice_attachment_invoice_idx" ON "supplier_invoice_attachment" ("supplierInvoiceId");
