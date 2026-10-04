import { RouteLoadingState } from "@/components/route-state";

export default function ExpensesLoading() {
  return <RouteLoadingState title="Cargando facturas de proveedor" description="Estamos preparando el listado de gastos y facturas recibidas." />;
}
