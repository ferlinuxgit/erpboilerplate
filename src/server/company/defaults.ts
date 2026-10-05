import { and, eq, inArray } from "drizzle-orm";

import { accountChart, companySettings, documentSeries, journal, tax } from "@/db/schema";
import { db } from "@/lib/db";
import { getCompanyTemplate, type CompanyTemplate } from "@/lib/company-templates";
import { HttpError } from "@/lib/http";
import { applyCompanyTemplate } from "@/server/seeds/apply";
import { taxSignatureKey } from "@/server/taxes/duplicates";

type SetupItem = {
  key: string;
  label: string;
  description: string;
  created: boolean;
};

type SetupGroup = {
  key: "settings" | "accounts" | "journals" | "taxes" | "series";
  label: string;
  description: string;
  items: SetupItem[];
  missingCount: number;
  totalCount: number;
};

type DocumentSeriesType = (typeof documentSeries.$inferSelect)["type"];

export type CompanyDefaultsStatus = {
  countryCode: string;
  preset: CompanyTemplate["id"] | "UNSUPPORTED";
  label: string;
  ready: boolean;
  missingCount: number;
  totalCount: number;
  groups: SetupGroup[];
};

function buildGroup(input: Omit<SetupGroup, "missingCount" | "totalCount">): SetupGroup {
  const missingCount = input.items.filter((item) => !item.created).length;
  return {
    ...input,
    missingCount,
    totalCount: input.items.length,
  };
}

