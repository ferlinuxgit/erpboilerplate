"use client";

import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";

export type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  itemCount: number;
  quantity: number;
  canManage: boolean;
  isActive: boolean;
};

function formatQuantity(value: number) {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

function WarehouseActions({ row }: { row: WarehouseRow }) {
  if (!row.canManage) {
    return (
      <Link
        className={buttonVariants({ variant: "outline", size: "sm" })}
        href={`/inventory/warehouses/${row.id}`}
      >
        Ver
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Link
        className={buttonVariants({ variant: "outline", size: "sm" })}
        href={`/inventory/warehouses/${row.id}/edit`}
      >
        Editar
      </Link>
      {row.isActive ? (
        <DeleteButton
          description="El almacén dejará de estar disponible para nuevas operaciones. Sus existencias y movimientos se conservarán."
          label="Archivar"
          successMessage="Almacén archivado; el histórico se conserva."
          title={`Archivar ${row.name}`}
          url={`/api/warehouses/${row.id}`}
        />
      ) : null}
    </div>
  );
}

const columns: ResourceListColumn<WarehouseRow>[] = [
  {
    header: "Almacén",
    alwaysVisible: true,
    cell: (row) => (
      <Link
        className="font-medium underline-offset-4 hover:underline"
        href={`/inventory/warehouses/${row.id}`}
      >
        {row.name}
        <span className="block font-mono text-xs text-muted-foreground">
          {row.code}
        </span>
      </Link>
    ),
    exportValue: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    header: "Estado",
    cell: (row) => <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Activo" : "Archivado"}</StatusBadge>,
    exportValue: (row) => row.isActive ? "Activo" : "Archivado",
    sortValue: (row) => row.isActive ? 1 : 0,
  },
  {
    header: "Referencias",
    cell: (row) => row.itemCount,
    exportValue: (row) => row.itemCount,
    sortValue: (row) => row.itemCount,
    className: "text-right tabular-nums",
  },
  {
    header: "Unidades",
    cell: (row) => <span className="font-mono">{formatQuantity(row.quantity)}</span>,
    exportValue: (row) => row.quantity,
    sortValue: (row) => row.quantity,
    className: "text-right tabular-nums",
  },
  {
    header: "Acciones",
    cell: (row) => <WarehouseActions row={row} />,
    className: "text-right",
  },
];

export function WarehousesList({ rows }: { rows: WarehouseRow[] }) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Crea una ubicación para comenzar a registrar existencias."
      emptyTitle="No hay almacenes"
      exportFileName="almacenes.csv"
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: [
            { value: "ACTIVE", label: "Activos" },
            { value: "ARCHIVED", label: "Archivados" },
          ],
          getValue: (row) => (row.isActive ? "ACTIVE" : "ARCHIVED"),
        },
      ]}
      getRowId={(row) => row.id}
      getRowLabel={(row) => `${row.code} · ${row.name}`}
      getSearchText={(row) => `${row.code} ${row.name} ${row.isActive ? "activo" : "archivado"}`}
      items={rows}
      renderMobileCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link className="font-medium underline-offset-4 hover:underline" href={`/inventory/warehouses/${row.id}`}>
                {row.name}
              </Link>
              <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
            </div>
            <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Activo" : "Archivado"}</StatusBadge>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Referencias</dt>
            <dd className="tabular-nums">{row.itemCount}</dd>
            <dt className="text-muted-foreground">Unidades</dt>
            <dd className="font-mono tabular-nums">{formatQuantity(row.quantity)}</dd>
          </dl>
          <WarehouseActions row={row} />
        </div>
      )}
      searchPlaceholder="Buscar almacén por código o nombre"
      testId="warehouses-list"
      title="Almacenes"
    />
  );
}
