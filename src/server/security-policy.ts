import { eq } from "drizzle-orm";
import { z } from "zod";

import { tenantSecurityPolicy } from "@/db/schema";
import { db } from "@/lib/db";
import { can, type AppRole } from "@/lib/rbac";
import { recordAudit } from "@/server/audit";

const nullablePositiveInteger = z.preprocess(
  (value) => {
    if (value === "" || value === undefined) return null;
    return value;
  },
  z.number().int().positive().max(525_600).nullable(),
);

const nullableBoolean = z.union([z.boolean(), z.null()]).optional().default(null);
const nullableTrimmedText = z.preprocess(
  (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(2_000).nullable(),
);

export const securityPolicyPayloadSchema = z.object({
  sessionTimeoutMinutes: nullablePositiveInteger.optional().default(null),
  requireTwoFactor: nullableBoolean,
  apiKeyRotationDays: nullablePositiveInteger.optional().default(null),
  allowedDomains: nullableTrimmedText.optional().default(null),
  allowedIpNotes: nullableTrimmedText.optional().default(null),
});

export type SecurityPolicyPayload = z.infer<typeof securityPolicyPayloadSchema>;
export type ControlStatus = "enabled" | "disabled" | "not_configured";

export type TenantSecurityPolicyRecord = {
  id: string;
  tenantId: string;
  sessionTimeoutMinutes: number | null;
  requireTwoFactor: boolean | null;
  apiKeyRotationDays: number | null;
  allowedDomains: string | null;
  allowedIpNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SecurityPolicyChange = {
  field: keyof SecurityPolicyPayload;
  before: SecurityPolicyPayload[keyof SecurityPolicyPayload];
  after: SecurityPolicyPayload[keyof SecurityPolicyPayload];
};

export type SecurityPolicyState = {
  policy: TenantSecurityPolicyRecord | null;
  record: SecurityPolicyPayload;
  controls: Array<{
    key: keyof SecurityPolicyPayload;
    status: ControlStatus;
    value: SecurityPolicyPayload[keyof SecurityPolicyPayload];
    label: string;
    summary: string;
  }>;
};

export type SecurityPolicyStore = {
  findByTenantId(tenantId: string): Promise<TenantSecurityPolicyRecord | null>;
  create(tenantId: string, values: SecurityPolicyPayload): Promise<TenantSecurityPolicyRecord>;
  update(id: string, values: SecurityPolicyPayload): Promise<TenantSecurityPolicyRecord>;
};

export type AuditWriter = (params: {
  tenantId: string;
  companyId?: string;
  actorUserId?: string;
  action: string;
  entityName: string;
  entityId: string;
  payload?: unknown;
}) => Promise<void>;

export const securityPolicyFields: Array<keyof SecurityPolicyPayload> = [
  "sessionTimeoutMinutes",
  "requireTwoFactor",
  "apiKeyRotationDays",
  "allowedDomains",
  "allowedIpNotes",
];

function policyValues(record: TenantSecurityPolicyRecord | null): SecurityPolicyPayload {
  return {
    sessionTimeoutMinutes: record?.sessionTimeoutMinutes ?? null,
    requireTwoFactor: record?.requireTwoFactor ?? null,
    apiKeyRotationDays: record?.apiKeyRotationDays ?? null,
    allowedDomains: record?.allowedDomains ?? null,
    allowedIpNotes: record?.allowedIpNotes ?? null,
  };
}

function numericStatus(value: number | null): ControlStatus {
  return value === null ? "not_configured" : "enabled";
}

function booleanStatus(value: boolean | null): ControlStatus {
  if (value === null) return "not_configured";
  return value ? "enabled" : "disabled";
}

function textStatus(value: string | null): ControlStatus {
  return value ? "enabled" : "not_configured";
}

export function getSecurityPolicyState(record: TenantSecurityPolicyRecord | null): SecurityPolicyState {
  const values = policyValues(record);

  return {
    policy: record,
    record: values,
    controls: [
      {
        key: "sessionTimeoutMinutes",
        status: numericStatus(values.sessionTimeoutMinutes),
        value: values.sessionTimeoutMinutes,
        label: "Session timeout",
        summary: values.sessionTimeoutMinutes ? `${values.sessionTimeoutMinutes} minutes` : "Not configured",
      },
      {
        key: "requireTwoFactor",
        status: booleanStatus(values.requireTwoFactor),
        value: values.requireTwoFactor,
        label: "Two-factor authentication",
        summary: values.requireTwoFactor === null ? "Not configured" : values.requireTwoFactor ? "Required" : "Disabled",
      },
      {
        key: "apiKeyRotationDays",
        status: numericStatus(values.apiKeyRotationDays),
        value: values.apiKeyRotationDays,
        label: "API key rotation",
        summary: values.apiKeyRotationDays ? `Every ${values.apiKeyRotationDays} days` : "Not configured",
      },
      {
        key: "allowedDomains",
        status: textStatus(values.allowedDomains),
        value: values.allowedDomains,
        label: "Allowed domains",
        summary: values.allowedDomains ?? "Not configured",
      },
      {
        key: "allowedIpNotes",
        status: textStatus(values.allowedIpNotes),
        value: values.allowedIpNotes,
        label: "Allowed IP policy",
        summary: values.allowedIpNotes ?? "Not configured",
      },
    ],
  };
}

export function describePolicyChanges(
  before: TenantSecurityPolicyRecord | null,
  after: TenantSecurityPolicyRecord | SecurityPolicyPayload,
): SecurityPolicyChange[] {
  const beforeValues = policyValues(before);
  const afterValues = "id" in after ? policyValues(after) : after;

  return securityPolicyFields.flatMap((field) => {
    if (beforeValues[field] === afterValues[field]) return [];
    return [{ field, before: beforeValues[field], after: afterValues[field] }];
  });
}

export const drizzleSecurityPolicyStore: SecurityPolicyStore = {
  async findByTenantId(tenantId) {
    const [record] = await db
      .select()
      .from(tenantSecurityPolicy)
      .where(eq(tenantSecurityPolicy.tenantId, tenantId))
      .limit(1);
    return record ?? null;
  },

  async create(tenantId, values) {
    const [created] = await db
      .insert(tenantSecurityPolicy)
      .values({ tenantId, ...values })
      .returning();
    if (!created) throw new Error("No se pudo crear la política de seguridad.");
    return created;
  },

  async update(id, values) {
    const [updated] = await db
      .update(tenantSecurityPolicy)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(tenantSecurityPolicy.id, id))
      .returning();
    if (!updated) throw new Error("No se pudo actualizar la política de seguridad.");
    return updated;
  },
};

export async function getTenantSecurityPolicyState(
  tenantId: string,
  store: SecurityPolicyStore = drizzleSecurityPolicyStore,
): Promise<SecurityPolicyState> {
  return getSecurityPolicyState(await store.findByTenantId(tenantId));
}

export async function updateTenantSecurityPolicy(params: {
  actorUserId: string;
  role: AppRole;
  tenantId: string;
  companyId?: string;
  payload: unknown;
  store?: SecurityPolicyStore;
  audit?: AuditWriter;
}): Promise<{ status: 200 | 201 | 403; policy?: SecurityPolicyState; changes?: SecurityPolicyChange[]; error?: string }> {
  if (!can(params.role, "settings.manage")) {
    return { status: 403, error: "Sin permisos para cambiar la política de seguridad." };
  }

  const values = securityPolicyPayloadSchema.parse(params.payload);
  const store = params.store ?? drizzleSecurityPolicyStore;
  const audit = params.audit ?? recordAudit;
  const existing = await store.findByTenantId(params.tenantId);
  const changes = describePolicyChanges(existing, values);
  const saved = existing ? await store.update(existing.id, values) : await store.create(params.tenantId, values);

  if (changes.length > 0) {
    await audit({
      tenantId: params.tenantId,
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      action: existing ? "security_policy.updated" : "security_policy.created",
      entityName: "tenant_security_policy",
      entityId: saved.id,
      payload: {
        changes,
        before: policyValues(existing),
        after: policyValues(saved),
      },
    });
  }

  return { status: existing ? 200 : 201, policy: getSecurityPolicyState(saved), changes };
}
