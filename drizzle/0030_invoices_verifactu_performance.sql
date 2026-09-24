CREATE TABLE "verifactu_chain_head" (
	"companyId" text PRIMARY KEY NOT NULL,
	"lastRecordId" text,
	"lastSequence" integer DEFAULT 0 NOT NULL,
	"lastHash" text,
	"lastEventSequence" integer DEFAULT 0 NOT NULL,
	"lastEventHash" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifactu_event" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"sequence" integer NOT NULL,
	"eventType" text NOT NULL,
	"description" text NOT NULL,
	"payload" jsonb,
	"actorUserId" text,
	"previousHash" text,
	"hash" text NOT NULL,
	"generatedAtText" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifactu_event_company_sequence_unique" UNIQUE("companyId","sequence"),
	CONSTRAINT "verifactu_event_hash_format" CHECK ("verifactu_event"."hash" ~ '^[0-9A-F]{64}$')
);
--> statement-breakpoint
CREATE TABLE "verifactu_record" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"invoiceId" text NOT NULL,
	"recordType" text NOT NULL,
	"mode" text NOT NULL,
	"sequence" integer NOT NULL,
	"issuerTaxId" text NOT NULL,
	"issuerName" text NOT NULL,
	"invoiceNumber" text NOT NULL,
	"invoiceIssueDate" text NOT NULL,
	"invoiceTypeCode" text,
	"rectificationKind" text,
	"rectifiedInvoices" jsonb,
	"description" text,
	"recipient" jsonb,
	"breakdown" jsonb,
	"taxAmount" text,
	"totalAmount" text,
	"previousRecordId" text,
	"previousIssuerTaxId" text,
	"previousInvoiceNumber" text,
	"previousInvoiceIssueDate" text,
	"previousHash" text,
	"hash" text NOT NULL,
	"generatedAtText" text NOT NULL,
	"generatedAt" timestamp with time zone NOT NULL,
	"systemInfo" jsonb NOT NULL,
	"status" text NOT NULL,
	"sendAttempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"lastAttemptAt" timestamp with time zone,
	"sentAt" timestamp with time zone,
	"aeatCsv" text,
	"aeatErrorCode" text,
	"aeatErrorMessage" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verifactu_record_company_sequence_unique" UNIQUE("companyId","sequence"),
	CONSTRAINT "verifactu_record_type_valid" CHECK ("verifactu_record"."recordType" IN ('ALTA', 'ANULACION')),
	CONSTRAINT "verifactu_record_mode_valid" CHECK ("verifactu_record"."mode" IN ('VERIFACTU', 'NO_VERIFACTU')),
	CONSTRAINT "verifactu_record_status_valid" CHECK ("verifactu_record"."status" IN ('PENDING_SEND', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_ERRORS', 'REJECTED', 'NOT_REQUIRED')),
	CONSTRAINT "verifactu_record_hash_format" CHECK ("verifactu_record"."hash" ~ '^[0-9A-F]{64}$'),
	CONSTRAINT "verifactu_record_chain_link" CHECK (("verifactu_record"."sequence" = 1 AND "verifactu_record"."previousRecordId" IS NULL AND "verifactu_record"."previousHash" IS NULL) OR ("verifactu_record"."sequence" > 1 AND "verifactu_record"."previousRecordId" IS NOT NULL AND "verifactu_record"."previousHash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "verifactuSince" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "taxpayerType" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "invoiceType" text DEFAULT 'INVOICE' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "issuedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "rectifiedInvoiceId" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "rectificationReason" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "rectificationType" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "rectificationDescription" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "issuerSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "customerSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD CONSTRAINT "verifactu_chain_head_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD CONSTRAINT "verifactu_chain_head_lastRecordId_verifactu_record_id_fk" FOREIGN KEY ("lastRecordId") REFERENCES "public"."verifactu_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_event" ADD CONSTRAINT "verifactu_event_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_invoiceId_invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_previousRecordId_verifactu_record_id_fk" FOREIGN KEY ("previousRecordId") REFERENCES "public"."verifactu_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifactu_event_company_created_idx" ON "verifactu_event" USING btree ("companyId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "verifactu_record_company_previous_unique" ON "verifactu_record" USING btree ("companyId","previousRecordId") WHERE "verifactu_record"."previousRecordId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "verifactu_record_company_first_unique" ON "verifactu_record" USING btree ("companyId") WHERE "verifactu_record"."previousRecordId" IS NULL;--> statement-breakpoint
CREATE INDEX "verifactu_record_invoice_idx" ON "verifactu_record" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "verifactu_record_status_idx" ON "verifactu_record" USING btree ("status","nextAttemptAt");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_rectifiedInvoiceId_invoice_id_fk" FOREIGN KEY ("rectifiedInvoiceId") REFERENCES "public"."invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenantId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entityName","entityId");--> statement-breakpoint
CREATE INDEX "bank_transaction_account_status_idx" ON "bank_transaction" USING btree ("bankAccountId","reconciliationStatus");--> statement-breakpoint
CREATE INDEX "invoice_company_issue_date_idx" ON "invoice" USING btree ("companyId","issueDate");--> statement-breakpoint
CREATE INDEX "invoice_company_payment_status_idx" ON "invoice" USING btree ("companyId","paymentStatus");--> statement-breakpoint
CREATE INDEX "invoice_rectified_invoice_idx" ON "invoice" USING btree ("rectifiedInvoiceId");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoiceId");--> statement-breakpoint
CREATE INDEX "stock_movement_company_moved_at_idx" ON "stock_movement" USING btree ("companyId","movedAt");--> statement-breakpoint
CREATE INDEX "supplier_invoice_company_issue_date_idx" ON "supplier_invoice" USING btree ("companyId","issueDate");--> statement-breakpoint
-- supplier_invoice_company_payment_status_idx already exists (hand-written in 0004).
CREATE INDEX "supplier_invoice_line_invoice_idx" ON "supplier_invoice_line" USING btree ("supplierInvoiceId");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_type_valid" CHECK ("invoice"."invoiceType" IN ('INVOICE', 'CREDIT_NOTE'));--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_credit_note_link" CHECK ("invoice"."invoiceType" = 'INVOICE' OR "invoice"."rectifiedInvoiceId" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_negative_only_credit_note" CHECK ("invoice"."invoiceType" = 'CREDIT_NOTE' OR "invoice"."totalAmount" >= 0);--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_rectification_reason_valid" CHECK ("invoice"."rectificationReason" IS NULL OR "invoice"."rectificationReason" IN ('R1', 'R2', 'R3', 'R4', 'R5'));--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_rectification_type_valid" CHECK ("invoice"."rectificationType" IS NULL OR "invoice"."rectificationType" IN ('DIFFERENCES', 'SUBSTITUTION'));--> statement-breakpoint
-- Hand-written: VeriFactu immutability triggers (mirrors VERIFACTU_TRIGGERS_SQL in src/server/verifactu/sql.ts).
CREATE OR REPLACE FUNCTION verifactu_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('verifactu.allow_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'VeriFactu: los registros de facturación no se pueden borrar' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'sendAttempts', 'nextAttemptAt', 'lastAttemptAt', 'sentAt', 'aeatCsv', 'aeatErrorCode', 'aeatErrorMessage'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'sendAttempts', 'nextAttemptAt', 'lastAttemptAt', 'sentAt', 'aeatCsv', 'aeatErrorCode', 'aeatErrorMessage']) THEN
    RAISE EXCEPTION 'VeriFactu: el contenido, la huella y el encadenamiento de un registro de facturación son inmutables' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS verifactu_record_immutable ON "verifactu_record";--> statement-breakpoint
CREATE TRIGGER verifactu_record_immutable BEFORE UPDATE OR DELETE ON "verifactu_record"
  FOR EACH ROW EXECUTE FUNCTION verifactu_record_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION verifactu_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('verifactu.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'VeriFactu: el registro de eventos es de solo inserción' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS verifactu_event_immutable ON "verifactu_event";--> statement-breakpoint
CREATE TRIGGER verifactu_event_immutable BEFORE UPDATE OR DELETE ON "verifactu_event"
  FOR EACH ROW EXECUTE FUNCTION verifactu_event_guard();--> statement-breakpoint
-- Hand-written backfill: before the invoice lifecycle existed every invoice was numbered and
-- posted at creation, so numbered invoices are issued ones. Mark them as issued.
UPDATE "invoice" SET "issuedAt" = "createdAt" WHERE "issuedAt" IS NULL AND "number" NOT LIKE 'BORRADOR-%';--> statement-breakpoint
UPDATE "invoice" SET "status" = 'SENT' WHERE "status" = 'DRAFT' AND "number" NOT LIKE 'BORRADOR-%';--> statement-breakpoint
-- Hand-written backfill: intra-EU / reverse-charge supplier invoices are payable at base minus
-- withholding (self-assessed VAT is not owed to the supplier). Only rows whose stored total is
-- exactly base + VAT - withholding and whose payments fit the new total are corrected; the rest
-- need manual review. Journal entries are not rewritten here (see docs/audits).
WITH paid AS (
  SELECT "supplierInvoiceId", SUM("amountApplied") AS paid FROM "supplier_invoice_payment" GROUP BY 1
), c AS (
  SELECT si.id, si."subtotalAmount" - si."retentionAmount" AS new_total, COALESCE(p.paid, 0) AS paid
  FROM "supplier_invoice" si LEFT JOIN paid p ON p."supplierInvoiceId" = si.id
  WHERE si."vatTreatment" IN ('INTRA_EU', 'REVERSE_CHARGE') AND si.status NOT IN ('VOID', 'DRAFT')
    AND si."taxAmount" <> 0 AND si."totalAmount" = si."subtotalAmount" + si."taxAmount" - si."retentionAmount"
    AND COALESCE(p.paid, 0) <= si."subtotalAmount" - si."retentionAmount"
)
UPDATE "supplier_invoice" si SET "totalAmount" = c.new_total, "updatedAt" = now(),
  "paymentStatus" = (CASE WHEN c.paid = 0 THEN CASE WHEN si."paymentStatus" = 'OVERDUE' THEN 'OVERDUE' ELSE 'PENDING' END
                          WHEN c.paid >= c.new_total THEN 'PAID' ELSE 'PARTIAL' END)::payment_status
FROM c WHERE si.id = c.id;--> statement-breakpoint
UPDATE "supplier_invoice_line" l SET "lineTotal" = l."subtotalAmount" - l."retentionAmount"
FROM "supplier_invoice" si WHERE l."supplierInvoiceId" = si.id AND si."vatTreatment" IN ('INTRA_EU', 'REVERSE_CHARGE')
  AND l."taxAmount" <> 0 AND l."lineTotal" = l."subtotalAmount" + l."taxAmount" - l."retentionAmount"
  AND si."totalAmount" = si."subtotalAmount" - si."retentionAmount";