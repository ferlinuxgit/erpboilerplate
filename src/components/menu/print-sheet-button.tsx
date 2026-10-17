"use client";

import { Printer } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

export function PrintSheetButton() {
  return <Button className="h-11" onClick={() => window.print()} type="button"><Printer aria-hidden="true" /> Imprimir</Button>;
}
