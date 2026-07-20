"use client";

import Link from "next/link";

import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";

export type InventoryItemRow = {
  id: string;
  sku: string;
  name: string;
  isService: boolean;
  salePrice: string;
  costPrice: string;
  averageCost: string;
  minimumStock: string;
  quantity: number;
  currencyCode: string;
  canManage: boolean;
  isActive: boolean;
};
const columns: ResourceListColumn<InventoryItemRow>[] = [
  {
    header: "Artículo",
    cell: (row) => (
      <Link
        className="font-medium underline-offset-4 hover:underline"
        href={`/inventory/items/${row.id}`}
      >
        {row.name}
        <span className="block font-mono text-xs text-muted-foreground">
          {row.sku}
        </span>
      </Link>
    ),
    exportValue: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    header: "Tipo",
    cell: (row) => (
      <StatusBadge tone={row.isService ? "info" : "neutral"}>
        {row.isService ? "Servicio" : "Producto"}
      </StatusBadge>
    ),
    exportValue: (row) => (row.isService ? "Servicio" : "Producto"),
    sortValue: (row) => (row.isService ? 1 : 0),
  },
  {
    header: "Estado",
    cell: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Activo" : "Archivado"}</StatusBadge>,
    exportValue: (row) => row.isActive ? "Activo" : "Archivado",
    sortValue: (row) => row.isActive ? 1 : 0,
  },
  {
    header: "Stock",
    cell: (row) =>
      row.isService ? (
        "No aplica"
      ) : (
        <span className="font-mono">
          {row.quantity.toLocaleString("es-ES", { maximumFractionDigits: 3 })}
        </span>
      ),
    exportValue: (row) => row.quantity,
    sortValue: (row) => row.quantity,
    className: "text-right",
  },
  {
    header: "Mínimo",
    cell: (row) =>
      row.isService
        ? "No aplica"
        : Number(row.minimumStock).toLocaleString("es-ES"),
    exportValue: (row) => row.minimumStock,
    sortValue: (row) => Number(row.minimumStock),
    className: "text-right",
  },
  {
    header: "Venta",
    cell: (row) => formatMoney(row.salePrice, row.currencyCode),
    exportValue: (row) => row.salePrice,
    sortValue: (row) => Number(row.salePrice),
    className: "text-right",
  },
  {
    header: "Coste medio",
    cell: (row) => formatMoney(row.averageCost, row.currencyCode),
    exportValue: (row) => row.averageCost,
    sortValue: (row) => Number(row.averageCost),
    className: "text-right",
  },
  {
    header: "Acciones",
    cell: (row) =>
      row.canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={`/inventory/items/${row.id}/edit`}
          >
            Editar
          </Link>
          {row.isActive ? <DeleteButton
            description="El artículo dejará de estar disponible para nuevas operaciones. Su histórico y movimientos se conservarán."
            label="Archivar"
            successMessage="Artículo archivado; el histórico se conserva."
            title={`Archivar ${row.name}`}
            url={`/api/items/${row.id}`}
          /> : null}
        </div>
      ) : (
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={`/inventory/items/${row.id}`}
        >
          Ver
        </Link>
      ),
    className: "text-right",
  },
];
export function ItemsList({ rows }: { rows: InventoryItemRow[] }) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Crea el primer producto o servicio para utilizarlo en documentos e inventario."
      emptyTitle="No hay artículos"
      exportFileName="articulos.csv"
      filters={[
        {
          key: "type",
          label: "Tipo",
          allLabel: "Todos los tipos",
          options: [
            { value: "PRODUCT", label: "Productos" },
            { value: "SERVICE", label: "Servicios" },
          ],
          getValue: (row) => (row.isService ? "SERVICE" : "PRODUCT"),
        },
        {
          key: "availability",
          label: "Disponibilidad",
          allLabel: "Todos",
          options: [
            { value: "LOW", label: "Stock bajo" },
            { value: "AVAILABLE", label: "Disponible" },
          ],
          getValue: (row) =>
            row.isService
              ? null
              : row.quantity <= Number(row.minimumStock)
                ? "LOW"
                : "AVAILABLE",
        },
      ]}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${row.sku} ${row.name} ${row.isService ? "servicio" : "producto"}`
      }
      items={rows}
      searchPlaceholder="Buscar por SKU o nombre"
      testId="inventory-items-list"
      title="Artículos"
    />
  );
}
