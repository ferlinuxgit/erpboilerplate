import type { Metadata } from "next";

export const metadata: Metadata = { title: "Puesta en marcha" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
