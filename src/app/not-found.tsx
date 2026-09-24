import type { Metadata } from "next";

import { RouteNotFoundState } from "@/components/route-state";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return (
    <RouteNotFoundState
      description="La dirección no existe o ya no está disponible. Usa la navegación o la búsqueda global (Ctrl K) para encontrar lo que buscas."
      title="Página no encontrada"
    />
  );
}
