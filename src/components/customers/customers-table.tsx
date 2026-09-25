"use client";

import Link from "next/link";

import { CustomerRowActions } from "@/components/customers/customer-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { countryName } from "@/lib/countries";

type CustomerRow = {
  id: string;
  number: string | null;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  email: string | null;
  phone: string | null;
  taxId: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  hasDocuments?: boolean;
};

type CustomersTableProps = {
  rows: CustomerRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Country filter options (server mode: every country in use, not only this page). */
  countryOptions?: string[];
};

const columns: ResourceListColumn<CustomerRow>[] = [
  {
    header: "N.º cliente",
    alwaysVisible: true,
    cell: (customer) => <span className="font-mono font-medium">{customer.number ?? "Sin número"}</span>,
    exportValue: (customer) => customer.number ?? "",
    sortValue: (customer) => customer.number ?? "",
    sortKey: "number",
  },
  {
    header: "Nombre",
    cell: (customer) => (
      <Link
        className="font-medium underline-offset-4 hover:underline"
        href={`/customers/${customer.id}`}
      >
        {customer.name}
      </Link>
    ),
    exportValue: (customer) => customer.name,
    sortValue: (customer) => customer.name,
    sortKey: "name",
  },
  {
    header: "Estado",
    cell: (customer) => (
      <StatusBadge tone={customer.status === "ACTIVE" ? "success" : "neutral"}>
        {customer.status === "ACTIVE" ? "Activo" : "Inactivo"}
      </StatusBadge>
    ),
    exportValue: (customer) =>
      customer.status === "ACTIVE" ? "Activo" : "Inactivo",
    sortValue: (customer) => customer.status,
    sortKey: "status",
  },
  {
    header: "CIF/NIF",
    cell: (customer) => customer.taxId ?? "Sin CIF/NIF",
    exportValue: (customer) => customer.taxId ?? "",
    sortValue: (customer) => customer.taxId ?? "",
    sortKey: "taxId",
  },
  {
    header: "Domicilio",
    cell: (customer) =>
      [
        customer.postalCode,
        customer.city,
        customer.province,
        customer.countryCode,
      ]
        .filter(Boolean)
        .join(", ") || "Sin domicilio",
    exportValue: (customer) =>
      [
        customer.postalCode,
        customer.city,
        customer.province,
        customer.countryCode,
      ]
        .filter(Boolean)
        .join(", "),
    sortValue: (customer) =>
      [customer.city, customer.province, customer.countryCode]
        .filter(Boolean)
        .join(" "),
    sortKey: "address",
  },
  {
    header: "Email",
    cell: (customer) => customer.email ?? "Sin email",
    exportValue: (customer) => customer.email ?? "",
    sortValue: (customer) => customer.email ?? "",
    sortKey: "email",
  },
  {
    header: "Teléfono",
    cell: (customer) => customer.phone ?? "Sin teléfono",
    exportValue: (customer) => customer.phone ?? "",
    sortValue: (customer) => customer.phone ?? "",
    sortKey: "phone",
  },
  {
    header: "Acciones",
    cell: (customer) => (
      <CustomerRowActions hasDocuments={customer.hasDocuments} id={customer.id} name={customer.name} status={customer.status} />
    ),
    className: "text-right",
  },
];

export function CustomersTable({ rows, server, countryOptions }: CustomersTableProps) {
  const countries =
    countryOptions ??
    [...new Set(rows.map((customer) => customer.countryCode).filter((value): value is string => Boolean(value)))].sort();

  return (
    <ResourceList
      title="Clientes"
      items={rows}
      server={server}
      columns={columns}
      getRowId={(customer) => customer.id}
      getRowTestId={(customer) => `customer-row-${customer.id}`}
      getRowLabel={(customer) => customer.name}
      getSearchText={(customer) =>
        [
          customer.name,
          customer.number,
          customer.status,
          customer.taxId,
          customer.city,
          customer.province,
          customer.email,
          customer.phone,
        ]
          .filter(Boolean)
          .join(" ")
      }
      emptyTitle="Todavía no hay clientes registrados."
      emptyDescription="Crea el primer cliente para empezar a emitir facturas."
      exportFileName="clientes.csv"
      searchPlaceholder="Buscar cliente por número, nombre, CIF/NIF, email o teléfono"
      testId="customers-table"
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: [
            { value: "ACTIVE", label: "Activos" },
            { value: "INACTIVE", label: "Inactivos" },
          ],
          getValue: (customer) => customer.status,
        },
        {
          key: "country",
          label: "País",
          allLabel: "Todos los países",
          options: countries.map((value) => ({ value, label: countryName(value) })),
          getValue: (customer) => customer.countryCode,
        },
      ]}
      renderMobileCard={(customer) => (
        <div className="space-y-3">
          <div>
            <p className="font-mono text-xs text-muted-foreground">{customer.number ?? "Sin número"}</p>
            <Link className="font-medium underline-offset-4 hover:underline" href={`/customers/${customer.id}`}>
              {customer.name}
            </Link>
            <p className="text-sm text-muted-foreground">
              {customer.status === "ACTIVE" ? "Activo" : "Inactivo"}
            </p>
            <p className="text-sm text-muted-foreground">
              {customer.taxId ?? "Sin CIF/NIF"}
            </p>
            <p className="text-sm text-muted-foreground">
              {[
                customer.postalCode,
                customer.city,
                customer.province,
                customer.countryCode,
              ]
                .filter(Boolean)
                .join(", ") || "Sin domicilio"}
            </p>
            <p className="text-sm text-muted-foreground">
              {customer.email ?? "Sin email"}
            </p>
            <p className="text-sm text-muted-foreground">
              {customer.phone ?? "Sin teléfono"}
            </p>
          </div>
          <CustomerRowActions hasDocuments={customer.hasDocuments} id={customer.id} name={customer.name} status={customer.status} />
        </div>
      )}
    />
  );
}
