import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ItemForm } from "@/components/inventory/item-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { item } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("stock.write");
    const { id } = await params;
    const [row] = await db
      .select({ name: item.name })
      .from(item)
      .where(and(eq(item.id, id), eq(item.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Editar artículo ${row.name}` : "Editar artículo" };
  } catch {
    return { title: "Editar artículo" };
  }
}

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("stock.write");
  const { id } = await params;
  const [record] = await db.select().from(item).where(and(eq(item.id, id), eq(item.companyId, ctx.company.id))).limit(1);
  if (!record) notFound();

  return (
    <PageShell>
      <PageHeader
        title={`Editar ${record.name}`}
        description={record.sku}
        breadcrumbs={[
          { label: "Inventario", href: "/inventory" },
          { label: "Artículos", href: "/inventory/items" },
          { label: record.name, href: `/inventory/items/${record.id}` },
          { label: "Editar" },
        ]}
      />
      <PageSection title="Datos del artículo" description="Actualiza precios y parámetros sin perder su historial.">
        <ItemForm
          id={record.id}
          initialValues={{
            name: record.name,
            sku: record.sku,
            isService: record.isService,
            salePrice: record.salePrice,
            costPrice: record.costPrice,
            minimumStock: record.minimumStock,
          }}
        />
      </PageSection>
    </PageShell>
  );
}
