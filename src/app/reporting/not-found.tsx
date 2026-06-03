import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="Informe no encontrado" description="El informe solicitado no existe o no pertenece a la empresa activa." />;
}
