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
      getSearchText={(customer) => [customer.name, customer.status, customer.email, customer.phone].filter(Boolean).join(" ")}
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
            <p className="text-sm text-muted-foreground">{customer.email ?? "Sin email"}</p>
            <p className="text-sm text-muted-foreground">{customer.phone ?? "Sin teléfono"}</p>
          </div>
          <CustomerRowActions id={customer.id} name={customer.name} />
        </div>
      )}
    />
  );
}
