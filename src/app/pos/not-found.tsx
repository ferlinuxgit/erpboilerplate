import { RouteNotFoundState } from "@/components/route-state";

export default function NotFound() {
  return <RouteNotFoundState title="No encontrado en el TPV" description="La caja, el cierre o el ticket no existe o no pertenece a la empresa activa." />;
}
