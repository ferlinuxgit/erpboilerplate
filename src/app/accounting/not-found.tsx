import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Recurso contable no encontrado" description="El recurso contable solicitado no está disponible para tu contexto actual." />;
}
