import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Suscripción no encontrada" description="La suscripción solicitada no existe o no pertenece al tenant activo." />;
}
