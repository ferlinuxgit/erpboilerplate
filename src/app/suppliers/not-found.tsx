import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Proveedor no encontrado" description="El proveedor solicitado no existe o no pertenece a tu empresa activa." />;
}
