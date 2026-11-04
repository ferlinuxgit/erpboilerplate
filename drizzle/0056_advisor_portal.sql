CREATE TABLE "advisor_access" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"companyId" text NOT NULL,
	"name" text NOT NULL,
	"firm" text,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credentialsChangedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"lastLoginAt" timestamp with time zone,
	"lastLoginIp" text,
	"createdByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisor_access_company_email_unique" UNIQUE("companyId","email")
);
--> statement-breakpoint
CREATE TABLE "advisor_session" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenHash" text NOT NULL,
	"email" text NOT NULL,
	"accessIds" jsonb NOT NULL,
	"activeAccessId" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisor_session_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "advisor_access" ADD CONSTRAINT "advisor_access_tenantId_tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_access" ADD CONSTRAINT "advisor_access_companyId_company_id_fk" FOREIGN KEY ("companyId") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_access" ADD CONSTRAINT "advisor_access_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_session" ADD CONSTRAINT "advisor_session_activeAccessId_advisor_access_id_fk" FOREIGN KEY ("activeAccessId") REFERENCES "public"."advisor_access"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisor_access_email_idx" ON "advisor_access" USING btree ("email");--> statement-breakpoint
CREATE INDEX "advisor_session_expires_idx" ON "advisor_session" USING btree ("expiresAt");