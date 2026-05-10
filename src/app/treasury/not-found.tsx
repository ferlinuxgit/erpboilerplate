import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Recurso de tesorería no encontrado" description="El recurso solicitado no está disponible para tu contexto actual." />;
}
