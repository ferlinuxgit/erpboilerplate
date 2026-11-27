-- Lote de cumplimiento (auditoría 2026-11-27): inmovilizado, rectificativas de proveedor, foto de los
-- modelos presentados, compensación del 303, límite de la simplificada y entorno de VERI*FACTU.
--
-- VERI*FACTU: cada registro, evento y cabeza de cadena guarda el entorno de la AEAT en el que nació.
-- Los existentes se marcan «test»: hasta esta versión el entorno era una variable global que valía
-- «test» salvo VERIFACTU_ENVIRONMENT=production, y este despliegue nunca la tuvo ni activó el envío
-- (VERIFACTU_TRANSPORT), así que ningún registro ha llegado a la AEAT. El valor va en el DEFAULT del
-- ADD COLUMN (DDL: no dispara el trigger de inmutabilidad) y después es inmutable. Un despliegue
-- que SÍ hubiera enviado a producción debe cambiar aquí 'test' por 'production' antes de migrar.
CREATE TABLE "fixed_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"assetAccountId" text NOT NULL,
	"accumulatedAccountId" text,
	"expenseAccountId" text,
	"acquisitionDate" date NOT NULL,
	"inServiceDate" date NOT NULL,
	"acquisitionCost" numeric(12, 2) NOT NULL,
	"residualValue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"isDepreciable" boolean DEFAULT true NOT NULL,
	"method" text DEFAULT 'percent' NOT NULL,
	"annualPct" numeric(7, 4),
	"usefulLifeYears" numeric(6, 2),
	"taxCoefficientKey" text,
	"depreciationStartDate" date,
	"priorAccumulated" numeric(12, 2) DEFAULT '0' NOT NULL,
	"supplierInvoiceId" text,
	"status" text DEFAULT 'active' NOT NULL,
	"disposalDate" date,
	"disposalType" text,
	"disposalProceeds" numeric(12, 2),
	"disposalAccountId" text,
	"disposalNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_asset_company_code_unique" UNIQUE("companyId","code"),
	CONSTRAINT "fixed_asset_status_valid" CHECK ("fixed_asset"."status" IN ('active', 'fully_depreciated', 'disposed')),
	CONSTRAINT "fixed_asset_method_valid" CHECK ("fixed_asset"."method" IN ('percent', 'years')),
	CONSTRAINT "fixed_asset_amounts_valid" CHECK ("fixed_asset"."acquisitionCost" > 0 AND "fixed_asset"."residualValue" >= 0 AND "fixed_asset"."residualValue" <= "fixed_asset"."acquisitionCost" AND "fixed_asset"."priorAccumulated" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_depreciation" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"assetId" text NOT NULL,
	"periodStart" date NOT NULL,
	"periodEnd" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"journalEntryId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_asset_depreciation_asset_period_unique" UNIQUE("assetId","periodEnd"),
	CONSTRAINT "fixed_asset_depreciation_amount_valid" CHECK ("fixed_asset_depreciation"."amount" > 0 AND "fixed_asset_depreciation"."periodStart" <= "fixed_asset_depreciation"."periodEnd")
);
--> statement-breakpoint
CREATE TABLE "fixed_asset_settings" (
	"companyId" text PRIMARY KEY NOT NULL,
	"depreciationFrequency" text DEFAULT 'annual' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_asset_settings_frequency_valid" CHECK ("fixed_asset_settings"."depreciationFrequency" IN ('monthly', 'annual'))
);
--> statement-breakpoint
ALTER TABLE "verifactu_event" DROP CONSTRAINT "verifactu_event_company_sequence_unique";--> statement-breakpoint
ALTER TABLE "verifactu_record" DROP CONSTRAINT "verifactu_record_company_sequence_unique";--> statement-breakpoint
DROP INDEX "verifactu_record_company_first_unique";--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "vatCompensationOpening" jsonb;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "simplifiedInvoiceLimit" numeric(10, 2) DEFAULT '400' NOT NULL;--> statement-breakpoint
ALTER TABLE "fiscal_report" ADD COLUMN "filedSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "fiscal_report" ADD COLUMN "filedSnapshotAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "documentKind" text DEFAULT 'INVOICE' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "rectifiedInvoiceId" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "rectifiedDocumentNumber" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "rectifiedIssueDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "rectificationReason" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "operationDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "surchargeAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "isSimplified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "importDuaNumber" text;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "importDuaDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "surchargeRate" numeric(6, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "surchargeAmount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "isInvestmentGood" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_certificate" ADD COLUMN "isSeal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD COLUMN "environment" text DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT constraint_name INTO pk_name FROM information_schema.table_constraints
  WHERE table_schema = current_schema() AND table_name = 'verifactu_chain_head' AND constraint_type = 'PRIMARY KEY';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "verifactu_chain_head" DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD CONSTRAINT "verifactu_chain_head_companyId_environment_pk" PRIMARY KEY("companyId","environment");--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD COLUMN "lastSubmissionAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD COLUMN "waitSeconds" integer;--> statement-breakpoint
