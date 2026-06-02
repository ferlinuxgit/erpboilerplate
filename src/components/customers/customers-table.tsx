"use client";

import { CustomerRowActions } from "@/components/customers/customer-row-actions";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";

type CustomerRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  email: string | null;
  phone: string | null;
  taxId: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
};

type CustomersTableProps = {
  rows: CustomerRow[];
};

const columns: ResourceListColumn<CustomerRow>[] = [
  {
    header: "Nombre",
    cell: (customer) => <span className="font-medium">{customer.name}</span>,
    exportValue: (customer) => customer.name,
    sortValue: (customer) => customer.name,
  },
  {
    header: "Estado",
    cell: (customer) => (
      <StatusBadge tone={customer.status === "ACTIVE" ? "success" : "neutral"}>
        {customer.status === "ACTIVE" ? "Activo" : "Inactivo"}
      </StatusBadge>
    ),
    exportValue: (customer) => (customer.status === "ACTIVE" ? "Activo" : "Inactivo"),
    sortValue: (customer) => customer.status,
  },
  {
    header: "CIF/NIF",
    cell: (customer) => customer.taxId ?? "Sin CIF/NIF",
    exportValue: (customer) => customer.taxId ?? "",
    sortValue: (customer) => customer.taxId ?? "",
  },
  {
    header: "Domicilio",
    cell: (customer) => [customer.postalCode, customer.city, customer.province, customer.countryCode].filter(Boolean).join(", ") || "Sin domicilio",
    exportValue: (customer) => [customer.postalCode, customer.city, customer.province, customer.countryCode].filter(Boolean).join(", "),
    sortValue: (customer) => [customer.city, customer.province, customer.countryCode].filter(Boolean).join(" "),
  },
  {
    header: "Email",
    cell: (customer) => customer.email ?? "Sin email",
    exportValue: (customer) => customer.email ?? "",
    sortValue: (customer) => customer.email ?? "",
  },
  {
    header: "Teléfono",
    cell: (customer) => customer.phone ?? "Sin teléfono",
    exportValue: (customer) => customer.phone ?? "",
    sortValue: (customer) => customer.phone ?? "",
  },
  {
    header: "Acciones",
    cell: (customer) => <CustomerRowActions id={customer.id} name={customer.name} />,
    className: "text-right",
  },
];

export function CustomersTable({ rows }: CustomersTableProps) {
  return (
    <ResourceList
      title="Clientes"
      items={rows}
      columns={columns}
      getRowId={(customer) => customer.id}
      getRowTestId={(customer) => `customer-row-${customer.id}`}
      getSearchText={(customer) => [customer.name, customer.status, customer.taxId, customer.city, customer.province, customer.email, customer.phone].filter(Boolean).join(" ")}
      emptyTitle="Todavía no hay clientes registrados."
      emptyDescription="Crea el primer cliente para empezar a emitir facturas."
      exportFileName="clientes.csv"
      searchPlaceholder="Buscar cliente por nombre, email o teléfono"
      testId="customers-table"
      renderMobileCard={(customer) => (
        <div className="space-y-3">
          <div>
            <p className="font-medium">{customer.name}</p>
            <p className="text-sm text-muted-foreground">{customer.status === "ACTIVE" ? "Activo" : "Inactivo"}</p>
            <p className="text-sm text-muted-foreground">{customer.taxId ?? "Sin CIF/NIF"}</p>
            <p className="text-sm text-muted-foreground">
              {[customer.postalCode, customer.city, customer.province, customer.countryCode].filter(Boolean).join(", ") || "Sin domicilio"}
            </p>
            <p className="text-sm text-muted-foreground">{customer.email ?? "Sin email"}</p>
            <p className="text-sm text-muted-foreground">{customer.phone ?? "Sin teléfono"}</p>
          </div>
          <CustomerRowActions id={customer.id} name={customer.name} />
        </div>
      )}
    />
  );
}
