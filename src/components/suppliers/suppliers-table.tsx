"use client";

import { SupplierRowActions } from "@/components/suppliers/supplier-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";

type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  isActive: boolean;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
};

type SuppliersTableProps = {
  rows: SupplierRow[];
};

const columns: ResourceListColumn<SupplierRow>[] = [
  {
    header: "Nombre",
    cell: (supplier) => <span className="font-medium">{supplier.name}</span>,
    exportValue: (supplier) => supplier.name,
    sortValue: (supplier) => supplier.name,
  },
  {
    header: "Estado",
    cell: (supplier) => (
      <StatusBadge tone={supplier.isActive ? "success" : "neutral"}>
        {supplier.isActive ? "Activo" : "Inactivo"}
      </StatusBadge>
    ),
    exportValue: (supplier) => (supplier.isActive ? "Activo" : "Inactivo"),
    sortValue: (supplier) => (supplier.isActive ? "ACTIVE" : "INACTIVE"),
  },
  {
    header: "Tipo",
    cell: (supplier) => supplier.type === "BOTH" ? "Cliente y proveedor" : "Proveedor",
    exportValue: (supplier) => supplier.type,
    sortValue: (supplier) => supplier.type,
  },
  {
    header: "CIF/NIF",
    cell: (supplier) => supplier.taxId ?? "Sin CIF/NIF",
    exportValue: (supplier) => supplier.taxId ?? "",
    sortValue: (supplier) => supplier.taxId ?? "",
  },
  {
    header: "Domicilio",
    cell: (supplier) => [supplier.postalCode, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(", ") || "Sin domicilio",
    exportValue: (supplier) => [supplier.postalCode, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(", "),
    sortValue: (supplier) => [supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(" "),
  },
  {
    header: "Email",
    cell: (supplier) => supplier.email ?? "Sin email",
    exportValue: (supplier) => supplier.email ?? "",
    sortValue: (supplier) => supplier.email ?? "",
  },
  {
    header: "Teléfono",
    cell: (supplier) => supplier.phone ?? "Sin teléfono",
    exportValue: (supplier) => supplier.phone ?? "",
    sortValue: (supplier) => supplier.phone ?? "",
  },
  {
    header: "Acciones",
    cell: (supplier) => <SupplierRowActions id={supplier.id} name={supplier.name} />,
    className: "text-right",
  },
];

export function SuppliersTable({ rows }: SuppliersTableProps) {
  return (
    <ResourceList
      title="Proveedores"
      items={rows}
      columns={columns}
      getRowId={(supplier) => supplier.id}
      getRowTestId={(supplier) => `supplier-row-${supplier.id}`}
      getSearchText={(supplier) => [supplier.name, supplier.isActive ? "Activo" : "Inactivo", supplier.taxId, supplier.city, supplier.province, supplier.email, supplier.phone].filter(Boolean).join(" ")}
      emptyTitle="Todavía no hay proveedores registrados."
      emptyDescription="Crea el primer proveedor para registrar gastos, compras y facturas recibidas."
      exportFileName="proveedores.csv"
      searchPlaceholder="Buscar proveedor por nombre, CIF/NIF, email o teléfono"
      testId="suppliers-table"
      renderMobileCard={(supplier) => (
        <div className="space-y-3">
          <div>
            <p className="font-medium">{supplier.name}</p>
            <p className="text-sm text-muted-foreground">{supplier.isActive ? "Activo" : "Inactivo"}</p>
            <p className="text-sm text-muted-foreground">{supplier.taxId ?? "Sin CIF/NIF"}</p>
            <p className="text-sm text-muted-foreground">
              {[supplier.postalCode, supplier.city, supplier.province, supplier.countryCode].filter(Boolean).join(", ") || "Sin domicilio"}
            </p>
            <p className="text-sm text-muted-foreground">{supplier.email ?? "Sin email"}</p>
            <p className="text-sm text-muted-foreground">{supplier.phone ?? "Sin teléfono"}</p>
          </div>
          <SupplierRowActions id={supplier.id} name={supplier.name} />
        </div>
      )}
    />
  );
}
