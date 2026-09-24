import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="No encontramos este panel" description="Puede que la empresa activa no tenga todavía panel disponible." />;
}
