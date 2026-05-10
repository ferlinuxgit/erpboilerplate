import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Factura no encontrada" description="La factura solicitada no existe o no pertenece a tu empresa activa." />;
}
