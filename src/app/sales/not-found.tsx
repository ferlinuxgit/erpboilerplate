import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Documento de venta no encontrado" description="El documento solicitado no está disponible para tu contexto actual." />;
}
