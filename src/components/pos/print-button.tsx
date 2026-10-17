"use client";

import { Printer } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return <Button onClick={() => window.print()} type="button" variant="outline"><Printer aria-hidden="true" /> {label}</Button>;
}