ALTER TABLE "verifactu_event" ADD COLUMN "environment" text DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_event" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD COLUMN "environment" text DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "verifactu_record" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_assetAccountId_account_chart_id_fk" FOREIGN KEY ("assetAccountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_accumulatedAccountId_account_chart_id_fk" FOREIGN KEY ("accumulatedAccountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_expenseAccountId_account_chart_id_fk" FOREIGN KEY ("expenseAccountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_supplierInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_disposalAccountId_account_chart_id_fk" FOREIGN KEY ("disposalAccountId") REFERENCES "public"."account_chart"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciation" ADD CONSTRAINT "fixed_asset_depreciation_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciation" ADD CONSTRAINT "fixed_asset_depreciation_assetId_fixed_asset_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."fixed_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_depreciation" ADD CONSTRAINT "fixed_asset_depreciation_journalEntryId_journal_entry_id_fk" FOREIGN KEY ("journalEntryId") REFERENCES "public"."journal_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_asset_settings" ADD CONSTRAINT "fixed_asset_settings_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fixed_asset_company_status_idx" ON "fixed_asset" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "fixed_asset_supplier_invoice_idx" ON "fixed_asset" USING btree ("supplierInvoiceId");--> statement-breakpoint
CREATE INDEX "fixed_asset_depreciation_company_period_idx" ON "fixed_asset_depreciation" USING btree ("companyId","periodEnd");--> statement-breakpoint
CREATE INDEX "fixed_asset_depreciation_entry_idx" ON "fixed_asset_depreciation" USING btree ("journalEntryId");--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_rectifiedInvoiceId_supplier_invoice_id_fk" FOREIGN KEY ("rectifiedInvoiceId") REFERENCES "public"."supplier_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_invoice_rectified_invoice_idx" ON "supplier_invoice" USING btree ("rectifiedInvoiceId");--> statement-breakpoint
CREATE UNIQUE INDEX "verifactu_record_company_env_first_unique" ON "verifactu_record" USING btree ("companyId","environment") WHERE "verifactu_record"."previousRecordId" IS NULL;--> statement-breakpoint
ALTER TABLE "verifactu_event" ADD CONSTRAINT "verifactu_event_company_env_sequence_unique" UNIQUE("companyId","environment","sequence");--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_company_env_sequence_unique" UNIQUE("companyId","environment","sequence");--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_simplified_limit_valid" CHECK ("company_settings"."simplifiedInvoiceLimit" BETWEEN 0 AND 3000);--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_document_kind_valid" CHECK ("supplier_invoice"."documentKind" IN ('INVOICE', 'RECTIFICATION'));--> statement-breakpoint
ALTER TABLE "verifactu_chain_head" ADD CONSTRAINT "verifactu_chain_head_environment_valid" CHECK ("verifactu_chain_head"."environment" IN ('production', 'test'));--> statement-breakpoint
ALTER TABLE "verifactu_event" ADD CONSTRAINT "verifactu_event_environment_valid" CHECK ("verifactu_event"."environment" IN ('production', 'test'));--> statement-breakpoint
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_environment_valid" CHECK ("verifactu_record"."environment" IN ('production', 'test'));--> statement-breakpoint
-- La marca de bien de inversión era implícita (cuenta del grupo 2): se conserva en las líneas existentes.
UPDATE "supplier_invoice_line" l SET "isInvestmentGood" = true
FROM "account_chart" a WHERE a."id" = l."expenseAccountId" AND a."code" LIKE '2%';--> statement-breakpoint
-- El modo heredado «no VERI*FACTU» ya no puede generar registros (no llevan firma ni registro de
-- eventos conforme): esas empresas vuelven a «pendiente de activar».
UPDATE "company_settings" SET "verifactuMode" = 'pending', "updatedAt" = now() WHERE "verifactuMode" = 'non_verifactu';
