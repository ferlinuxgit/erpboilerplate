import { ItemForm } from "@/components/inventory/item-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
export default async function NewItemPage() { await requireContext("stock.write"); return <PageShell><PageHeader eyebrow="Inventario · Artículos" title="Nuevo artículo" description="Crea un producto con stock o un servicio facturable." backHref="/inventory/items" backLabel="Volver a artículos" /><PageSection title="Datos del artículo" description="El SKU identifica el artículo en documentos, movimientos e informes."><ItemForm /></PageSection></PageShell>; }
