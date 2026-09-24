import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inventario" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
