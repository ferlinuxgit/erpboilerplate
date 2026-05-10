import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="No encontramos esta configuración" description="Puede que el ajuste solicitado no exista o no esté disponible para la empresa activa." />;
}
