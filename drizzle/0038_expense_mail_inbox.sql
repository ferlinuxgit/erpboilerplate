CREATE TABLE "expense_mail_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"tenantId" text NOT NULL,
	"configuredByUserId" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 993 NOT NULL,
	"secure" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"passwordEncrypted" text NOT NULL,
	"mailbox" text DEFAULT 'INBOX' NOT NULL,
	"processedMailbox" text,
	"allowedSenders" text DEFAULT '' NOT NULL,
	"uidValidity" text,
	"lastUid" integer,
	"lastCheckedAt" timestamp with time zone,
	"lastSuccessAt" timestamp with time zone,
	"lastError" text,
	"lastImportedCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_mail_inbox_company_unique" UNIQUE("companyId")
);
--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "sourceFrom" text;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "sourceSubject" text;--> statement-breakpoint
ALTER TABLE "expense_ocr_job" ADD COLUMN "sourceMessageId" text;--> statement-breakpoint
ALTER TABLE "expense_mail_inbox" ADD CONSTRAINT "expense_mail_inbox_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_mail_inbox" ADD CONSTRAINT "expense_mail_inbox_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_mail_inbox" ADD CONSTRAINT "expense_mail_inbox_configuredByUserId_user_id_fk" FOREIGN KEY ("configuredByUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_ocr_job_source_message_idx" ON "expense_ocr_job" USING btree ("companyId","sourceMessageId");