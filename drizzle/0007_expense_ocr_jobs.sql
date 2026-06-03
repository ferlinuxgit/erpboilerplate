CREATE TABLE "expense_ocr_job" (
  "id" text PRIMARY KEY NOT NULL,
  "companyId" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "tenantId" text NOT NULL REFERENCES "tenant"("id") ON DELETE cascade,
  "actorUserId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "fileName" text NOT NULL,
  "filePath" text NOT NULL,
  "fileUrl" text,
  "contentType" text NOT NULL,
  "sourceText" text,
  "extractedJson" text,
  "errorMessage" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "startedAt" timestamp with time zone,
  "finishedAt" timestamp with time zone
);

CREATE INDEX "expense_ocr_job_company_status_idx" ON "expense_ocr_job" ("companyId", "status");
CREATE INDEX "expense_ocr_job_actor_created_idx" ON "expense_ocr_job" ("actorUserId", "createdAt");
