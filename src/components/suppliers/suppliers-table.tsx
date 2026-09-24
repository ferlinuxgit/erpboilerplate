"use client";

import Link from "next/link";

import { SupplierRowActions } from "@/components/suppliers/supplier-row-actions";
import {
  ResourceList,
  type ResourceListColumn,
  type ServerListState,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";

type SupplierRow = {
  id: string;
  number: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  currencyCode: string;
  outstandingBalance: string;
  creditBalance: string;
  isActive: boolean;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
};

type SupplierTotals = {
  outstandingBalance: number;
  /** Null when the filtered suppliers use more than one currency. */
  currencyCode: string | null;
};

type SuppliersTableProps = {
  rows: SupplierRow[];
  /** Server pagination state; `rows` is then only the current page. */
  server?: ServerListState;
  /** Footer totals over every filtered supplier (server mode). */
  totals?: SupplierTotals;
};

const buildColumns = (totals?: SupplierTotals): ResourceListColumn<SupplierRow>[] => [
  {
    header: "N.º proveedor",
    alwaysVisible: true,
    cell: (supplier) => <span className="font-mono font-medium">{supplier.number}</span>,
    exportValue: (supplier) => supplier.number,
    sortValue: (supplier) => supplier.number,
    sortKey: "number",
  },
  {
    header: "Nombre",
    cell: (supplier) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/suppliers/${supplier.id}`}>
        {supplier.name}
      </Link>
    ),
    exportValue: (supplier) => supplier.name,
    sortValue: (supplier) => supplier.name,
    sortKey: "name",
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
    sortKey: "status",
  },
  {
    header: "Saldo pendiente",
    cell: (supplier) => (
      <div className="text-right">
        <p className="font-mono font-semibold">{formatMoney(supplier.outstandingBalance, supplier.currencyCode)}</p>
        {Number(supplier.creditBalance) > 0 ? (
          <p className="text-xs text-success">A favor: {formatMoney(supplier.creditBalance, supplier.currencyCode)}</p>
        ) : null}
      </div>
    ),
    exportValue: (supplier) => Number(supplier.outstandingBalance),
    sortValue: (supplier) => Number(supplier.outstandingBalance),
    sortKey: "outstanding",
    summary: (rows) => {
      if (totals) {
        return totals.currencyCode ? formatMoney(totals.outstandingBalance, totals.currencyCode) : "Varias divisas";
      }
      const currencies = new Set(rows.map((supplier) => supplier.currencyCode));
      if (currencies.size > 1) return "Varias divisas";
      const cents = rows.reduce((total, supplier) => total + Math.round(Number(supplier.outstandingBalance) * 100), 0);
      return formatMoney(cents / 100, rows[0]?.currencyCode ?? "EUR");
    },
    className: "text-right",
  },
  {
    header: "Tipo",
    cell: (supplier) =>
      supplier.type === "BOTH" ? "Cliente y proveedor" : "Proveedor",
    exportValue: (supplier) =>
      supplier.type === "BOTH" ? "Cliente y proveedor" : "Proveedor",
    sortValue: (supplier) => supplier.type,
    sortKey: "type",
  },
  {
    header: "CIF/NIF",
    cell: (supplier) => supplier.taxId ?? "Sin CIF/NIF",
    exportValue: (supplier) => supplier.taxId ?? "",
    sortValue: (supplier) => supplier.taxId ?? "",
    sortKey: "taxId",
  },
  {
    header: "Domicilio",
    cell: (supplier) =>
      [
        supplier.postalCode,
        supplier.city,
        supplier.province,
        supplier.countryCode,
      ]
        .filter(Boolean)
        .join(", ") || "Sin domicilio",
    exportValue: (supplier) =>
      [
        supplier.postalCode,
        supplier.city,
        supplier.province,
        supplier.countryCode,
      ]
        .filter(Boolean)
        .join(", "),
    sortValue: (supplier) =>
      [supplier.city, supplier.province, supplier.countryCode]
        .filter(Boolean)
        .join(" "),
    sortKey: "address",
  },
  {
    header: "Email",
    cell: (supplier) => supplier.email ?? "Sin email",
    exportValue: (supplier) => supplier.email ?? "",
    sortValue: (supplier) => supplier.email ?? "",
    sortKey: "email",
  },
  {
    header: "Teléfono",
    cell: (supplier) => supplier.phone ?? "Sin teléfono",
    exportValue: (supplier) => supplier.phone ?? "",
    sortValue: (supplier) => supplier.phone ?? "",
    sortKey: "phone",
  },
  {
    header: "Acciones",
    cell: (supplier) => (
      <SupplierRowActions currencyCode={supplier.currencyCode} id={supplier.id} name={supplier.name} outstandingBalance={Number(supplier.outstandingBalance)} />
    ),
    className: "text-right",
  },
];

export function SuppliersTable({ rows, server, totals }: SuppliersTableProps) {
  return (
    <ResourceList
      title="Proveedores"
      items={rows}
      server={server}
      columns={buildColumns(totals)}
      getRowId={(supplier) => supplier.id}
      getRowTestId={(supplier) => `supplier-row-${supplier.id}`}
      getRowLabel={(supplier) => supplier.name}
      summaryLabel="Total pendiente"
      getSearchText={(supplier) =>
        [
          supplier.name,
          supplier.number,
          supplier.isActive ? "Activo" : "Inactivo",
          supplier.taxId,
          supplier.city,
          supplier.province,
          supplier.email,
          supplier.phone,
          supplier.outstandingBalance,
          supplier.creditBalance,
        ]
          .filter(Boolean)
          .join(" ")
      }
      emptyTitle="Todavía no hay proveedores registrados."
      emptyDescription="Crea el primer proveedor para registrar gastos, compras y facturas recibidas."
      exportFileName="proveedores.csv"
      searchPlaceholder="Buscar proveedor por número, nombre, CIF/NIF, email o teléfono"
      testId="suppliers-table"
      filters={[
        {
          key: "status",
          label: "Estado",
          allLabel: "Todos los estados",
          options: [
            { value: "ACTIVE", label: "Activos" },
            { value: "INACTIVE", label: "Inactivos" },
          ],
          getValue: (supplier) => (supplier.isActive ? "ACTIVE" : "INACTIVE"),
        },
        {
          key: "type",
          label: "Tipo",
          allLabel: "Todos los tipos",
          options: [
            { value: "SUPPLIER", label: "Proveedor" },
            { value: "BOTH", label: "Cliente y proveedor" },
          ],
          getValue: (supplier) => supplier.type,
        },
      ]}
      renderMobileCard={(supplier) => (
        <div className="space-y-3">
          <div>
            <p className="font-mono text-xs text-muted-foreground">{supplier.number}</p>
            <Link className="font-medium underline-offset-4 hover:underline" href={`/suppliers/${supplier.id}`}>
              {supplier.name}
            </Link>
            <p className="text-sm text-muted-foreground">
              {supplier.isActive ? "Activo" : "Inactivo"}
            </p>
            <p className="font-mono text-sm font-semibold">
              Pendiente: {formatMoney(supplier.outstandingBalance, supplier.currencyCode)}
            </p>
            {Number(supplier.creditBalance) > 0 ? (
              <p className="text-sm text-success">A favor: {formatMoney(supplier.creditBalance, supplier.currencyCode)}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {supplier.taxId ?? "Sin CIF/NIF"}
            </p>
            <p className="text-sm text-muted-foreground">
              {[
                supplier.postalCode,
                supplier.city,
                supplier.province,
                supplier.countryCode,
              ]
                .filter(Boolean)
                .join(", ") || "Sin domicilio"}
            </p>
            <p className="text-sm text-muted-foreground">
              {supplier.email ?? "Sin email"}
            </p>
            <p className="text-sm text-muted-foreground">
              {supplier.phone ?? "Sin teléfono"}
            </p>
          </div>
          <SupplierRowActions currencyCode={supplier.currencyCode} id={supplier.id} name={supplier.name} outstandingBalance={Number(supplier.outstandingBalance)} />
        </div>
      )}
    />
  );
}
