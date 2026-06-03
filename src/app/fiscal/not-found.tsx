import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Modelo fiscal no encontrado" description="El modelo solicitado no existe o no pertenece a la empresa activa." />;
}
