import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "TPV" };

// Móviles con muesca: el TPV ocupa toda la pantalla y respeta las zonas seguras.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
