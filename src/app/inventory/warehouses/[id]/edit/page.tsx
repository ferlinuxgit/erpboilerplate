import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { warehouse } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("stock.write");
    const { id } = await params;
    const [row] = await db
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(and(eq(warehouse.id, id), eq(warehouse.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Editar almacén ${row.name}` : "Editar almacén" };
  } catch {
    return { title: "Editar almacén" };
  }
}

export default async function EditWarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("stock.write");
  const { id } = await params;
  const [record] = await db.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();

  return (
    <PageShell>
      <PageHeader
        title={`Editar ${record.name}`}
        description={record.code}
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Almacenes", href: "/inventory/warehouses" },
          { label: record.name, href: `/inventory/warehouses/${record.id}` },
          { label: "Editar" },
        ]}
      />
      <PageSection title="Datos del almacén" description="Los movimientos existentes conservarán la trazabilidad.">
        <WarehouseForm id={record.id} initialValues={{ name: record.name, code: record.code }} />
      </PageSection>
    </PageShell>
  );
}
