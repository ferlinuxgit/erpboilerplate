"use client";

import { User } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { PosCustomer } from "./types";

/** Elegir cliente para hacer factura completa (con su NIF) en lugar de ticket. */
export function CustomerSheet({ current, onClose, onSelect, open }: { current: PosCustomer | null; onClose: () => void; onSelect: (customer: PosCustomer | null) => void; open: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/pos/customers?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() as Promise<PosCustomer[]> : []))
        .then(setResults)
        .catch(() => undefined);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <Dialog description="Para hacer factura completa con los datos del cliente." onClose={onClose} open={open} title="Cliente">
      <div className="space-y-2" data-testid="pos-customer-sheet">
        <Input aria-label="Buscar cliente" autoFocus className="h-12 text-base" onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o NIF" type="search" value={query} />
        <ul className="divide-y divide-window-shadow border border-window-shadow">
          {query.trim().length < 2 ? <li className="p-3 text-sm text-muted-foreground">Escribe al menos dos letras.</li> : results.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Sin resultados.</li> : null}
          {query.trim().length >= 2 ? results.map((entry) => (
            <li key={entry.id}>
              <button className="flex min-h-14 w-full items-center gap-2 px-3 text-left hover:bg-window-highlight" onClick={() => onSelect(entry)} type="button">
                <User aria-hidden="true" className="size-5 shrink-0 text-link" />
                <span className="min-w-0"><span className="block truncate font-medium">{entry.name}</span>{entry.taxId ? <span className="text-xs text-muted-foreground">{entry.taxId}</span> : null}</span>
              </button>
            </li>
          )) : null}
        </ul>
        {current ? <Button className="h-12 w-full" onClick={() => onSelect(null)} type="button" variant="outline">Quitar cliente (volver a ticket)</Button> : null}
      </div>
    </Dialog>
  );
}