export async function getCompanyDefaultsStatus(input: {
  companyId: string;
  fiscalYearId: string;
  countryCode: string;
}): Promise<CompanyDefaultsStatus> {
  const template = getCompanyTemplate(input.countryCode);
  if (!template) {
    return {
      countryCode: input.countryCode,
      preset: "UNSUPPORTED",
      label: "Sin plantilla automatica",
      ready: true,
      missingCount: 0,
      totalCount: 0,
      groups: [],
    };
  }

  const accountCodes = template.accounts.map((account) => account.code);
  const journalCodes = template.journals.map((entry) => entry.code);
  const seriesTypes = template.documentSeries.map((entry) => entry.type);

  const [settingsRows, accountRows, journalRows, taxRows, seriesRows] = await Promise.all([
    db
      .select({ id: companySettings.id })
      .from(companySettings)
      .where(eq(companySettings.companyId, input.companyId))
      .limit(1),
    db
      .select({ code: accountChart.code })
      .from(accountChart)
      .where(and(eq(accountChart.companyId, input.companyId), inArray(accountChart.code, accountCodes))),
    db
      .select({ code: journal.code })
      .from(journal)
      .where(and(eq(journal.companyId, input.companyId), inArray(journal.code, journalCodes))),
    db
      .select({ name: tax.name, kind: tax.kind, rate: tax.rate, operation: tax.operation })
      .from(tax)
      .where(and(eq(tax.companyId, input.companyId), eq(tax.isActive, true))),
    db
      .select({ type: documentSeries.type })
      .from(documentSeries)
      .where(
        and(
          eq(documentSeries.companyId, input.companyId),
          eq(documentSeries.fiscalYearId, input.fiscalYearId),
          inArray(documentSeries.type, seriesTypes),
        ),
      ),
  ]);

  const existingAccounts = new Set(accountRows.map((entry) => entry.code));
  const existingJournals = new Set(journalRows.map((entry) => entry.code));
  // Un impuesto de la plantilla está si la empresa lo tiene con ese nombre o con otro («IVA» vale
  // por «IVA general 21%»): mismo tipo, porcentaje y operación.
  const existingTaxNames = new Set(taxRows.map((entry) => entry.name));
  const existingTaxSignatures = new Set(taxRows.map((entry) => taxSignatureKey(entry)));
  const hasTemplateTax = (entry: CompanyTemplate["taxes"][number]) => {
    const kind = entry.kind ?? "VAT";
    return existingTaxNames.has(entry.name) || existingTaxSignatures.has(taxSignatureKey({ kind, rate: entry.rate, operation: entry.operation ?? (kind === "WITHHOLDING" ? "SUBTRACT" : "ADD") }));
  };
  const hasActiveVat = taxRows.some((entry) => entry.kind === "VAT");
  const existingSeries = new Set(seriesRows.map((entry) => entry.type));

  const groups = [
    buildGroup({
      key: "settings",
      label: "Ajustes de empresa",
      description: "Preferencias fiscales y cuentas por defecto.",
      items: [
        {
          key: "company-settings",
          label: "Ajustes contables basicos",
          description: "Cuentas por defecto, regimen fiscal y periodicidad.",
          created: settingsRows.length > 0,
        },
      ],
    }),
    buildGroup({
      key: "accounts",
      label: "Cuentas contables",
      description: "Plan General Contable completo con cuentas postables y cuentas de agrupación.",
      items: template.accounts.map((account) => ({
        key: account.code,
        label: `${account.code} - ${account.name}`,
        description: account.role ?? "Cuenta contable predefinida.",
        created: existingAccounts.has(account.code),
      })),
    }),
    buildGroup({
      key: "journals",
      label: "Diarios",
      description: "Libros operativos para asientos automaticos y manuales.",
      items: template.journals.map((entry) => ({
        key: entry.code,
        label: `${entry.code} - ${entry.name}`,
        description: entry.role ?? "Diario predefinido.",
        created: existingJournals.has(entry.code),
      })),
    }),
    buildGroup({
      key: "taxes",
      label: "Impuestos",
      description: "Impuestos habituales de la plantilla seleccionada.",
      items: template.taxes.map((entry) => ({
        key: entry.name,
        label: entry.name,
        description: `Tipo ${Number(entry.rate).toLocaleString("es-ES", { maximumFractionDigits: 3 })}%`,
        created: hasTemplateTax(entry),
      })),
    }),
    buildGroup({
      key: "series",
      label: "Series documentales",
      description: "Numeradores iniciales para ventas, compras, pagos y cobros.",
      items: template.documentSeries.map((entry) => ({
        key: entry.type,
        label: documentTypeLabels[entry.type] ?? entry.type,
        description: `Prefijo recomendado ${entry.prefix}`,
        created: existingSeries.has(entry.type),
      })),
    }),
  ];

  const missingCount = groups.reduce((total, group) => total + group.missingCount, 0);
  const totalCount = groups.reduce((total, group) => total + group.totalCount, 0);
  // Los impuestos de la plantilla son sugerencias: la empresa puede renombrarlos o borrar los que no
  // usa (IVA 4 %, recargos…) sin que se vuelvan a crear. Para emitir basta con un IVA activo.
  const blockingMissing = groups.filter((group) => group.key !== "taxes").reduce((total, group) => total + group.missingCount, 0);

  return {
    countryCode: input.countryCode,
    preset: template.id,
    label: template.label,
    ready: blockingMissing === 0 && hasActiveVat,
    missingCount,
    totalCount,
    groups,
  };
}

export async function applyCompanyDefaults(input: {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  countryCode: string;
  actorUserId: string;
}) {
  if (!getCompanyTemplate(input.countryCode)) {
    throw new HttpError(400, "No hay una plantilla automatica disponible para este pais.");
  }

  await applyCompanyTemplate({
    tenantId: input.tenantId,
    companyId: input.companyId,
    activeFiscalYearId: input.fiscalYearId,
    countryCode: input.countryCode,
    actorUserId: input.actorUserId,
    auditAction: "company.defaults.repair",
  });

  return getCompanyDefaultsStatus(input);
}

const documentTypeLabels: Record<DocumentSeriesType, string> = {
  SALES_QUOTE: "Presupuestos",
  SALES_ORDER: "Pedidos de venta",
  DELIVERY_NOTE: "Albaranes",
  SALES_INVOICE: "Facturas emitidas",
  CREDIT_NOTE: "Abonos",
  PURCHASE_ORDER: "Pedidos de compra",
  GOODS_RECEIPT: "Recepciones",
  SUPPLIER_INVOICE: "Facturas recibidas",
  SUPPLIER_CREDIT_NOTE: "Abonos de proveedor",
  PAYMENT: "Pagos",
  RECEIPT: "Cobros",
};
