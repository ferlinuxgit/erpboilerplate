UPDATE "partner" SET "number" = 'TMP24P' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", "type", row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS sequence_number
  FROM "partner"
)
UPDATE "partner" AS target
SET "number" = CASE ranked."type"
  WHEN 'CUSTOMER' THEN 'CL'
  WHEN 'SUPPLIER' THEN 'PR'
  ELSE 'TE'
END || lpad(ranked.sequence_number::text, 6, '0')
FROM ranked
WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "sales_quote" SET "number" = 'TMP24Q' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "issueDate", "createdAt", "id") AS sequence_number
  FROM "sales_quote"
)
UPDATE "sales_quote" AS target SET "number" = 'PRV' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "sales_order" SET "number" = 'TMP24SO' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "issueDate", "createdAt", "id") AS sequence_number
  FROM "sales_order"
)
UPDATE "sales_order" AS target SET "number" = 'PE' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "delivery_note" SET "number" = 'TMP24D' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "issuedAt", "createdAt", "id") AS sequence_number
  FROM "delivery_note"
)
UPDATE "delivery_note" AS target SET "number" = 'AL' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "invoice" SET "number" = 'TMP24I' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "issueDate", "createdAt", "id") AS sequence_number
  FROM "invoice"
)
UPDATE "invoice" AS target SET "number" = 'FA' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "purchase_order" SET "number" = 'TMP24PO' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS sequence_number
  FROM "purchase_order"
)
UPDATE "purchase_order" AS target SET "number" = 'PC' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "goods_receipt" SET "number" = 'TMP24R' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "receivedAt", "id") AS sequence_number
  FROM "goods_receipt"
)
UPDATE "goods_receipt" AS target SET "number" = 'RE' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "supplier_invoice" SET "number" = 'TMP24SI' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "issueDate", "createdAt", "id") AS sequence_number
  FROM "supplier_invoice"
)
UPDATE "supplier_invoice" AS target SET "number" = 'FP' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "payment" SET "number" = 'TMP24C' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "createdAt", "id") AS sequence_number
  FROM "payment"
)
UPDATE "payment" AS target SET "number" = 'CO' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "supplier_payment" SET "number" = 'TMP24SP' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "createdAt", "id") AS sequence_number
  FROM "supplier_payment"
)
UPDATE "supplier_payment" AS target SET "number" = 'PA' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "journal_entry" SET "number" = 'TMP24J' || "id";
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "companyId" ORDER BY "postedAt", "id") AS sequence_number
  FROM "journal_entry"
)
UPDATE "journal_entry" AS target SET "number" = 'AS' || lpad(ranked.sequence_number::text, 6, '0') FROM ranked WHERE target."id" = ranked."id";
--> statement-breakpoint
UPDATE "document_series"
SET
  "prefix" = CASE "type"
    WHEN 'SALES_QUOTE' THEN 'PRV'
    WHEN 'SALES_ORDER' THEN 'PE'
    WHEN 'DELIVERY_NOTE' THEN 'AL'
    WHEN 'SALES_INVOICE' THEN 'FA'
    WHEN 'CREDIT_NOTE' THEN 'AB'
    WHEN 'PURCHASE_ORDER' THEN 'PC'
    WHEN 'GOODS_RECEIPT' THEN 'RE'
    WHEN 'SUPPLIER_INVOICE' THEN 'FP'
    WHEN 'SUPPLIER_CREDIT_NOTE' THEN 'AP'
    WHEN 'PAYMENT' THEN 'PA'
    WHEN 'RECEIPT' THEN 'CO'
  END,
  "format" = '{PREFIX}{NUMBER:6}';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "sales_quote" WHERE "companyId" = series."companyId") WHERE series."type" = 'SALES_QUOTE';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "sales_order" WHERE "companyId" = series."companyId") WHERE series."type" = 'SALES_ORDER';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "delivery_note" WHERE "companyId" = series."companyId") WHERE series."type" = 'DELIVERY_NOTE';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "invoice" WHERE "companyId" = series."companyId") WHERE series."type" = 'SALES_INVOICE';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "purchase_order" WHERE "companyId" = series."companyId") WHERE series."type" = 'PURCHASE_ORDER';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "goods_receipt" WHERE "companyId" = series."companyId") WHERE series."type" = 'GOODS_RECEIPT';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "supplier_invoice" WHERE "companyId" = series."companyId") WHERE series."type" = 'SUPPLIER_INVOICE';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "supplier_payment" WHERE "companyId" = series."companyId") WHERE series."type" = 'PAYMENT';
--> statement-breakpoint
UPDATE "document_series" AS series SET "nextNumber" = (SELECT count(*) + 1 FROM "payment" WHERE "companyId" = series."companyId") WHERE series."type" = 'RECEIPT';
--> statement-breakpoint
UPDATE "partner_number_sequence" AS sequence SET "nextNumber" = (SELECT count(*) + 1 FROM "partner" WHERE "companyId" = sequence."companyId");
--> statement-breakpoint
UPDATE "journal_entry_number_sequence" AS sequence SET "nextNumber" = (SELECT count(*) + 1 FROM "journal_entry" WHERE "companyId" = sequence."companyId");
