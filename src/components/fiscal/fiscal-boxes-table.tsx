"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAeatAmount, formatMoney } from "@/lib/format";

export type FiscalBoxRow = {
  box: string;
  label: string;
  amount: number;
  kind?: string;
};

type FiscalBoxesTableProps = {
  boxes: FiscalBoxRow[];
  currencyCode: string;
  /** Casillas que no se copian a la AEAT (p. ej. "REV"/"EXE": revisar a mano). */
  reviewBoxes?: string[];
  caption: string;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Navegadores sin API de portapapeles (o contexto no seguro): copia con una selección temporal.
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/**
 * Casillas del modelo con botón "Copiar" por casilla (importe con coma decimal y sin miles, tal
 * como lo piden los formularios de la AEAT) y "Copiar todas" (casilla + importe, una por línea).
 */
export function FiscalBoxesTable({ boxes, caption, currencyCode, reviewBoxes = [] }: FiscalBoxesTableProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyable = boxes.filter((box) => !reviewBoxes.includes(box.box));

  async function copy(key: string, text: string, message: string) {
    try {
      await copyText(text);
      setCopied(key);
      toast.success(message);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      toast.error("No se pudo copiar. Selecciona el importe y cópialo a mano.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Los importes se copian sin puntos de miles y con coma decimal, como los pide la sede de la AEAT.</p>
        <Button
          onClick={() => void copy("all", copyable.map((box) => `Casilla ${box.box}\t${formatAeatAmount(box.amount)}`).join("\n"), `${copyable.length} casillas copiadas.`)}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied === "all" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Copiar todas
        </Button>
      </div>
      <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Casilla</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">Copiar</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boxes.map((box, index) => {
              const review = reviewBoxes.includes(box.box);
              const key = `${box.box}-${index}`;
              return (
                <TableRow key={key}>
                  <TableCell className="font-mono">{review ? "Revisar" : box.box}</TableCell>
                  <TableCell className={box.kind === "settlement" ? "font-semibold" : undefined}>{box.label}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(box.amount, currencyCode)}</TableCell>
                  <TableCell className="text-right">
                    {review ? null : (
                      <Button
                        aria-label={`Copiar importe de la casilla ${box.box}`}
                        onClick={() => void copy(key, formatAeatAmount(box.amount), `Casilla ${box.box} copiada: ${formatAeatAmount(box.amount)}`)}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        {copied === key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied === key ? "Copiado" : "Copiar"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
