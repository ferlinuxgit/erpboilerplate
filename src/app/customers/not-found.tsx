import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Cliente no encontrado" description="El cliente solicitado no existe o no pertenece a tu empresa activa." />;
}
