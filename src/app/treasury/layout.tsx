import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tesorería" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
