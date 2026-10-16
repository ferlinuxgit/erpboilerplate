CREATE TABLE "crm_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"opportunityId" text,
	"customerId" text,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"notes" text,
	"dueAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"assignedUserId" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activity_type_valid" CHECK ("crm_activity"."type" IN ('CALL', 'EMAIL', 'MEETING', 'TASK', 'NOTE'))
);
--> statement-breakpoint
CREATE TABLE "crm_opportunity" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"title" text NOT NULL,
	"customerId" text,
	"contactName" text,
	"contactEmail" text,
	"contactPhone" text,
	"stageId" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"expectedCloseDate" timestamp with time zone,
	"ownerUserId" text,
	"source" text,
	"notes" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"lostReason" text,
	"closedAt" timestamp with time zone,
	"salesQuoteId" text,
	"position" integer DEFAULT 0 NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunity_status_valid" CHECK ("crm_opportunity"."status" IN ('OPEN', 'WON', 'LOST')),
	CONSTRAINT "crm_opportunity_amount_valid" CHECK ("crm_opportunity"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'OPEN' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_stage_company_name_unique" UNIQUE("companyId","name"),
	CONSTRAINT "crm_stage_kind_valid" CHECK ("crm_stage"."kind" IN ('OPEN', 'WON', 'LOST')),
	CONSTRAINT "crm_stage_probability_valid" CHECK ("crm_stage"."probability" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_opportunityId_crm_opportunity_id_fk" FOREIGN KEY ("opportunityId") REFERENCES "public"."crm_opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_assignedUserId_user_id_fk" FOREIGN KEY ("assignedUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_customerId_customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_stageId_crm_stage_id_fk" FOREIGN KEY ("stageId") REFERENCES "public"."crm_stage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_ownerUserId_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_salesQuoteId_sales_quote_id_fk" FOREIGN KEY ("salesQuoteId") REFERENCES "public"."sales_quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity" ADD CONSTRAINT "crm_opportunity_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage" ADD CONSTRAINT "crm_stage_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activity_company_pending_idx" ON "crm_activity" USING btree ("companyId","completedAt","dueAt");--> statement-breakpoint
CREATE INDEX "crm_activity_opportunity_idx" ON "crm_activity" USING btree ("opportunityId");--> statement-breakpoint
CREATE INDEX "crm_activity_customer_idx" ON "crm_activity" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "crm_opportunity_company_stage_idx" ON "crm_opportunity" USING btree ("companyId","stageId","position");--> statement-breakpoint
CREATE INDEX "crm_opportunity_company_status_idx" ON "crm_opportunity" USING btree ("companyId","status");--> statement-breakpoint
CREATE INDEX "crm_opportunity_customer_idx" ON "crm_opportunity" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "crm_stage_company_position_idx" ON "crm_stage" USING btree ("companyId","position");