import {
  Bank,
  BookOpenText,
  BracketsCurly,
  Buildings,
  Calculator,
  ChartLineUp,
  ClipboardText,
  Coins,
  CreditCard,
  Factory,
  FileArrowDown,
  FileText,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  SquaresFour,
  Truck,
  UserCircleGear,
  UsersThree,
} from "@phosphor-icons/react";

export const navGroups = [
  {
    code: "00",
    label: "Inicio",
    links: [{ href: "/dashboard", label: "Panel", code: "01", icon: SquaresFour }],
  },
  {
    code: "10",
    label: "Comercial",
    links: [
      { href: "/customers", label: "Clientes", code: "10", icon: UsersThree },
      { href: "/sales/quotes", label: "Presupuestos", code: "11", icon: FileText },
      { href: "/sales/orders", label: "Pedidos", code: "12", icon: ShoppingCart },
      { href: "/sales/delivery-notes", label: "Albaranes", code: "13", icon: Truck },
      { href: "/invoices", label: "Facturas", code: "14", icon: Receipt },
    ],
  },
  {
    code: "20",
    label: "Aprovisionamiento",
    links: [
      { href: "/suppliers", label: "Proveedores", code: "20", icon: Factory },
      { href: "/purchases/orders", label: "Pedidos de compra", code: "21", icon: ClipboardText },
      { href: "/purchases/receipts", label: "Recepciones", code: "22", icon: Package },
      { href: "/expenses", label: "Facturas de proveedor", code: "23", icon: FileArrowDown },
      { href: "/purchases/payments", label: "Pagos a proveedores", code: "24", icon: Coins },
    ],
  },
  {
    code: "30",
    label: "Finanzas y operaciones",
    links: [
      { href: "/inventory", label: "Inventario", code: "30", icon: Package },
      { href: "/accounting", label: "Contabilidad", code: "31", icon: BookOpenText },
      { href: "/treasury", label: "Tesorería", code: "32", icon: Bank },
      { href: "/fiscal", label: "Fiscal", code: "33", icon: Calculator },
      { href: "/reporting", label: "Informes", code: "34", icon: ChartLineUp },
    ],
  },
  {
    code: "40",
    label: "Administración",
    links: [
      { href: "/billing", label: "Suscripción", code: "40", icon: CreditCard },
      { href: "/settings/company", label: "Empresa", code: "41", icon: Buildings },
      { href: "/settings/api-keys", label: "API", code: "42", icon: BracketsCurly },
      { href: "/settings/security", label: "Seguridad", code: "43", icon: ShieldCheck },
      { href: "/settings/team", label: "Equipo", code: "44", icon: UserCircleGear },
      { href: "/settings/masters", label: "Maestros", code: "45", icon: SlidersHorizontal },
    ],
  },
] as const;

export type ContextGroup = {
  roots: string[];
  label: string;
  code: string;
  links: Array<{ href: string; label: string; exact?: boolean }>;
};

export const contextGroups: ContextGroup[] = [
  {
    roots: ["/customers", "/sales", "/invoices"],
    code: "10",
    label: "Comercial",
    links: [
      { href: "/customers", label: "Clientes" },
      { href: "/sales/quotes", label: "Presupuestos" },
      { href: "/sales/orders", label: "Pedidos" },
      { href: "/sales/delivery-notes", label: "Albaranes" },
      { href: "/invoices", label: "Facturas" },
    ],
  },
  {
    roots: ["/suppliers", "/purchases", "/expenses"],
    code: "20",
    label: "Aprovisionamiento",
    links: [
      { href: "/suppliers", label: "Proveedores" },
      { href: "/purchases/orders", label: "Pedidos" },
      { href: "/purchases/receipts", label: "Recepciones" },
      { href: "/expenses", label: "Facturas proveedor" },
      { href: "/purchases/payments", label: "Pagos" },
    ],
  },
  {
    roots: ["/inventory"],
    code: "30",
    label: "Inventario",
    links: [
      { href: "/inventory", label: "Existencias", exact: true },
      { href: "/inventory/items", label: "Artículos" },
      { href: "/inventory/warehouses", label: "Almacenes" },
      { href: "/inventory/movements", label: "Movimientos" },
    ],
  },
  {
    roots: ["/accounting"],
    code: "31",
    label: "Contabilidad",
    links: [
      { href: "/accounting", label: "Resumen", exact: true },
      { href: "/accounting/accounts", label: "Plan contable" },
      { href: "/accounting/entries", label: "Asientos" },
      { href: "/accounting/reports", label: "Estados financieros" },
    ],
  },
  {
    roots: ["/treasury"],
    code: "32",
    label: "Tesorería",
    links: [
      { href: "/treasury", label: "Resumen", exact: true },
      { href: "/treasury/bank-accounts", label: "Cuentas" },
      { href: "/treasury/bank-transactions", label: "Movimientos" },
      { href: "/treasury/reconciliation", label: "Conciliación" },
      { href: "/treasury/forecast", label: "Previsión" },
    ],
  },
  {
    roots: ["/fiscal"],
    code: "33",
    label: "Fiscalidad",
    links: [
      { href: "/fiscal", label: "Modelos", exact: true },
      { href: "/fiscal/calendar", label: "Calendario" },
      { href: "/fiscal/settings", label: "Configuración" },
    ],
  },
  {
    roots: ["/settings", "/billing"],
    code: "40",
    label: "Administración",
    links: [
      { href: "/settings/company", label: "Empresa" },
      { href: "/settings/masters", label: "Maestros" },
      { href: "/settings/team", label: "Equipo" },
      { href: "/settings/security", label: "Seguridad" },
      { href: "/settings/api-keys", label: "API" },
      { href: "/settings/audit", label: "Auditoría" },
      { href: "/billing", label: "Suscripción" },
    ],
  },
];

export type NavigationLink = (typeof navGroups)[number]["links"][number];

export const navigationLinks: NavigationLink[] = navGroups.reduce<NavigationLink[]>(
  (links, group) => {
    links.push(...group.links);
    return links;
  },
  [],
);

export function isActiveRoute(pathname: string, href: string) {
  if (href === "/sales/quotes" && pathname === "/sales/new") return true;
  if (
    href === "/purchases/orders" &&
    (pathname === "/purchases/new" || /^\/purchases\/[^/]+(?:\/edit)?$/.test(pathname))
  )
    return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getContextGroup(pathname: string) {
  return contextGroups.find((group) =>
    group.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  );
}
